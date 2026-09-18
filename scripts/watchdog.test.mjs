#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_EXPECTED_BOT_IDS,
  MAX_MISSES,
  STATE_VERSION,
  applyWatchdogResults,
  initialWatchdogState,
  invokeRecoveryAction,
  probeBotReadiness,
  runWatchdogCycle,
  transitionBotState,
  validateBotUrlMap,
  validateReadinessPayload,
  validateTokenMap,
} from './watchdog-core.mjs';
import cloudflareWorker, { WatchdogObject, WATCHDOG_CRON } from '../infra/cloudflare/worker.js';
import { runOciWatchdog } from '../infra/oci/watchdog.mjs';

const botId = 'shanks';
const token = 'test-token';
const tokens = Object.fromEntries(DEFAULT_EXPECTED_BOT_IDS.map((id) => [id, `${id}-token`]));
const urls = Object.fromEntries(DEFAULT_EXPECTED_BOT_IDS.map((id) => [id, `https://${id}.example/health`]));
const envUrls = Object.fromEntries(DEFAULT_EXPECTED_BOT_IDS.map((id) => [
  `${id.toUpperCase().replace(/-/g, '_')}_URL`,
  urls[id],
]));
const now = new Date('2026-09-18T12:00:00.000Z');

function readyPayload(id = botId) {
  return {
    status: 'ok',
    bot_id: id,
    uptime: 123,
    version: 'test-version',
    gateway_ready: true,
    guild_lock_ready: true,
    db_connections: { supabase: true, mongo: true, redis: true },
  };
}

function mockFetchFor(id, payload = readyPayload(id), status = 200) {
  return async (url, options) => {
    assert.equal(new URL(url).pathname, '/health');
    assert.equal(options.headers.authorization, `Bearer ${id}-token`);
    assert.equal(options.redirect, 'manual');
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('defines exactly the canonical eight bot identities', () => {
  assert.deepEqual(DEFAULT_EXPECTED_BOT_IDS, [
    'shanks', 'sanji', 'zoro', 'boahancock', 'nami', 'luffy', 'niko-robin', 'cyrene',
  ]);
  assert.equal(DEFAULT_EXPECTED_BOT_IDS.length, 8);
  assert.equal(new Set(DEFAULT_EXPECTED_BOT_IDS).size, 8);
});

test('validates exact token and URL identity maps', () => {
  assert.doesNotThrow(() => validateTokenMap(tokens));
  assert.doesNotThrow(() => validateBotUrlMap(urls));
  assert.throws(() => validateTokenMap({ shanks: token }), /does not match the fleet/);
  assert.throws(() => validateTokenMap({ ...tokens, extra: token }), /does not match the fleet/);
  assert.throws(() => validateBotUrlMap({ ...urls, shanks: 'http://shanks.example' }), /HTTPS/);
});

test('validates authenticated readiness fields fail closed', () => {
  assert.equal(validateReadinessPayload(readyPayload(), botId), null);
  assert.equal(validateReadinessPayload({ ...readyPayload(), gateway_ready: false }, botId), 'gateway_readiness');
  assert.equal(validateReadinessPayload({ ...readyPayload(), guild_lock_ready: false }, botId), 'guild_lock_readiness');
  assert.equal(validateReadinessPayload({ ...readyPayload(), db_connections: { supabase: true, mongo: false, redis: true } }, botId), 'dependencies');
  assert.equal(validateReadinessPayload({ ...readyPayload(), bot_id: 'sanji' }, botId), 'identity');
});

test('probes protected health and records sanitized readiness', async () => {
  const result = await probeBotReadiness(botId, tokens[botId], urls[botId], mockFetchFor(botId));
  assert.equal(result.ok, true);
  assert.equal(result.stage, 'complete');
  assert.equal(result.classification, 'ok');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.uptimeSeconds, 123);
  assert.equal(result.buildVersion, 'test-version');
  assert.equal(result.gatewayReady, true);
  assert.deepEqual(result.dependencies, { supabase: true, mongo: true, redis: true });
  assert.equal(result.latencyMs >= 0, true);
});

test('increments 1/2/3 misses and resets only after complete recovery', () => {
  let state = initialWatchdogState();
  const failure = {
    botId,
    ok: false,
    stage: 'gateway_readiness',
    classification: 'gateway',
    latencyMs: null,
    httpStatus: null,
    should_trigger_recovery: false,
  };
  for (let miss = 1; miss <= MAX_MISSES; miss += 1) {
    state.bots[botId] = transitionBotState(
      state.bots[botId],
      { ...failure, should_trigger_recovery: miss === MAX_MISSES },
      now,
    );
    assert.equal(state.bots[botId].miss_count, miss);
    assert.equal(state.bots[botId].status, ['warning', 'degraded', 'recovery'][miss - 1]);
  }
  state.bots[botId] = transitionBotState(state.bots[botId], {
    botId,
    ok: true,
    stage: 'complete',
    classification: 'ok',
    latencyMs: 1,
    httpStatus: 200,
    uptimeSeconds: 1,
    buildVersion: 'v1',
    gatewayReady: true,
    dependencies: { supabase: true, mongo: true, redis: true },
    should_trigger_recovery: false,
  }, now);
  assert.equal(state.bots[botId].miss_count, 0);
  assert.equal(state.bots[botId].status, 'healthy');
  assert.equal(state.bots[botId].last_successful_stage, 'complete');
});

test('keeps durable state and audit redacted', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ei-link-watchdog-test-'));
  const statePath = path.join(directory, 'state.json');
  const auditPath = path.join(directory, 'audit.json');
  const result = await runWatchdogCycle({
    tokens,
    urls,
    previousState: initialWatchdogState(),
    fetchImpl: async () => new Response(JSON.stringify({
      bot_id: 'sanji',
      status: 'ok',
      gateway_ready: false,
      guild_lock_ready: true,
      db_connections: { supabase: true, mongo: true, redis: true },
    }), { status: 200 }),
    now,
  });
  writeFileSync(statePath, `${JSON.stringify(result.state)}\n`);
  writeFileSync(auditPath, `${JSON.stringify(result.audit)}\n`);
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  const serialized = `${JSON.stringify(persisted)}${JSON.stringify(audit)}`;
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(urls[botId]), false);
  assert.equal(serialized.includes('guild_lock_ready'), false);
  assert.equal(serialized.includes('sanji-token'), false);
  assert.equal(persisted.bots.sanji.last_failure_stage, 'gateway_readiness');
  assert.equal(audit.events[0].type, 'watchdog_warning');
  rmSync(directory, { recursive: true, force: true });
});

test('recovery is a no-op without explicit credentials', async () => {
  const result = await invokeRecoveryAction(
    { botId, ok: false, stage: 'liveness', classification: 'down' },
    initialWatchdogState().bots[botId],
    { enabled: true, url: 'https://recovery.example/run', token: '' },
    now,
  );
  assert.equal(result.triggered, false);
  assert.equal(result.classification, 'recovery_not_configured');
  assert.equal(result.reason, 'provider credentials absent');
});

test('recovery invokes only with explicit opt-in and valid credentials', async () => {
  let request;
  const result = await invokeRecoveryAction(
    { botId, ok: false, stage: 'liveness', classification: 'down' },
    { timestamp: now.toISOString(), last_failure_stage: 'liveness', error_classification: 'down' },
    {
      enabled: true,
      url: 'https://recovery.example/run',
      token: 'recovery-token',
      allowedHost: 'recovery.example',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      },
    },
    now,
  );
  assert.equal(result.triggered, true);
  assert.equal(result.ok, true);
  assert.equal(result.http_status, 202);
  assert.equal(request.url.toString(), 'https://recovery.example/run');
  assert.equal(request.options.headers.authorization, 'Bearer recovery-token');
  const body = JSON.parse(request.options.body);
  assert.equal(body.bot_id, botId);
  assert.equal(body.consecutive_misses, MAX_MISSES);
  assert.equal(JSON.stringify(body).includes('recovery-token'), false);
});

test('runs the OCI runner with the shared primitives and redacted persistence', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ei-link-oci-test-'));
  const statePath = path.join(directory, 'state.json');
  const auditPath = path.join(directory, 'audit.json');
  const summaryPath = path.join(directory, 'summary.md');
  const env = {
    BOT_HEALTH_TOKENS_JSON: JSON.stringify(tokens),
    ...envUrls,
    WATCHDOG_RECOVERY_ENABLED: 'false',
    WATCHDOG_TIMEOUT_MS: '10000',
    WATCHDOG_AUDIT_RETENTION: '10',
  };
  const result = await runOciWatchdog({
    env,
    fetchImpl: async (url) => new Response(JSON.stringify(readyPayload(new URL(url).hostname.split('.')[0])), { status: 200 }),
    now,
    statePath,
    auditPath,
    summaryPath,
  });
  assert.equal(result.results.length, 8);
  assert.equal(result.results.every((item) => item.ok), true);
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(persisted.version, STATE_VERSION);
  assert.equal(persisted.bots.cyrene.gateway_ready, true);
  assert.equal(JSON.stringify(persisted).includes('sanji-token'), false);
  assert.equal(JSON.stringify(persisted).includes('https://'), false);
  rmSync(directory, { recursive: true, force: true });
});

test('Cloudflare Durable Object runner persists a redacted cycle', async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
  };
  const object = new WatchdogObject({ storage }, {
    BOT_HEALTH_TOKENS_JSON: JSON.stringify(tokens),
    ...envUrls,
    WATCHDOG_RECOVERY_ENABLED: 'false',
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(readyPayload(new URL(url).hostname.split('.')[0])), { status: 200 });
  try {
    const response = await object.fetch(new Request('https://watchdog.internal/run', { method: 'POST' }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ready, 8);
    assert.equal(payload.total, 8);
    const persisted = JSON.parse(JSON.stringify(values.get('watchdog-state-v2')));
    assert.equal(persisted.bots['niko-robin'].gateway_ready, true);
    assert.equal(JSON.stringify(persisted).includes('luffy-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare scheduled handler executes the primary cycle', async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
  };
  const env = {
    WATCHDOG_STATE: {
      idFromName: () => ({ id: 'primary' }),
      get: () => new WatchdogObject({ storage }, {
        BOT_HEALTH_TOKENS_JSON: JSON.stringify(tokens),
        ...envUrls,
        WATCHDOG_RECOVERY_ENABLED: 'false',
      }),
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(readyPayload(new URL(url).hostname.split('.')[0])), { status: 200 });
  try {
    const response = await cloudflareWorker.scheduled({}, env, {});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ready, 8);
    assert.equal(result.total, 8);
    assert.equal(result.status, 'ok');
    assert.equal(values.get('watchdog-audit-v2').events.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('static runner contracts are present without embedded secrets', () => {
  const worker = readFileSync(path.resolve('infra/cloudflare/worker.js'), 'utf8');
  const oci = readFileSync(path.resolve('infra/oci/watchdog.mjs'), 'utf8');
  assert.equal(WATCHDOG_CRON, '*/5 * * * *');
  assert.match(worker, /WATCHDOG_RECOVERY_TOKEN/);
  assert.match(worker, /requiredSecret\(this\.env, 'BOT_HEALTH_TOKENS_JSON'\)/);
  assert.match(oci, /BOT_HEALTH_TOKENS_JSON/);
  assert.match(oci, /WATCHDOG_RECOVERY_ENABLED/);
  assert.match(oci, /WATCHDOG_RECOVERY_TOKEN/);
  assert.doesNotMatch(`${worker}\n${oci}`, /Bearer\s+[A-Za-z0-9_-]{12,}/);
});
