#!/usr/bin/env node
/**
 * Deploy prerequisite check: is the production Supabase schema loaded?
 * Reads "temp cred.txt" (gitignored) and queries the REST OpenAPI spec.
 * Prints table names only — never a secret.
 */
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../temp cred.txt', import.meta.url), 'utf8');
const url = raw.match(/^NEXT_PUBLIC_SUPABASE_URL=(\S+)/m)?.[1];
const key = raw.match(/^SUPABASE_SERVICE_ROLE_KEY=(\S+)/m)?.[1];

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15_000),
});
if (!res.ok) {
  console.log(`REST probe failed: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
const tables = Object.keys(spec.definitions ?? {}).sort();
console.log(`exposed tables (${tables.length}): ${tables.join(', ') || '(NONE — schema not loaded)'}`);

// Expected tables from infra/supabase/schema.sql
const expected = ['users','internal_request_nonces','servers','bot_configs','mod_actions','security_events','antinuke_whitelist','infra_accounts','bot_states','server_settings','secret_records','guild_whitelists'];
const missing = expected.filter((t) => !tables.includes(t));
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'all expected tables present');
if (missing.length) process.exit(2);
