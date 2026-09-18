#!/usr/bin/env node
/**
 * Independent five-minute Ei Flow watchdog.
 *
 * GitHub Actions is the control plane for this probe. The script deliberately
 * keeps tokens, raw response bodies, and response URLs out of state and audit
 * output. It probes the canonical eight-bot order sequentially and persists a
 * small redacted state file that can be restored from an Actions cache.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BOT_META, botIds } from './fleet.mjs';
import {
  MAX_MISSES,
  applyWatchdogResults,
  initialWatchdogState,
  probeBotReadiness,
  redactedAudit,
  summary,
  transitionBotState,
  validateReadinessPayload,
  validateTokenMap,
} from './watchdog-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_BOT_IDS = botIds();
const STATE_VERSION = 2;

function envUrl(id) {
  const envName = `${id.toUpperCase().replace(/-/g, '_')}_URL`;
  return process.env[envName] || BOT_META[id].url;
}

export {
  MAX_MISSES,
  STATE_VERSION,
  applyWatchdogResults,
  initialWatchdogState,
  probeBotReadiness,
  redactedAudit,
  summary,
  transitionBotState,
  validateReadinessPayload,
  validateTokenMap,
};

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function writeText(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function readState(filePath) {
  if (!existsSync(filePath)) return initialWatchdogState(EXPECTED_BOT_IDS);
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !parsed.bots) return initialWatchdogState(EXPECTED_BOT_IDS);
    return parsed;
  } catch {
    return initialWatchdogState(EXPECTED_BOT_IDS);
  }
}

export async function runWatchdog({
  tokens,
  statePath = path.join(ROOT, '.watchdog-state', 'state.json'),
  auditPath = path.join(ROOT, '.watchdog-state', 'audit.json'),
  summaryPath = path.join(ROOT, '.watchdog-state', 'summary.md'),
  now = new Date(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenMap = validateTokenMap(tokens, EXPECTED_BOT_IDS);
  const state = readState(statePath);
  const results = [];
  for (const botId of EXPECTED_BOT_IDS) {
    results.push(await probeBotReadiness(botId, tokenMap[botId], envUrl(botId), fetchImpl));
  }
  const nextState = applyWatchdogResults(state, results, now, EXPECTED_BOT_IDS);
  const audit = redactedAudit(results, nextState, now);
  const summaryText = summary(results, nextState, now);
  writeJsonAtomic(statePath, nextState);
  writeJsonAtomic(auditPath, audit);
  writeText(summaryPath, summaryText);
  return { results, state: nextState, audit, summary: summaryText };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const tokens = JSON.parse(requiredEnv('BOT_HEALTH_TOKENS_JSON'));
  const result = await runWatchdog({ tokens });
  console.log(`watchdog complete: ${result.results.filter((item) => item.ok).length}/${result.results.length} bots ready`);
  if (result.results.some((item) => !item.ok)) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
