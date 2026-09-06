#!/usr/bin/env node
/**
 * Copy expired Supabase audit rows to MongoDB, then delete only the rows whose
 * archive write was verified. A failed archive write always leaves Supabase
 * untouched, so the next run can retry safely.
 */
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';

const TABLES = [
  { name: 'mod_actions', collection: 'archived_mod_actions' },
  { name: 'security_events', collection: 'archived_security_events' },
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(name, fallback, max) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw.trim())) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) throw new Error(`${name} is out of range`);
  return value;
}

function isTrue(name) {
  return /^(1|true|yes)$/i.test(process.env[name]?.trim() ?? '');
}

function errorName(error) {
  return error instanceof Error ? error.name : 'UnknownError';
}

const config = (() => {
  try {
    const supabaseUrl = required('SUPABASE_URL');
    const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
    const mongoUri = required('MONGODB_URI');
    if (!/^https:\/\//i.test(supabaseUrl)) throw new Error('SUPABASE_URL must use https');
    return {
      supabaseUrl,
      serviceRoleKey,
      mongoUri,
      mongoDb: process.env.MONGODB_DB?.trim() || 'eiflow',
      retentionDays: positiveInt('RETENTION_DAYS', 90, 3_650),
      batchSize: positiveInt('RETENTION_BATCH_SIZE', 250, 1_000),
      maxRows: positiveInt('RETENTION_MAX_ROWS', 10_000, 100_000),
      dryRun: isTrue('RETENTION_DRY_RUN'),
    };
  } catch (error) {
    console.error(`retention config invalid (${error instanceof Error ? error.message : 'unknown'})`);
    process.exit(1);
  }
})();

const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString();
const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const mongo = new MongoClient(config.mongoUri, {
  maxPoolSize: 2,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10_000,
  tls: true,
});

async function archiveTable(table) {
  const collection = mongo.db(config.mongoDb).collection(table.collection);
  await collection.createIndex({ archived_at: 1 }, { name: 'archive_ttl', expireAfterSeconds: 31_536_000 });
  await collection.createIndex({ source_id: 1 }, { name: 'archive_source_id' });

  /** Keyset cursor: rows strictly after (created_at, id). */
  const afterCursor = (query, cursor) =>
    query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`);

  let archived = 0;
  let cursor = null;
  for (;;) {
    const remaining = maxRows - archived;
    const pageSize = Math.min(batchSize, remaining);
    let query = supabase
      .from(table.name)
      .select('*')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(pageSize);
    if (cursor) query = afterCursor(query, cursor);
    const { data: rows, error: readError } = await query;

    if (readError) throw new Error(`${table.name} read failed (${errorName(readError)})`);
    if (!rows?.length) break;
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };

    if (config.dryRun) {
      archived += rows.length;
    } else {
      const now = new Date();
      const docs = rows.map((row) => ({
        _id: `${table.name}:${row.id}`,
        source_table: table.name,
        source_id: row.id,
        archived_at: now,
        row,
      }));

      await collection.bulkWrite(
        docs.map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $setOnInsert: doc },
            upsert: true,
          },
        })),
        { ordered: false },
      );

      const ids = rows.map((row) => row.id);
      const archivedRows = await collection
        .find({ _id: { $in: ids.map((id) => `${table.name}:${id}`) } }, { projection: { _id: 1, row: 1 } })
        .toArray();
      const archivedById = new Map(archivedRows.map((doc) => [doc._id, doc.row]));
      const mismatched = rows.some((row) => {
        const stored = archivedById.get(`${table.name}:${row.id}`);
        return JSON.stringify(stored) !== JSON.stringify(row);
      });
      if (archivedRows.length !== rows.length || mismatched) {
        throw new Error(`${table.name} archive verification failed`);
      }

      const { error: deleteError } = await supabase
        .from(table.name)
        .delete()
        .in('id', ids)
        .lt('created_at', cutoff);
      if (deleteError) throw new Error(`${table.name} delete failed (${errorName(deleteError)})`);

      const { data: left, error: verifyError } = await supabase
        .from(table.name)
        .select('id')
        .in('id', ids)
        .lt('created_at', cutoff);
      if (verifyError) throw new Error(`${table.name} delete verification failed (${errorName(verifyError)})`);
      if (left?.length) throw new Error(`${table.name} delete verification found ${left.length} row(s)`);

      archived += rows.length;
    }

    if (rows.length < pageSize) break;
    if (archived >= maxRows) {
      let probe = supabase
        .from(table.name)
        .select('id')
        .lt('created_at', cutoff)
        .limit(1);
      if (cursor) probe = afterCursor(probe, cursor);
      const { data: more, error: probeError } = await probe;
      if (probeError) throw new Error(`${table.name} limit probe failed (${errorName(probeError)})`);
      if (more?.length) throw new Error(`${table.name} exceeded RETENTION_MAX_ROWS; rerun after review`);
      break;
    }
  }

  return archived;
}

try {
  await mongo.connect();
  const totals = [];
  for (const table of TABLES) {
    totals.push(`${table.name}=${await archiveTable(table)}`);
  }
  console.log(`${config.dryRun ? 'retention dry run' : 'retention complete'}: ${totals.join(', ')}; cutoff=${cutoff}`);
} catch (error) {
  console.error(`retention failed (${errorName(error)})`);
  process.exitCode = 1;
} finally {
  await mongo.close().catch(() => undefined);
}
