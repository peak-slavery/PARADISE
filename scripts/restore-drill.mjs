#!/usr/bin/env node
/**
 * Scheduled MongoDB restore drill.
 *
 * Exports one bounded log batch to a temporary file, restores it into an
 * isolated `restore_drill_*` collection, verifies document parity and required
 * indexes, then deletes the temporary collection and file.
 *
 * Run directly (`npm run drill:restore`); when imported by tests only the pure
 * parity predicate is evaluated, so importing never requires credentials or a
 * live cluster.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

const require = createRequire(import.meta.url);
const { indexes } = require('../infra/mongo/indexes.cjs');
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

/**
 * Compare exported source rows against restored documents at field level.
 *
 * Exported for testing: count-only comparison is not sufficient evidence of a
 * usable restore, so this predicate is the drill's actual correctness gate.
 * `_id` is dropped during insert and `restored_at` is added by the drill.
 *
 * @returns {string} '' when parity holds, otherwise a failure description.
 */
export function verifyRestoreParity(sourceRows, restoredDocs) {
  const canonical = (row, drop) => {
    const copy = {};
    for (const key of Object.keys(row).sort()) {
      if (key === drop) continue;
      copy[key] = row[key];
    }
    return JSON.stringify(copy);
  };
  const expected = sourceRows.map((row) => canonical(row, '_id')).sort();
  const actual = restoredDocs.map((row) => canonical(row, 'restored_at')).sort();
  if (expected.length !== actual.length) {
    return `restored document count mismatch: expected ${expected.length}, got ${actual.length}`;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== actual[i]) {
      return `restored document ${i + 1} does not match the exported source record`;
    }
  }
  return '';
}

const dbName = process.env.MONGODB_DB?.trim() || 'eiflow';
const batchSize = 100;
const output = path.resolve('temp-restore-drill.jsonl');
const targetCollection = `restore_drill_${Date.now()}`;

async function main() {
  const mongoUri = required('MONGODB_URI');
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    tls: mongoUri.includes('mongodb+srv://'),
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const source = db.collection('logs');
    const rows = await source.find().sort({ created_at: -1, _id: -1 }).limit(batchSize).toArray();
    await rm(output, { force: true });
    const file = createWriteStream(output, { encoding: 'utf8' });
    await Promise.all(rows.map((row) => file.write(`${JSON.stringify(row)}\n`)));
    await new Promise((resolve, reject) => file.end(resolve));
    file.on('error', reject);

    const metadata = await stat(output);
    if (metadata.size === 0) throw new Error('restore export is empty');

    const restored = [];
    let pending = '';
    await new Promise((resolve, reject) => {
      const stream = createReadStream(output, { encoding: 'utf8' });
      stream.on('data', (chunk) => {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) restored.push(JSON.parse(line));
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
    const target = db.collection(targetCollection);
    await target.insertMany(restored.map(({ _id, ...row }) => ({ ...row, restored_at: new Date() })));
    if (await target.countDocuments({}) !== rows.length) throw new Error('restored document count mismatch');

    // Count parity alone would pass on silently corrupted payloads. Compare the
    // actual field values round-tripped through the export, so a truncated,
    // reordered, or type-mangled restore fails the drill instead of reporting
    // success.
    const parityFailure = verifyRestoreParity(
      rows,
      await target.find({}, { projection: { restored_at: 0 } }).toArray(),
    );
    if (parityFailure) throw new Error(parityFailure);
    console.log(`verified field-level parity for ${rows.length} documents`);

    const requiredIndexes = indexes.filter((index) => index.collection === 'logs');
    for (const index of requiredIndexes) await target.createIndex(index.key, { name: index.name, ...index.options });
    const targetIndexes = await target.listIndexes().toArray();
    for (const index of requiredIndexes) {
      if (!targetIndexes.some((candidate) => candidate.name === index.name)) {
        throw new Error(`restored collection missing index ${index.name}`);
      }
    }
    console.log(`restore drill passed: ${rows.length} documents, ${requiredIndexes.length} indexes`);
  } finally {
    await client.db(dbName).collection(targetCollection).drop().catch(() => undefined);
    await client.close().catch(() => undefined);
    await unlink(output).catch(() => undefined);
  }
}

// Only execute when run as a script; tests import the pure parity predicate.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
