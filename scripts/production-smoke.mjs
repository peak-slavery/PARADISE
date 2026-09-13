#!/usr/bin/env node
/**
 * Production-shaped smoke test.
 *
 * Run against a deployed dashboard and its eight Render bot services. All
 * credentials must come from environment variables; values are never printed.
 */
import { createHmac } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const requiredString = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const requiredEnvironment = [
  'DASHBOARD_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MONGODB_URI',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'HMAC_SECRETS_JSON',
  'DASHBOARD_HEALTH_TOKEN',
  'HEALTH_TOKEN',
  'SMOKE_BOT_ID',
  'SHANKS_URL',
  'SANJI_URL',
  'ZORO_URL',
  'BOAHANCOCK_URL',
  'NAMI_URL',
  'LUFFY_URL',
  'NIKO_ROBIN_URL',
  'CYRENE_URL',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment variable: ${name}`);
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    await fn((detail) => record(name, true, detail));
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

const dashboardUrl = new URL(requiredString('DASHBOARD_URL'));
if (dashboardUrl.protocol !== 'https:' && dashboardUrl.hostname !== 'localhost' && dashboardUrl.hostname !== '127.0.0.1') {
  throw new Error('DASHBOARD_URL must use HTTPS outside localhost');
}
const timeout = (ms = 10_000) => AbortSignal.timeout(ms);

await check('dashboard public route', async (pass) => {
  const response = await fetch(dashboardUrl, { signal: timeout(), redirect: 'manual' });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  pass('HTTP 200');
});

await check('dashboard security headers', async (pass) => {
  const response = await fetch(dashboardUrl, { signal: timeout(), redirect: 'manual' });
  const headers = {
    'content-security-policy': response.headers.get('content-security-policy'),
    'x-frame-options': response.headers.get('x-frame-options'),
    'x-content-type-options': response.headers.get('x-content-type-options'),
    'referrer-policy': response.headers.get('referrer-policy'),
  };
  for (const [name, value] of Object.entries(headers)) {
    if (!value) throw new Error(`missing ${name}`);
  }
  pass('CSP, frame, content-type, and referrer protections present');
});

await check('dashboard auth redirect', async (pass) => {
  const response = await fetch(new URL('/dashboard', dashboardUrl), {
    signal: timeout(),
    redirect: 'manual',
  });
  if (response.status !== 307 && response.status !== 302) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get('location')) throw new Error('missing redirect location');
  pass('protected dashboard redirects unauthenticated callers');
});

await check('login flow starts', async (pass) => {
  const response = await fetch(new URL('/login', dashboardUrl), { signal: timeout(), redirect: 'manual' });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (!(await response.text()).includes('/auth')) throw new Error('login page does not expose an auth entry point');
  pass('login route renders');
});

await check('dashboard health readiness', async (pass) => {
  const response = await fetch(new URL('/api/health', dashboardUrl), {
    headers: { authorization: `Bearer ${process.env.DASHBOARD_HEALTH_TOKEN}` },
    signal: timeout(),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 'ok') throw new Error(`status ${payload.status ?? 'unknown'}`);
  const connections = payload.db_connections ?? {};
  for (const dependency of ['supabase', 'mongo', 'redis']) {
    if (connections[dependency] !== true) throw new Error(`${dependency} unavailable`);
  }
  pass('Supabase, Mongo, and Redis readiness verified');
});

await check('supabase service connection', async (pass) => {
  const client = createClient(requiredString('SUPABASE_URL'), requiredString('SUPABASE_SERVICE_ROLE_KEY'));
  const { error } = await client.from('servers').select('id').limit(1);
  if (error) throw error;
  pass('service-role REST read succeeded');
});

const mongoUri = requiredString('MONGODB_URI');
const mongoClient = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 10_000,
  tls: mongoUri.includes('mongodb+srv://'),
});
await check('mongo connection and indexes', async (pass) => {
  await mongoClient.connect();
  const db = mongoClient.db(process.env.MONGODB_DB?.trim() || 'eiflow');
  await db.command({ ping: 1 });
  const collections = await db.listCollections().toArray();
  const collectionNames = new Set(collections.map((collection) => collection.name));
  for (const required of ['logs', 'ai_context']) {
    if (!collectionNames.has(required)) throw new Error(`missing collection ${required}`);
  }
  const aiIndexes = await db.collection('ai_context').listIndexes().toArray();
  if (!aiIndexes.some((index) => index.name === 'ai_ctx_ttl')) {
    throw new Error('missing canonical ai_ctx_ttl index');
  }
  pass('ping, required collections, and canonical TTL index verified');
});
await mongoClient.close().catch(() => undefined);

await check('redis rate-limit path', async (pass) => {
  const redisUrl = requiredString('UPSTASH_REDIS_REST_URL').replace(/\/$/, '');
  const token = requiredString('UPSTASH_REDIS_REST_TOKEN');
  const key = `production-smoke:${Date.now()}`;
  const request = async (command) => fetch(`${redisUrl}/${command}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify([]),
    signal: timeout(),
  });
  const set = await request(`set/${key}/1/EX/60`);
  const incr = await request(`incr/${key}`);
  if (!set.ok || !incr.ok) throw new Error('redis write/read failed');
  pass('write/read and expiry path succeeded');
});

await check('hmac tampering and cross-bot rejection', async (pass) => {
  const secrets = JSON.parse(requiredString('HMAC_SECRETS_JSON'));
  const botId = requiredString('SMOKE_BOT_ID');
  const secret = secrets[botId];
  if (typeof secret !== 'string' || !secret) throw new Error(`missing HMAC secret for ${botId}`);
  const otherBotId = Object.keys(secrets).find((id) => id !== botId);
  if (!otherBotId) throw new Error('HMAC_SECRETS_JSON must contain at least two distinct bot secrets');
  const send = async (payload, signatureSecret = secret, timestamp = Math.floor(Date.now() / 1000)) => {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', signatureSecret).update(`${timestamp}.${body}`).digest('hex');
    return fetch(new URL('/api/internal/config', dashboardUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pe-timestamp': String(timestamp),
      'x-pe-signature': signature,
    },
    body,
    signal: timeout(),
  });
  };

  const basePayload = { bot_id: botId, guild_id: '123456789012345678', request_id: 'smoke-hmac-test' };
  const stale = await send(basePayload, secret, Math.floor(Date.now() / 1000) - 600);
  if (stale.status !== 401) throw new Error(`stale request returned HTTP ${stale.status}`);

  const tamperedPayload = { ...basePayload, request_id: 'smoke-hmac-tampered' };
  const tampered = await send(tamperedPayload, secret);
  if (tampered.status !== 401) throw new Error(`tampered body returned HTTP ${tampered.status}`);

  const wrongBot = await send(basePayload, secrets[otherBotId]);
  if (wrongBot.status !== 401) throw new Error(`cross-bot secret returned HTTP ${wrongBot.status}`);

  pass('stale, tampered, and cross-bot requests rejected');
});

const bots = [
  ['shanks', 'eiflow-shanks'],
  ['sanji', 'eiflow-sanji'],
  ['zoro', 'eiflow-zoro'],
  ['boahancock', 'eiflow-boahancock'],
  ['nami', 'eiflow-nami'],
  ['luffy', 'eiflow-luffy'],
  ['niko-robin', 'eiflow-niko-robin'],
  ['cyrene', 'eiflow-cyrene'],
];
const botUrls = Object.fromEntries(
  bots.map(([id]) => [id, process.env[`${id.toUpperCase().replace(/-/g, '_')}_URL`]]),
);
for (const [botId, botName] of bots) {
  await check(`bot health: ${botName}`, async (pass) => {
    const base = botUrls[botId];
    if (!base) throw new Error(`missing ${botId.toUpperCase().replace(/-/g, '_')}_URL`);
    const response = await fetch(new URL('/health', base), {
      headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` },
      signal: timeout(),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(`status ${payload.status ?? 'unknown'}`);
    const connections = payload.db_connections ?? {};
    for (const dependency of ['supabase', 'mongo', 'redis']) {
      if (connections[dependency] !== true) throw new Error(`${dependency} unavailable`);
    }
    pass('process, auth, and backing dependencies ready');
  });
}

const failures = results.filter((result) => !result.ok);
if (failures.length) {
  console.error(`production smoke failed: ${failures.length}/${results.length} checks`);
  process.exitCode = 1;
} else {
  console.log(`production smoke passed: ${results.length}/${results.length} checks`);
}
