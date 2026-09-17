#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pm2 = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
const services = [
  'paradise-dashboard',
  'paradise-shanks',
  'paradise-sanji',
  'paradise-zoro',
  'paradise-boahancock',
  'paradise-nami',
  'paradise-luffy',
  'paradise-niko-robin',
  'paradise-cyrene',
];
const ports = [3000, 3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108];
// The dashboard runs `next dev`, which compiles 24 routes on the first request.
// Starting it alongside eight bots makes that cold compile slow, so it gets its
// own budget; bots only need to boot a process and bind a port.
const dashboardTimeoutMs = 240_000;
const botTimeoutMs = 120_000;
const pollMs = 2_000;
// Keep each attempt short so one slow request cannot consume the whole budget.
const requestTimeoutMs = 15_000;

function run(args, options = {}) {
  return execFileSync(pm2, args, {
    cwd: root,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

function currentNames() {
  try {
    const rows = JSON.parse(run(['jlist']));
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function localServiceSummary() {
  const rows = JSON.parse(run(['jlist']));
  return rows
    .filter((row) => services.includes(row.name))
    .map((row) => ({ name: row.name, status: row.pm2_env?.status, pid: row.pid }));
}

function cleanup() {
  try {
    run(['delete', ...services], { stdio: 'inherit' });
  } catch {
    // Cleanup is best effort; the final PM2 status check reports leftovers.
  }
  const leftovers = [...currentNames()].filter((name) => services.includes(name));
  if (leftovers.length) {
    throw new Error(`Local PM2 cleanup incomplete: ${leftovers.join(', ')}`);
  }
}

async function waitFor(url, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`${url} did not become ready within ${budgetMs / 1000}s (${lastError})`);
}

const occupied = [...currentNames()].filter((name) => services.includes(name));
if (occupied.length) {
  console.error(`Refusing to start: PM2 already owns ${occupied.join(', ')}`);
  process.exitCode = 2;
} else {
  let started = true;
try {
  run(['start', 'ecosystem.config.cjs'], { stdio: 'inherit' });
  await waitFor('http://127.0.0.1:3000/', dashboardTimeoutMs);
  for (const port of ports.slice(1)) await waitFor(`http://127.0.0.1:${port}/health`, botTimeoutMs);
  console.log(JSON.stringify(localServiceSummary(), null, 2));
  console.log('Local PM2 smoke test passed. Services are localhost-only test processes.');
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (started) cleanup();
}
}
