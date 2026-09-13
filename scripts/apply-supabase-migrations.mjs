#!/usr/bin/env node
/**
 * Deterministic Supabase migration runner.
 *
 * A fresh database executes every file in order. A database initialized before
 * this ledger must be marked with --baseline=0001_baseline once; the runner
 * then never re-executes the baseline and only applies later migrations.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'infra/supabase/migrations');
const args = new Map(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s, 2)).filter(([name]) => name?.startsWith('--')));
const databaseUrl = args.get('--database-url') ?? process.env.SUPABASE_DB_URL;
const baseline = args.get('--baseline');

if (!databaseUrl) {
  console.error('Usage: node scripts/apply-supabase-migrations.mjs [--database-url=<url>] [--baseline=<migration>]');
  process.exit(2);
}

const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrations.length === 0) throw new Error('no Supabase migrations found');
if (baseline && !migrations.includes(baseline)) throw new Error(`unknown baseline migration: ${baseline}`);

function migrationChecksum(filename) {
  return createHash('sha256').update(readFileSync(path.join(migrationsDir, filename))).digest('hex');
}

function psql(args, options = {}) {
  const result = spawnSync('psql', args, {
    ...options,
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: process.env.SUPABASE_DB_PASSWORD ?? '' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'psql failed');
  return result.stdout;
}

psql([databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', `
  create schema if not exists private;
  create table if not exists private.schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now(),
    checksum text not null
  );
`]);

psql([databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', `
  alter table private.schema_migrations
  add column if not exists checksum text;
  update private.schema_migrations
  set checksum = 'legacy'
  where checksum is null;
  alter table private.schema_migrations
  alter column checksum set not null;
`]);

if (baseline) {
  const checksum = migrationChecksum(baseline);
  psql([databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', `
    insert into private.schema_migrations (filename, checksum)
    values ('${baseline.replace(/'/g, "''")}', '${checksum}')
    on conflict (filename) do nothing;
  `]);
  console.log(`Marked existing database baseline: ${baseline}`);
}

const appliedOutput = psql([databaseUrl, '-t', '-A', '-N', '-F', '\t', '-c', 'select filename, checksum from private.schema_migrations;']);
const applied = new Map(
  appliedOutput.split(/\r?\n/).filter(Boolean).map((row) => {
    const [filename, checksum] = row.split('\t');
    return [filename, checksum];
  }),
);

for (const filename of migrations) {
  const checksum = migrationChecksum(filename);
  const recorded = applied.get(filename);
  if (recorded !== undefined && recorded !== 'legacy' && recorded !== checksum) {
    throw new Error(`already-applied migration changed: ${filename}`);
  }
  if (recorded !== undefined) continue;
  const file = path.join(migrationsDir, filename).replaceAll('\\', '/');
  psql([databaseUrl, '-v', 'ON_ERROR_STOP=1', '-1'], {
    input: `\\i '${file.replace(/'/g, "''")}'\ninsert into private.schema_migrations (filename, checksum) values ('${filename.replace(/'/g, "''")}', '${checksum}');\n`,
  });
  console.log(`Applied ${filename}`);
}

console.log(`Supabase migrations complete (${migrations.length} files, ${migrations.length - applied.size} newly applied).`);
