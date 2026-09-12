#!/usr/bin/env node
/**
 * Local stack status: probes each running bot's own authenticated /health
 * endpoint and prints one summary line per bot. Tokens are read from the
 * gitignored cred file in-process — never printed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(path.join(ROOT, 'temp cred.txt'), 'utf8');

function section(headerRe) {
  const m = raw.match(new RegExp(headerRe, 'm'));
  if (!m) return '';
  const rest = raw.slice(m.index + m[0].length);
  const next = rest.search(/^#/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const BOTS = [
  ['shanks', 'Shanks', 3101],
  ['sanji', 'Sanji', 3102],
  ['zoro', 'Zoro', 3103],
  ['boahancock', 'Boa hancock', 3104],
  ['nami', 'Nami', 3105],
  ['luffy', 'Luffy', 3106],
  ['niko-robin', 'Niko Robin', 3107],
  ['cyrene', 'Cyrene', 3108],
];

let down = 0;
let overBudget = 0;
let totalRam = 0;
const RAM_BUDGET_MB = 500; // Local PM2 restart ceiling and Render per-service target
for (const [id, header, port] of BOTS) {
  const tok = section(`^${header}\\b`).match(/- HEALTH_TOKEN=(\S+)/)?.[1];
  let line = `${id}: `;
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    const db = j.db_connections ?? {};
    line += `status=${j.status} mongo=${db.mongo} redis=${db.redis} supabase=${db.supabase} writes_1h=${j.db_write_count_1h} ram=${j.ram_mb}MB`;
    if (j.status === 'degraded') line += '  (supabase schema pending — expected)';
    if (typeof j.ram_mb === 'number') totalRam += j.ram_mb;
    if (typeof j.ram_mb === 'number' && j.ram_mb > RAM_BUDGET_MB) {
      line += `  ⚠ OVER ${RAM_BUDGET_MB}MB RENDER BUDGET`;
      overBudget += 1;
    }
  } catch (e) {
    line += `DOWN — ${e.message}`;
    down += 1;
  }
  console.log(line);
}
console.log(`stack total RSS: ${Math.round(totalRam)}MB (budget: 8 × ${RAM_BUDGET_MB}MB on Render, one service each)`);
if (down || overBudget) {
  console.log(`\n${down} unreachable, ${overBudget} over RAM budget`);
  process.exit(1);
}
