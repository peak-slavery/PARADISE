#!/usr/bin/env node
/**
 * Fail-closed daily production monitor.
 *
 * Requires authenticated health endpoints for the dashboard and every bot.
 * Any non-2xx response, missing payload, or failed dependency is an error.
 */
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const services = [
  ['dashboard', required('DASHBOARD_URL'), required('DASHBOARD_HEALTH_TOKEN')],
  ['shanks', required('SHANKS_URL'), required('HEALTH_TOKEN')],
  ['sanji', required('SANJI_URL'), required('HEALTH_TOKEN')],
  ['zoro', required('ZORO_URL'), required('HEALTH_TOKEN')],
  ['boahancock', required('BOAHANCOCK_URL'), required('HEALTH_TOKEN')],
  ['nami', required('NAMI_URL'), required('HEALTH_TOKEN')],
  ['luffy', required('LUFFY_URL'), required('HEALTH_TOKEN')],
  ['niko-robin', required('NIKO_ROBIN_URL'), required('HEALTH_TOKEN')],
  ['cyrene', required('CYRENE_URL'), required('HEALTH_TOKEN')],
];

let failures = 0;
for (const [name, baseUrl, token] of services) {
  try {
    const response = await fetch(name === 'dashboard' ? new URL('/api/health', baseUrl) : new URL('/health', baseUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (payload.status !== 'ok') throw new Error(`status ${payload.status ?? 'unknown'}`);
    const connections = payload.db_connections ?? {};
    for (const dependency of ['supabase', 'mongo', 'redis']) {
      if (connections[dependency] !== true) throw new Error(`${dependency} unavailable`);
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures) {
  console.error(`production monitor failed: ${failures}/${services.length} services degraded`);
  process.exitCode = 1;
} else {
  console.log(`production monitor passed: ${services.length}/${services.length} services ready`);
}
