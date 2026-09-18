#!/usr/bin/env node
/**
 * Transport-neutral Ei Link Watchdog primitives.
 *
 * This module has no Node-only imports so the Cloudflare Worker and OCI runner
 * share identical authorization, readiness, miss progression, recovery, and
 * redaction rules.
 */

export const DEFAULT_EXPECTED_BOT_IDS = Object.freeze([
  'shanks',
  'sanji',
  'zoro',
  'boahancock',
  'nami',
  'luffy',
  'niko-robin',
  'cyrene',
]);

export const STATE_VERSION = 2;
export const MAX_MISSES = 3;
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
export const DEFAULT_AUDIT_RETENTION = 100;

const STATUS_BY_MISSES = Object.freeze({
  0: 'healthy',
  1: 'warning',
  2: 'degraded',
  3: 'recovery',
});
const MAX_HEALTH_RESPONSE_BYTES = 16_384;
const MAX_SAFE_TEXT_LENGTH = 128;

function assertExpectedBotIds(expectedBotIds) {
  if (
    !Array.isArray(expectedBotIds)
    || expectedBotIds.length === 0
    || new Set(expectedBotIds).size !== expectedBotIds.length
    || expectedBotIds.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    throw new Error('expected bot identity list is invalid');
  }
}

function exactIdentityMap(value, expectedBotIds, label) {
  assertExpectedBotIds(expectedBotIds);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const expected = [...expectedBotIds].sort();
  const actual = Object.keys(value).sort();
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  if (missing.length || extra.length) {
    const reasons = [];
    if (missing.length) reasons.push(`missing bot identities: ${missing.join(', ')}`);
    if (extra.length) reasons.push(`unexpected bot identities: ${extra.join(', ')}`);
    throw new Error(`${label} does not match the fleet (${reasons.join('; ')})`);
  }
}

export function validateTokenMap(value, expectedBotIds = DEFAULT_EXPECTED_BOT_IDS) {
  exactIdentityMap(value, expectedBotIds, 'health token map');
  for (const id of expectedBotIds) {
    if (
      typeof value[id] !== 'string'
      || value[id].length === 0
      || value[id].length > 4_096
    ) {
      throw new Error(`health token for ${id} is missing or invalid`);
    }
  }
  return { ...value };
}

export function parseJsonIdentityMap(
  value,
  expectedBotIds = DEFAULT_EXPECTED_BOT_IDS,
  label = 'identity map',
) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
  const validated = validateTokenMap(parsed, expectedBotIds);
  if (label !== 'health token map') {
    exactIdentityMap(validated, expectedBotIds, label);
  }
  return validated;
}

function secureHealthUrl(value, id) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new Error(`health URL for ${id} is missing or invalid`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`health URL for ${id} is invalid`);
  }
  if (
    parsed.protocol !== 'https:'
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new Error(`health URL for ${id} must be HTTPS without credentials`);
  }
  return parsed.toString();
}

export function validateBotUrlMap(value, expectedBotIds = DEFAULT_EXPECTED_BOT_IDS) {
  exactIdentityMap(value, expectedBotIds, 'health URL map');
  const normalized = {};
  for (const id of expectedBotIds) {
    normalized[id] = secureHealthUrl(value[id], id);
  }
  return normalized;
}

function safeText(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > MAX_SAFE_TEXT_LENGTH ? fallback : trimmed;
}

function safeLatency(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeUptime(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeDependencies(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dependencies = {};
  for (const name of ['supabase', 'mongo', 'redis']) {
    dependencies[name] = value[name] === true;
  }
  return dependencies;
}

function emptyBotState() {
  return {
    status: STATUS_BY_MISSES[0],
    miss_count: 0,
    last_successful_stage: null,
    last_failure_stage: null,
    timestamp: null,
    latency_ms: null,
    http_status: null,
    uptime_seconds: null,
    gateway_ready: null,
    guild_lock_ready: null,
    build_version: null,
    dependencies: null,
    error_classification: null,
    recovery_action_triggered: false,
    last_recovery_attempt_at: null,
    last_recovery_status: null,
  };
}

function normalizeBotState(value, now = new Date()) {
  const current = value && typeof value === 'object' ? value : {};
  const missCount = Math.min(
    MAX_MISSES,
    Math.max(0, Number.isInteger(current.miss_count) ? current.miss_count : 0),
  );
  return {
    ...emptyBotState(),
    ...current,
    status: STATUS_BY_MISSES[missCount],
    miss_count: missCount,
    last_successful_stage: safeText(current.last_successful_stage),
    last_failure_stage: safeText(current.last_failure_stage),
    timestamp: typeof current.timestamp === 'string' ? current.timestamp : null,
    latency_ms: safeLatency(current.latency_ms),
    http_status: safeHttpStatus(current.http_status),
    uptime_seconds: safeUptime(current.uptime_seconds),
    gateway_ready: typeof current.gateway_ready === 'boolean' ? current.gateway_ready : null,
    guild_lock_ready: typeof current.guild_lock_ready === 'boolean'
      ? current.guild_lock_ready
      : null,
    build_version: safeText(current.build_version),
    dependencies: safeDependencies(current.dependencies),
    error_classification: safeText(current.error_classification, 'unknown'),
    recovery_action_triggered: current.recovery_action_triggered === true,
    last_recovery_attempt_at: typeof current.last_recovery_attempt_at === 'string'
      ? current.last_recovery_attempt_at
      : null,
    last_recovery_status: safeText(current.last_recovery_status),
    observed_at: typeof current.observed_at === 'string'
      ? current.observed_at
      : now.toISOString(),
  };
}

export function initialWatchdogState(
  expectedBotIds = DEFAULT_EXPECTED_BOT_IDS,
  now = new Date(),
) {
  assertExpectedBotIds(expectedBotIds);
  const timestamp = now.toISOString();
  return {
    version: STATE_VERSION,
    updated_at: timestamp,
    bots: Object.fromEntries(expectedBotIds.map((id) => [id, {
      ...emptyBotState(),
      observed_at: timestamp,
    }])),
  };
}

export function normalizeWatchdogState(
  state,
  expectedBotIds = DEFAULT_EXPECTED_BOT_IDS,
  now = new Date(),
) {
  assertExpectedBotIds(expectedBotIds);
  if (
    !state
    || state.version !== STATE_VERSION
    || !state.bots
    || typeof state.bots !== 'object'
  ) {
    return initialWatchdogState(expectedBotIds, now);
  }
  const timestamp = typeof state.updated_at === 'string'
    ? state.updated_at
    : now.toISOString();
  return {
    version: STATE_VERSION,
    updated_at: timestamp,
    bots: Object.fromEntries(expectedBotIds.map((id) => [
      id,
      normalizeBotState(state.bots[id], now),
    ])),
  };
}

export function transitionBotState(previousBotState, result, now = new Date()) {
  const current = normalizeBotState(previousBotState);
  const timestamp = now.toISOString();
  if (result?.ok === true) {
    return {
      ...current,
      status: STATUS_BY_MISSES[0],
      miss_count: 0,
      last_successful_stage: 'complete',
      last_failure_stage: null,
      timestamp,
      latency_ms: safeLatency(result.latencyMs),
      http_status: safeHttpStatus(result.httpStatus),
      uptime_seconds: safeUptime(result.uptimeSeconds),
      gateway_ready: result.gatewayReady === true,
      guild_lock_ready: result.guildLockReady === true,
      build_version: safeText(result.buildVersion, current.build_version),
      dependencies: safeDependencies(result.dependencies),
      error_classification: 'ok',
      recovery_action_triggered: false,
      last_recovery_status: 'recovered',
      observed_at: timestamp,
    };
  }

  const previousMisses = current.miss_count;
  const missCount = Math.min(MAX_MISSES, previousMisses + 1);
  return {
    ...current,
    status: STATUS_BY_MISSES[missCount],
    miss_count: missCount,
    last_successful_stage: current.last_successful_stage,
    last_failure_stage: safeText(result?.stage, 'unknown'),
    timestamp,
    latency_ms: safeLatency(result?.latencyMs) ?? current.latency_ms,
    http_status: safeHttpStatus(result?.httpStatus) ?? current.http_status,
    uptime_seconds: safeUptime(result?.uptimeSeconds) ?? current.uptime_seconds,
    gateway_ready: typeof result?.gatewayReady === 'boolean'
      ? result.gatewayReady
      : current.gateway_ready,
    build_version: safeText(result?.buildVersion, current.build_version),
    dependencies: safeDependencies(result?.dependencies) ?? current.dependencies,
    error_classification: safeText(result?.classification, 'unknown'),
    recovery_action_triggered: current.recovery_action_triggered,
    observed_at: timestamp,
    should_trigger_recovery: previousMisses < MAX_MISSES && missCount === MAX_MISSES,
  };
}

export function applyWatchdogResults(
  state,
  results,
  now = new Date(),
  expectedBotIds = DEFAULT_EXPECTED_BOT_IDS,
) {
  assertExpectedBotIds(expectedBotIds);
  const normalized = normalizeWatchdogState(state, expectedBotIds, now);
  const seen = new Set();
  for (const result of results) {
    if (
      !result
      || !expectedBotIds.includes(result.botId)
      || seen.has(result.botId)
    ) {
      throw new Error('watchdog results must contain each expected bot identity exactly once');
    }
    seen.add(result.botId);
    normalized.bots[result.botId] = transitionBotState(
      normalized.bots[result.botId],
      result,
      now,
    );
  }
  if (seen.size !== expectedBotIds.length) {
    throw new Error('watchdog results must contain each expected bot identity exactly once');
  }
  normalized.updated_at = now.toISOString();
  return normalized;
}

function safeFailure(error, fallback = 'network') {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid|malformed|missing|unexpected/i.test(message)) return 'invalid_contract';
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  if (/fetch|network|connection|socket|load failed/i.test(message)) return 'network';
  return fallback;
}

async function readBoundedResponseText(
  response,
  maximumBytes = MAX_HEALTH_RESPONSE_BYTES,
) {
  const contentLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function parsePayload(response) {
  const text = await readBoundedResponseText(response).catch(() => null);
  if (text === null) return null;
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function validateReadinessPayload(payload, botId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'health_payload';
  }
  if (payload.bot_id !== botId) return 'identity';
  if (payload.status !== 'ok') return 'dependencies';
  if (payload.gateway_ready !== true) return 'gateway_readiness';
  if (payload.guild_lock_ready !== true) return 'guild_lock_readiness';
  const connections = payload.db_connections;
  if (!connections || typeof connections !== 'object' || Array.isArray(connections)) {
    return 'dependencies';
  }
  for (const dependency of ['supabase', 'mongo', 'redis']) {
    if (connections[dependency] !== true) return 'dependencies';
  }
  if (!Number.isFinite(payload.uptime) || payload.uptime < 0) return 'health_payload';
  if (typeof payload.version !== 'string' || payload.version.trim().length === 0) {
    return 'health_payload';
  }
  return null;
}

/**
 * Probe one bot. Only sanitized result fields are returned; tokens, URLs, raw
 * response bodies, and raw dependency errors are deliberately excluded.
 */
export async function probeBotReadiness(
  botId,
  token,
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');
  if (typeof botId !== 'string' || botId.length === 0) throw new Error('bot identity is invalid');
  if (typeof token !== 'string' || token.length === 0) throw new Error('health token is invalid');
  const url = new URL('/health', secureHealthUrl(baseUrl, botId));
  const timeout = Math.min(
    15_000,
    Math.max(1_000, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS),
  );
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return {
      botId,
      ok: false,
      stage: 'liveness',
      classification: safeFailure(error, 'network'),
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
      should_trigger_recovery: false,
    };
  }

  const latencyMs = Date.now() - startedAt;
  const httpStatus = safeHttpStatus(response.status);
  if (response.status === 401 || response.status === 403) {
    return {
      botId,
      ok: false,
      stage: 'authorization',
      classification: 'auth_failed',
      latencyMs,
      httpStatus,
      should_trigger_recovery: false,
    };
  }

  const payload = await parsePayload(response);
  const common = {
    botId,
    latencyMs,
    httpStatus,
    uptimeSeconds: payload && Number.isFinite(payload.uptime)
      ? Math.floor(payload.uptime)
      : null,
    buildVersion: payload?.version,
    gatewayReady: payload?.gateway_ready === true,
    guildLockReady: payload?.guild_lock_ready === true,
    dependencies: payload?.db_connections,
    should_trigger_recovery: false,
  };
  if (response.status < 200 || response.status >= 300) {
    return {
      ...common,
      ok: false,
      stage: 'liveness',
      classification: response.status === 503 ? 'degraded' : 'unavailable',
    };
  }
  if (!payload) {
    return {
      ...common,
      ok: false,
      stage: 'health_payload',
      classification: 'invalid_contract',
    };
  }

  const failedStage = validateReadinessPayload(payload, botId);
  if (failedStage) {
    const classification = {
      identity: 'identity',
      gateway_readiness: 'gateway',
      guild_lock_readiness: 'guild_lock',
      dependencies: 'dependencies',
      health_payload: 'invalid_contract',
    }[failedStage] ?? 'invalid_contract';
    return {
      ...common,
      ok: false,
      stage: failedStage,
      classification,
    };
  }

  return {
    botId,
    ok: true,
    stage: 'complete',
    classification: 'ok',
    ...common,
  };
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ei-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function recoveryNoOp(classification, reason) {
  return {
    triggered: false,
    ok: false,
    classification,
    reason,
    http_status: null,
    request_id: requestId(),
  };
}

/**
 * Invoke a recovery hook only when it is explicitly enabled and has both an
 * HTTPS endpoint and a credential. Missing provider credentials always no-op.
 */
export async function invokeRecoveryAction(
  result,
  stateBot,
  recovery = null,
  now = new Date(),
) {
  const enabled = recovery?.enabled === true;
  const url = typeof recovery?.url === 'string' ? recovery.url : '';
  const token = typeof recovery?.token === 'string' ? recovery.token : '';
  const allowedHost = typeof recovery?.allowedHost === 'string'
    ? recovery.allowedHost.trim()
    : '';
  if (!enabled || !url || !token || !allowedHost) {
    return recoveryNoOp(
      'recovery_not_configured',
      !enabled
        ? 'disabled'
        : (!token || !allowedHost ? 'provider credentials absent' : 'recovery contract incomplete'),
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return recoveryNoOp('recovery_invalid_contract', 'endpoint invalid');
  }
  if (
    parsedUrl.protocol !== 'https:'
    || !parsedUrl.hostname
    || parsedUrl.hostname.endsWith('.localhost')
    || parsedUrl.hostname === 'localhost'
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.hash
    || (allowedHost && parsedUrl.hostname.toLowerCase() !== allowedHost.toLowerCase())
  ) {
    return recoveryNoOp('recovery_invalid_contract', 'endpoint invalid');
  }

  const startedAt = Date.now();
  const id = requestId();
  const body = JSON.stringify({
    schema_version: 1,
    event_type: 'ei_link_watchdog_third_miss',
    request_id: id,
    bot_id: result.botId,
    detected_at: stateBot.timestamp ?? now.toISOString(),
    consecutive_misses: MAX_MISSES,
    failed_stage: stateBot.last_failure_stage,
    error_classification: stateBot.error_classification,
  });
  const timeout = Math.min(
    10_000,
    Math.max(1_000, Number(recovery.timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS),
  );
  try {
    const response = await recovery.fetchImpl(parsedUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    await readBoundedResponseText(response).catch(() => undefined);
    const accepted = response.status >= 200 && response.status < 300;
    return {
      triggered: true,
      ok: accepted,
      classification: accepted ? 'recovery_accepted' : 'recovery_rejected',
      reason: null,
      http_status: safeHttpStatus(response.status),
      request_id: id,
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      triggered: true,
      ok: false,
      classification: safeFailure(error, 'recovery_network'),
      reason: null,
      http_status: null,
      request_id: id,
      latency_ms: Date.now() - startedAt,
    };
  }
}

export async function runWatchdogCycle({
  expectedBotIds = DEFAULT_EXPECTED_BOT_IDS,
  tokens,
  urls,
  previousState,
  fetchImpl = globalThis.fetch,
  recovery = null,
  now = new Date(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  assertExpectedBotIds(expectedBotIds);
  const tokenMap = validateTokenMap(tokens, expectedBotIds);
  const urlMap = validateBotUrlMap(urls, expectedBotIds);
  const state = normalizeWatchdogState(previousState, expectedBotIds, now);
  const results = [];
  for (const botId of expectedBotIds) {
    try {
      results.push(await probeBotReadiness(
        botId,
        tokenMap[botId],
        urlMap[botId],
        fetchImpl,
        timeoutMs,
      ));
    } catch (error) {
      results.push({
        botId,
        ok: false,
        stage: 'invalid_contract',
        classification: safeFailure(error, 'invalid_contract'),
        latencyMs: null,
        httpStatus: null,
        should_trigger_recovery: false,
      });
    }
  }

  const nextState = applyWatchdogResults(state, results, now, expectedBotIds);
  const recoveryOutcomes = [];
  for (const result of results) {
    if (!result.should_trigger_recovery) continue;
    const outcome = await invokeRecoveryAction(
      result,
      nextState.bots[result.botId],
      recovery,
      now,
    );
    recoveryOutcomes.push({ botId: result.botId, ...outcome });
    const botState = nextState.bots[result.botId];
    botState.recovery_action_triggered = outcome.triggered;
    botState.last_recovery_attempt_at = outcome.triggered ? now.toISOString() : null;
    botState.last_recovery_status = outcome.classification;
  }

  return {
    results,
    state: nextState,
    audit: redactedAudit(results, nextState, now, recoveryOutcomes),
    summary: summary(results, nextState, now),
    recovery: recoveryOutcomes,
  };
}

export function redactedAudit(
  results,
  state,
  now = new Date(),
  recoveryOutcomes = [],
) {
  const recoveryByBot = new Map(
    recoveryOutcomes.map((item) => [item.botId, item]),
  );
  const events = [];
  for (const result of results) {
    const botState = state?.bots?.[result.botId];
    if (!botState || botState.miss_count === 0) continue;
    const recovery = recoveryByBot.get(result.botId);
    events.push({
      type: `watchdog_${botState.status}`,
      bot_id: result.botId,
      timestamp: botState.timestamp ?? now.toISOString(),
      failed_stage: botState.last_failure_stage,
      error_classification: botState.error_classification,
      consecutive_misses: botState.miss_count,
      recovery_action: recovery
        ? (recovery.triggered ? (recovery.ok ? 'accepted' : 'failed') : 'no_op')
        : 'not_required',
      recovery_classification: recovery?.classification ?? null,
    });
  }
  return {
    generated_at: now.toISOString(),
    schema_version: 1,
    events,
  };
}

export function summary(results, state, now = new Date()) {
  const lines = [
    '# Ei Link Watchdog',
    '',
    `Generated: ${now.toISOString()}`,
    '',
    '| Bot | Status | Stage | Misses | HTTP | Gateway | Version |',
    '|---|---|---|---:|---:|---|---|',
  ];
  for (const result of results) {
    const botState = state?.bots?.[result.botId] ?? {};
    lines.push([
      `| ${result.botId}`,
      botState.status ?? 'unknown',
      result.stage,
      botState.miss_count ?? 0,
      botState.http_status ?? '-',
      botState.gateway_ready === true ? 'ready' : 'not-ready',
      botState.build_version ?? '-',
    ].join(' | '));
  }
  lines.push('');
  lines.push('Tokens, URLs, response bodies, and raw dependency errors are intentionally omitted.');
  return `${lines.join('\n')}\n`;
}
