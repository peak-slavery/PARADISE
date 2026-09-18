#!/usr/bin/env node
/**
 * Ei Link Watchdog secondary runner for OCI or any independent Node host.
 *
 * The runner uses only runtime environment bindings for secrets and endpoint
 * configuration. It has no embedded bot URLs, tokens, or recovery credentials.
 *
 * Required:
 * - BOT_HEALTH_TOKENS_JSON: exact JSON map for all eight canonical bot IDs
 * - SHANKS_URL, SANJI_URL, ZORO_URL, BOAHANCOCK_URL
 * - NAMI_URL, LUFFY_URL, NIKO_ROBIN_URL, CYRENE_URL
 *
 * Optional recovery (all three are required before a request is sent):
 * - WATCHDOG_RECOVERY_ENABLED=true
 * - WATCHDOG_RECOVERY_URL: HTTPS endpoint
 * - WATCHDOG_RECOVERY_TOKEN: bearer credential
 *
 * Optional bounds: WATCHDOG_TIMEOUT_MS, WATCHDOG_RECOVERY_TIMEOUT_MS, and
 * WATCHDOG_AUDIT_RETENTION. State paths are injection points for the supervisor.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_AUDIT_RETENTION,
  DEFAULT_EXPECTED_BOT_IDS,
  normalizeWatchdogState,
  parseJsonIdentityMap,
  runWatchdogCycle,
  validateBotUrlMap,
} from '../../scripts/watchdog-core.mjs';

const EXPECTED_BOT_IDS = [...DEFAULT_EXPECTED_BOT_IDS];
const STATE_VERSION = 2;

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(env, name) {
  const value = env[name]?.trim();
  return value || '';
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function writeTextAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, value, 'utf8');
  renameSync(temporary, filePath);
}

function healthUrls(env) {
  const urls = {};
  for (const botId of EXPECTED_BOT_IDS) {
    const name = `${botId.toUpperCase().replace(/-/g, '_')}_URL`;
    urls[botId] = requiredEnv(env, name);
  }
  return validateBotUrlMap(urls, EXPECTED_BOT_IDS);
}

function recoveryConfig(env) {
  return {
    enabled: optionalEnv(env, 'WATCHDOG_RECOVERY_ENABLED') === 'true',
    url: optionalEnv(env, 'WATCHDOG_RECOVERY_URL'),
    token: env.WATCHDOG_RECOVERY_TOKEN,
    allowedHost: optionalEnv(env, 'WATCHDOG_RECOVERY_HOST'),
    fetchImpl: globalThis.fetch,
    timeoutMs: positiveInteger(env.WATCHDOG_RECOVERY_TIMEOUT_MS, 10_000),
  };
}

function boundedAudit(previous, current, retention) {
  const events = Array.isArray(previous?.events) ? previous.events : [];
  return {
    generated_at: current.generated_at,
    schema_version: 1,
    events: [...events, ...current.events].slice(-retention),
  };
}

/**
 * Run one bounded watchdog cycle and persist only redacted state and audit data.
 * This function is injectable for tests and reusable by a process supervisor.
 */
export async function runOciWatchdog({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  statePath = '/var/lib/ei-link-watchdog/state.json',
  auditPath = '/var/lib/ei-link-watchdog/audit.json',
  summaryPath = '/var/lib/ei-link-watchdog/summary.md',
} = {}) {
  const tokens = parseJsonIdentityMap(
    requiredEnv(env, 'BOT_HEALTH_TOKENS_JSON'),
    EXPECTED_BOT_IDS,
    'BOT_HEALTH_TOKENS_JSON',
  );
  const urls = healthUrls(env);
  const previousState = parseJsonFile(statePath, null);
  const previousAudit = parseJsonFile(auditPath, { events: [] });
  const normalizedState = normalizeWatchdogState(previousState, EXPECTED_BOT_IDS, now);
  const retention = positiveInteger(
    env.WATCHDOG_AUDIT_RETENTION,
    DEFAULT_AUDIT_RETENTION,
  );
  const timeoutMs = positiveInteger(env.WATCHDOG_TIMEOUT_MS, 10_000);

  const cycle = await runWatchdogCycle({
    expectedBotIds: EXPECTED_BOT_IDS,
    tokens,
    urls,
    previousState: normalizedState,
    fetchImpl,
    recovery: recoveryConfig(env),
    now,
    timeoutMs,
  });
  const nextState = normalizeWatchdogState(cycle.state, EXPECTED_BOT_IDS, now);
  const audit = boundedAudit(previousAudit, cycle.audit, retention);
  nextState.version = STATE_VERSION;
  nextState.updated_at = now.toISOString();

  writeJsonAtomic(statePath, nextState);
  writeJsonAtomic(auditPath, audit);
  writeTextAtomic(summaryPath, cycle.summary);
  return {
    results: cycle.results,
    state: nextState,
    audit,
    summary: cycle.summary,
    recovery: cycle.recovery,
  };
}

function printResult(result) {
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'} ${result.botId} ${result.stage} ${result.classification}`,
  );
}

async function main() {
  const result = await runOciWatchdog();
  for (const item of result.results) printResult(item);
  for (const item of result.recovery) {
    console.log(
      `RECOVERY ${item.botId} ${item.triggered ? (item.ok ? 'accepted' : 'failed') : 'no-op'} ${item.classification}`,
    );
  }
  const ready = result.results.filter((item) => item.ok).length;
  console.log(`watchdog complete: ${ready}/${result.results.length} bots ready`);
  if (ready !== result.results.length) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main().catch((error) => {
    console.error(`watchdog configuration error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
