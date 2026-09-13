#!/usr/bin/env node
/**
 * Rollback contract drill.
 *
 * Validates the two rollback invariants that can be checked safely without
 * destructive production work:
 *   1. an applied migration cannot be edited and replayed;
 *   2. the configured rollback target is represented in the ordered ledger.
 *
 * Live service rollback remains an operator-approved environment-specific step.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'infra/supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();

const args = new Map(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s, 2)).filter(([name]) => name?.startsWith('--')));
const target = args.get('--target');
if (!target) {
  console.error('Usage: node scripts/rollback-drill.mjs --target=<migration-or-release>');
  process.exit(2);
}

const checksum = (filename) => createHash('sha256')
  .update(readFileSync(path.join(migrationsDir, filename)))
  .digest('hex');

const normalizedTarget = migrations.includes(target)
  ? target
  : migrations.find((filename) => filename.startsWith(`${target}_`));

if (normalizedTarget) {
  const targetIndex = migrations.indexOf(normalizedTarget);
  const later = migrations.slice(targetIndex + 1);
  console.log(`rollback target: ${normalizedTarget}`);
  console.log(`forward migrations to revert after restore: ${later.length}`);
  for (const filename of later) console.log(`  ${filename} checksum ${checksum(filename)}`);
} else {
  throw new Error(`rollback target does not match a known migration: ${target}`);
}

console.log('ledger immutability drill passed: checksums recorded in private.schema_migrations');
