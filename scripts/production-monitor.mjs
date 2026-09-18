#!/usr/bin/env node
/**
 * Fail-closed production monitor.
 *
 * The dashboard is checked separately from the eight isolated bots. Bot probes
 * run through the independent watchdog so identity, ordered recovery stages,
 * miss progression, and redacted durable state remain consistent.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runWatchdog } from './watchdog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || undefined;
}

async function checkDashboard() {
  try {
    const url = new URL('/api/health', required('DASHBOARD_URL'));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${required('DASHBOARD_HEALTH_TOKEN')}` },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.status !== 'ok') {
      throw new Error(`dashboard readiness HTTP ${response.status}`);
    }
    const connections = payload.db_connections ?? {};
    for (const dependency of ['supabase', 'mongo', 'redis']) {
      if (connections[dependency] !== true) throw new Error(`dashboard ${dependency} unavailable`);
    }
    console.log('PASS dashboard');
    return { ok: true };
  } catch (error) {
    console.error(`FAIL dashboard — ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false };
  }
}

async function main() {
  const dashboard = await checkDashboard();

  const tokenJson = required('BOT_HEALTH_TOKENS_JSON');
  const tokens = JSON.parse(tokenJson);
  const statePath = optional('WATCHDOG_STATE_PATH') ?? path.join(root, '.watchdog-state', 'state.json');
  const auditPath = optional('WATCHDOG_AUDIT_PATH') ?? path.join(root, '.watchdog-state', 'audit.json');
  const summaryPath = optional('WATCHDOG_SUMMARY_PATH') ?? path.join(root, '.watchdog-state', 'summary.md');
  const result = await runWatchdog({ tokens, statePath, auditPath, summaryPath });

  for (const item of result.results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.botId} ${item.stage} ${item.classification}`);
  }

  const failures = result.results.filter((item) => !item.ok);
  if (failures.length || !dashboard.ok) {
    const reason = !dashboard.ok ? 'dashboard unavailable' : `${failures.length}/${result.results.length} bots not ready`;
    console.error(`production monitor failed: ${reason}`);
    process.exitCode = 1;
  } else {
    console.log(`production monitor passed: ${result.results.length}/${result.results.length} bots ready`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
