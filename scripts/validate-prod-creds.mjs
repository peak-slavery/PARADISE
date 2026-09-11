#!/usr/bin/env node
/**
 * Live production-credential validator. Reads "temp cred.txt" from the repo
 * root (gitignored) so secret values never appear on a command line or in
 * output. Prints PASS/FAIL diagnostics only — no secret values.
 */
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../temp cred.txt', import.meta.url), 'utf8');
const out = [];
const rec = (label, ok, detail = '') => {
  out.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

function section(headerRe) {
  const m = raw.match(new RegExp(headerRe, 'm'));
  if (!m) return '';
  const rest = raw.slice(m.index + m[0].length);
  const next = rest.search(/^#/m);
  return next === -1 ? rest : rest.slice(0, next);
}
const field = (src, key) => {
  const m = src.match(new RegExp(`${key}="?([^\\n"]+?)"?\\s*$`, 'm'));
  return m ? m[1].trim() : null;
};
const kv = (key) => field(raw, key);
const T = (ms = 15_000) => AbortSignal.timeout(ms);

// --- Supabase: service key + REST, and which tables exist ---
const SB_URL = kv('NEXT_PUBLIC_SUPABASE_URL');
let sbTables = [];
try {
  const key = kv('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${SB_URL}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: T(),
  });
  if (!res.ok) rec('supabase rest (service key)', false, `HTTP ${res.status}`);
  else {
    sbTables = Object.keys((await res.json()).definitions ?? {}).sort();
    rec('supabase rest (service key)', true, `tables: ${sbTables.join(', ') || '(none — schema not loaded)'}`);
  }
} catch (e) { rec('supabase rest (service key)', false, e.message); }

try {
  const res = await fetch(`${SB_URL}/auth/v1/health`, { headers: { apikey: kv('NEXT_PUBLIC_SUPABASE_ANON_KEY') }, signal: T() });
  rec('supabase auth (anon key)', res.ok, `HTTP ${res.status}`);
} catch (e) { rec('supabase auth (anon key)', false, e.message); }

// --- Upstash Redis ping ---
try {
  const res = await fetch(kv('UPSTASH_REDIS_REST_URL').replace(/\/$/, '') + '/ping', {
    headers: { Authorization: `Bearer ${kv('UPSTASH_REDIS_REST_TOKEN')}` },
    signal: T(),
  });
  const body = await res.json().catch(() => ({}));
  rec('upstash redis', res.ok && body.result === 'PONG', body.result ?? `HTTP ${res.status}`);
} catch (e) { rec('upstash redis', false, e.message); }

// --- MongoDB primary + secondary ---
const { MongoClient } = await import('mongodb');
for (const [label, header] of [['mongodb primary', 'primary mongo db'], ['mongodb secondary', 'mongodb 2']]) {
  const sec = section(`#\\s*${header}`);
  const client = new MongoClient(field(sec, 'connection string'), { serverSelectionTimeoutMS: 15_000, tls: true });
  try {
    await client.connect();
    const db = field(sec, 'database name');
    const cols = (await client.db(db).listCollections().toArray()).map((c) => c.name);
    rec(`${label} (${db})`, true, cols.length ? cols.join(', ') : 'empty (fresh)');
  } catch (e) { rec(`${label}`, false, e.message); }
  finally { await client.close().catch(() => undefined); }
}

// --- Cloudflare R2 (API token + account id) ---
try {
  const sec = section('#\\s*cloudeflare');
  const account = sec.match(/^\s*([0-9a-f]{32})\s*$/m)?.[1];
  const token = sec.match(/^\s*(cfat_\S+)\s*$/m)?.[1];
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: T(),
  });
  const body = await res.json().catch(() => ({}));
  rec('cloudflare r2 (api token)', res.ok && body.success, body?.errors?.[0]?.message ?? `HTTP ${res.status}`);
} catch (e) { rec('cloudflare r2 (api token)', false, e.message); }

// --- Firebase: stored for the vault but has no runtime consumer; skip if the
// SDK is not installed in this monorepo. ---
{
  const m = raw.match(/"type":\s*"service_account"[\s\S]*?"universe_domain":\s*"[^"]+"/);
  if (!m) rec('firebase service account', false, 'not found in cred file');
  else {
    try {
      const creds = JSON.parse(`{${m[0]}}`);
      const admin = await import('firebase-admin/app');
      const app = admin.initializeApp({ credential: admin.cert(creds) }, 'validator');
      const { getFirestore } = await import('firebase-admin/firestore');
      await getFirestore(app).collection('smoke').limit(1).get();
      rec('firebase service account', true, 'firestore read ok');
      await app.delete();
    } catch (e) {
      rec('firebase service account', String(e).includes('firebase-admin'), String(e).includes('firebase-admin') ? 'sdk not installed — vault-stored only, no runtime consumer' : e.message);
    }
  }
}

// --- Sentry ingest host reachable ---
{
  try {
    const u = new URL(kv('sentry key'));
    const res = await fetch(u.origin, { signal: T() });
    rec('sentry ingest host', true, `HTTP ${res.status} (reachable)`);
  } catch (e) { rec('sentry ingest host', false, e.message); }
}

// --- Discord: every bot token must resolve its own application ---
{
  const { REST, Routes } = await import('discord.js');
  const blocks = [...raw.matchAll(/^([A-Z][^\n]+)\n- token=(\S+)[^\n]*\n- application id=(\d+)/gm)];
  for (const [, name, token, appId] of blocks) {
    try {
      const me = await new REST({ version: '10' }).setToken(token).get(Routes.user('@me'), { signal: T() });
      rec(`discord "${name}"`, me.id === appId, `@${me.username} id ${me.id}${me.id === appId ? '' : ' != ' + appId}`);
    } catch (e) { rec(`discord "${name}"`, false, String(e).slice(0, 100)); }
  }
}

const failed = out.filter((r) => !r.ok);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) {
  console.log('FAILED: ' + failed.map((f) => f.label).join(', '));
  process.exit(1);
}
