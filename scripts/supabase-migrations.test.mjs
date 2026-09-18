import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'infra/supabase/migrations');
const migrations = readdirSync(migrationsDir).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const runner = readFileSync(new URL('./apply-supabase-migrations.mjs', import.meta.url), 'utf8');
const monitor = readFileSync(new URL('./production-monitor.mjs', import.meta.url), 'utf8');

test('Supabase migrations use strict four-digit ordered names', () => {
  assert.ok(migrations.length > 0);
  migrations.forEach((name, index) => {
    assert.match(name, /^\d{4}_[a-z0-9_]+\.sql$/);
    assert.equal(Number(name.slice(0, 4)), index + 1, `${name} must be sequential`);
  });
});

test('migration runner is transactional and records a ledger', () => {
  assert.match(runner, /private\.schema_migrations/);
  assert.match(runner, /'-1'/);
  assert.match(runner, /ON_ERROR_STOP=1/);
});

test('migration runner bootstraps the ledger in one transaction', () => {
  // The ledger table, its checksum column, and the NOT NULL constraint must be
  // established together; partial bootstrap could leave migrations skippable.
  assert.match(runner, /create table if not exists private\.schema_migrations[\s\S]*?alter column checksum set not null;/);
});

test('migration runner enforces a contiguous migration sequence', () => {
  assert.match(runner, /Supabase migrations must be contiguous from 0001/);
});

test('migration runner rejects a baseline that is not the first migration', () => {
  assert.match(runner, /baseline must be the first migration/);
});

test('migration runner refuses to overwrite a conflicting baseline checksum', () => {
  assert.match(runner, /already recorded with a different checksum — refusing to overwrite/);
});

test('migration runner detects ledger drift from removed migrations', () => {
  assert.match(runner, /ledger contains unknown migrations/);
});

test('migration runner records an immutable checksum', () => {
  assert.match(runner, /createHash\('sha256'\)/);
  assert.match(runner, /insert into private\.schema_migrations \(filename, checksum\)/);
});

test('production monitor uses the dashboard API health route', () => {
  assert.match(monitor, /new URL\('\/api\/health', required\('DASHBOARD_URL'\)\)/);
  assert.match(monitor, /runWatchdog\(\{ tokens, statePath, auditPath, summaryPath \}\)/);
});

test('rollback drill records checksums for forward migrations', () => {
  const rollback = readFileSync(new URL('./rollback-drill.mjs', import.meta.url), 'utf8');
  assert.match(rollback, /private\.schema_migrations/);
  assert.match(rollback, /createHash\('sha256'\)/);
  assert.match(rollback, /--target=/);
});
