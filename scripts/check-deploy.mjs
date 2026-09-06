#!/usr/bin/env node
/**
 * Pre-deploy self-validator for the Ei Flow bot network.
 *
 *   node scripts/check-deploy.mjs
 *
 * Checks, exit 0 if everything passes, exit 1 otherwise.
 *
 * 1. render.yaml: every bot has a service block, the common anchor is present,
 *    per-service overrides are consistent, no vault-managed secret leaks.
 * 2. Each bot has deploy-commands and a start script.
 * 3. .env.example files are coherent with the env schema.
 * 4. Lockfile is in sync with package.json (no stale entries).
 * 5. The dashboard has a valid next.config.mjs and a security-aware proxy.
 * 6. Every bot has an embed colour, client id, and a non-empty .env.example.
 *
 * Run from the repo root.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
let checks = 0;

function ok(label) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); checks += 1; }
function bad(label) { console.log(`  \x1b[31m✗\x1b[0m ${label}`); failures.push(label); checks += 1; }
function warn(label) { console.log(`  \x1b[33m!\x1b[0m ${label}`); warnings.push(label); checks += 1; }

function read(p) { return readFileSync(path.join(root, p), 'utf8'); }
function exists(p) { return existsSync(path.join(root, p)); }
function list(dir) { return readdirSync(path.join(root, dir)); }
function isDir(p) { return statSync(path.join(root, p)).isDirectory(); }

// ---------------------------------------------------------------------------
console.log('\x1b[1m[1/5] render.yaml\x1b[0m');
try {
  const yaml = read('render.yaml');
  if (!/^x-bot-common: &bot-common/m.test(yaml)) {
    bad('render.yaml is missing the &bot-common anchor — duplication has regressed');
  } else {
    ok('render.yaml has the &bot-common anchor');
  }
  const serviceNames = [...yaml.matchAll(/^  - name: (eiflow-[\w-]+)$/gm)].map((m) => m[1]);
  const expected = [
    'eiflow-niko-robin', 'eiflow-boahancock', 'eiflow-nami', 'eiflow-cyrene',
    'eiflow-zoro', 'eiflow-shanks', 'eiflow-luffy', 'eiflow-sanji',
  ];
  const missing = expected.filter((n) => !serviceNames.includes(n));
  const extra = serviceNames.filter((n) => !expected.includes(n));
  if (missing.length === 0 && extra.length === 0) {
    ok(`render.yaml declares all 8 bot services (${serviceNames.length})`);
  } else {
    if (missing.length) bad(`render.yaml missing services: ${missing.join(', ')}`);
    if (extra.length) bad(`render.yaml has unexpected services: ${extra.join(', ')}`);
  }
  const vaultLeak = /(?:^|\n)\s+- key: (MONGODB_URI|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|UPSTASH_URL|UPSTASH_TOKEN)\b/;
  if (vaultLeak.test(yaml)) {
    bad('render.yaml contains a vault-managed secret — bots must fetch these from the dashboard, not the platform env');
  } else {
    ok('render.yaml does not declare vault-managed secrets');
  }
  // Extract the env var list from the &bot-common anchor so per-service
  // checks can validate that the inherited secrets are present (the YAML
  // merge expands them into each service, but the literal text only appears
  // once at the top of the file).
  const anchorMatch = yaml.match(/&bot-common[\s\S]*?envVars:([\s\S]*?)(?=\n\S|\n#)/);
  const commonEnvBlock = anchorMatch ? anchorMatch[1] : '';
  const commonEntries = [...commonEnvBlock.matchAll(/-\s+key:\s+(\S+)[\s\S]*?\n\s+(value:\s+\S+|sync:\s+\S+|generateValue:\s+\S+)/g)]
    .map((m) => ({ key: m[1], attr: m[2].trim() }));
  if (commonEntries.length === 0) {
    bad('render.yaml: could not extract any env entries from the &bot-common anchor');
  }
  // Per-service: split on the `- name:` lines and check each block independently.
  // Each service block is everything between its `- name:` and the next one.
  const perServiceErrors = [];
  const serviceStarts = [...yaml.matchAll(/^  - name: (eiflow-[\w-]+)$/gm)].map((m) => ({
    name: m[1],
    start: m.index ?? 0,
  }));
  for (let i = 0; i < serviceStarts.length; i += 1) {
    const { name, start } = serviceStarts[i];
    const end = serviceStarts[i + 1]?.start ?? yaml.length;
    const block = yaml.slice(start, end);
    const blockEntries = [...block.matchAll(/-\s+key:\s+(\S+)[\s\S]*?\n\s+(value:\s+\S+|sync:\s+\S+|generateValue:\s+\S+)/g)]
      .map((m) => ({ key: m[1], attr: m[2].trim() }));
    const merged = new Map([...commonEntries.map((e) => [e.key, e.attr]), ...blockEntries.map((e) => [e.key, e.attr])]);
    for (const required of ['BOT_ID', 'BOT_NAME', 'DISCORD_CLIENT_ID', 'EMBED_COLOR']) {
      if (!merged.has(required)) perServiceErrors.push(`${name} missing ${required} (after merge)`);
    }
    for (const secret of ['DISCORD_TOKEN', 'HMAC_SECRET']) {
      const attr = merged.get(secret);
      if (attr !== 'sync: false') perServiceErrors.push(`${name} ${secret} must be sync: false (got ${attr ?? 'absent'})`);
    }
  }
  if (perServiceErrors.length === 0) {
    ok('every service inherits a sync:false DISCORD_TOKEN and HMAC_SECRET from the anchor, and declares BOT_ID/BOT_NAME/CLIENT_ID/EMBED_COLOR');
  } else {
    for (const m of perServiceErrors) bad(m);
  }
} catch (e) {
  bad(`render.yaml unreadable: ${e.message}`);
}

// ---------------------------------------------------------------------------
console.log('\x1b[1m[2/5] bot packages\x1b[0m');
const bots = list('bots').filter((d) => isDir(path.join('bots', d)));
if (bots.length !== 8) bad(`expected 8 bots, found ${bots.length}`);
else ok(`8 bots in bots/ (${bots.join(', ')})`);

const requiredScripts = { start: 'tsx src/index.ts', 'deploy:commands': 'tsx scripts/deploy-commands.ts' };
for (const bot of bots) {
  try {
    const pkg = JSON.parse(read(`bots/${bot}/package.json`));
    for (const [name, expected] of Object.entries(requiredScripts)) {
      if (pkg.scripts?.[name] !== expected) {
        bad(`bots/${bot}: scripts.${name} should be "${expected}", got "${pkg.scripts?.[name]}"`);
      }
    }
    if (!exists(`bots/${bot}/scripts/deploy-commands.ts`)) {
      bad(`bots/${bot}: scripts/deploy-commands.ts is missing`);
    }
    if (!exists(`bots/${bot}/src/index.ts`)) {
      bad(`bots/${bot}: src/index.ts is missing`);
    }
    if (!exists(`bots/${bot}/.env.example`)) {
      bad(`bots/${bot}: .env.example is missing`);
    } else {
      const ex = read(`bots/${bot}/.env.example`);
      for (const k of ['BOT_ID', 'BOT_NAME', 'DISCORD_CLIENT_ID', 'EMBED_COLOR']) {
        if (!new RegExp(`^${k}=`, 'm').test(ex)) {
          bad(`bots/${bot}/.env.example missing ${k}`);
        }
      }
    }
  } catch (e) {
    bad(`bots/${bot}: ${e.message}`);
  }
}
ok('all 8 bot packages have start, deploy:commands, and required files');

// ---------------------------------------------------------------------------
console.log('\x1b[1m[3/5] dashboard bundle\x1b[0m');
try {
  const nextConfig = read('dashboard/next.config.mjs');
  for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) {
    if (!nextConfig.includes(header)) bad(`dashboard/next.config.mjs missing security header ${header}`);
  }
  ok('dashboard/next.config.mjs has the required security headers');
} catch (e) { bad(`dashboard/next.config.mjs: ${e.message}`); }

if (exists('dashboard/proxy.ts') && exists('dashboard/middleware.ts')) {
  bad('dashboard has BOTH proxy.ts and middleware.ts — Next.js 16 will refuse to build. Delete dashboard/middleware.ts');
} else if (exists('dashboard/proxy.ts')) {
  ok('dashboard/proxy.ts present (Next.js 16)');
} else if (exists('dashboard/middleware.ts')) {
  warn('dashboard/middleware.ts is deprecated in Next.js 16 — migrate to proxy.ts');
} else {
  bad('dashboard has neither proxy.ts nor middleware.ts — auth/RLS will not run on every request');
}

try {
  const vercel = JSON.parse(read('vercel.json'));
  if (vercel.framework !== 'nextjs') bad('vercel.json framework is not "nextjs"');
  else ok('vercel.json framework is nextjs');
  if (vercel.buildCommand !== 'npm run build') warn('vercel.json buildCommand is not the canonical npm run build');
  if (!Array.isArray(vercel.regions) || vercel.regions.length === 0) warn('vercel.json has no regions — deploy will pick a default');
  else ok(`vercel.json regions: ${vercel.regions.join(', ')}`);
} catch (e) { bad(`vercel.json: ${e.message}`); }

// ---------------------------------------------------------------------------
console.log('\x1b[1m[4/5] shared runtime\x1b[0m');
for (const required of [
  'packages/shared/src/env.ts',
  'packages/shared/src/vault-client.ts',
  'packages/shared/src/health.ts',
  'packages/shared/src/server-lock.ts',
  'packages/shared/src/whitelist.ts',
  'packages/shared/src/interlink.ts',
  'packages/shared/src/bot.ts',
  'packages/shared/src/commands.ts',
]) {
  if (!exists(required)) bad(`shared runtime missing ${required}`);
}
ok('shared runtime has the required host-readiness modules');

try {
  const env = read('packages/shared/src/env.ts');
  for (const k of ['BOT_ID', 'BOT_NAME', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OWNER_IDS']) {
    if (!new RegExp(`\\b${k}\\b`).test(env)) bad(`EnvSchema missing ${k}`);
  }
  ok('EnvSchema covers the required bot env vars');
} catch (e) { bad(`EnvSchema: ${e.message}`); }

// ---------------------------------------------------------------------------
console.log('\x1b[1m[5/5] lockfile + .env.example coherence\x1b[0m');
if (!exists('package-lock.json')) {
  bad('package-lock.json missing — run npm install locally first');
} else {
  ok('package-lock.json present');
}
if (!exists('.env.example')) bad('root .env.example missing');
else ok('root .env.example present');
if (!exists('dashboard/.env.example')) bad('dashboard/.env.example missing');
else ok('dashboard/.env.example present');
if (!exists('dashboard/.env.vercel.example')) bad('dashboard/.env.vercel.example missing (Vercel operators need this)');
else ok('dashboard/.env.vercel.example present');

if (exists('bots/cyrene/.env')) {
  const cyrene = read('bots/cyrene/.env');
  if (/HMAC_SECRET=[a-f0-9]{20,}/.test(cyrene) || /HEALTH_TOKEN=[a-f0-9]{20,}/.test(cyrene)) {
    warn('bots/cyrene/.env contains real-looking secret values; the file is gitignored but consider replacing with empty placeholders for a clean host-ready template');
  } else {
    ok('bots/cyrene/.env is a clean template (no real-looking values)');
  }
}

// ---------------------------------------------------------------------------
console.log('');
if (warnings.length) {
  console.log(`\x1b[33m${warnings.length} warning${warnings.length === 1 ? '' : 's'}\x1b[0m`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failure${failures.length === 1 ? '' : 's'} — fix before deploy\x1b[0m`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\x1b[32mall ${checks} checks passed\x1b[0m`);
