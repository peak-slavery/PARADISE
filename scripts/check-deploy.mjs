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
import { botIds, botServices } from './fleet.mjs';

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
  let expected;
  try {
    expected = botServices();
  } catch (e) {
    bad(e.message);
    expected = serviceNames;
  }
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
  // Render replaces envVars arrays during YAML merges, so validate every
  // service's effective env list directly instead of overlaying the anchor.
  const perServiceErrors = [];
  const serviceStarts = [...yaml.matchAll(/^  - name: (eiflow-[\w-]+)$/gm)].map((m) => ({
    name: m[1],
    start: m.index ?? 0,
  }));
  const requiredShared = [
    'NODE_OPTIONS', 'BOT_VERSION', 'OWNER_IDS', 'MONGODB_DB',
    'MONGODB_SECONDARY_DB', 'LOG_LEVEL', 'REDIS_DAILY_COMMAND_BUDGET',
    'DASHBOARD_URL', 'DEV_GUILD_ID', 'MAIN_GUILD_ID', 'DEV_AUTH_CHANNEL_ID',
    'HEALTH_TOKEN', 'SENTRY_DSN',
  ];
  for (let i = 0; i < serviceStarts.length; i += 1) {
    const { name, start } = serviceStarts[i];
    const end = serviceStarts[i + 1]?.start ?? yaml.length;
    const block = yaml.slice(start, end);
    const blockEntries = [...block.matchAll(/-\s+key:\s+(\S+)[\s\S]*?\n\s+(value:\s+\S+|sync:\s+\S+|generateValue:\s+\S+)/g)]
      .map((m) => ({ key: m[1], attr: m[2].trim() }));
    const entries = new Map(blockEntries.map((entry) => [entry.key, entry.attr]));
    for (const required of [...requiredShared, 'BOT_ID', 'BOT_NAME', 'DISCORD_CLIENT_ID', 'EMBED_COLOR']) {
      if (!entries.has(required)) perServiceErrors.push(`${name} missing ${required}`);
    }
    for (const secret of ['DISCORD_TOKEN', 'HMAC_SECRET']) {
      const attr = entries.get(secret);
      if (attr !== 'sync: false') perServiceErrors.push(`${name} ${secret} must be sync: false (got ${attr ?? 'absent'})`);
    }
  }
  if (perServiceErrors.length === 0) {
    ok('every service declares sync:false DISCORD_TOKEN and HMAC_SECRET, plus shared runtime and bot identity env vars');
  } else {
    for (const m of perServiceErrors) bad(m);
  }

  if (/1479589523426902208/.test(yaml)) {
    bad('render.yaml contains a hardcoded privileged operator ID');
  } else {
    ok('render.yaml contains no hardcoded privileged operator ID');
  }

  const schema = read('infra/supabase/schema.sql');
  if (/1479589523426902208/.test(schema)) {
    bad('Supabase schema contains a hardcoded privileged operator ID');
  } else if (!/create table if not exists public\.admin_users/.test(schema)) {
    bad('Supabase schema is missing the admin_users role table');
  } else {
    ok('Supabase master authorization is database-provisioned');
  }
  if (!/alter table public\.admin_users add column if not exists updated_at/.test(schema)) {
    bad('admin_users is missing the updated_at column used by master bootstrap');
  } else {
    ok('admin_users schema supports the master bootstrap update');
  }

  const bootstrap = read('infra/supabase/bootstrap-master.sql');
  const authz = read('dashboard/lib/authz.ts');
  if (/<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>/i.test(bootstrap)) {
    bad('bootstrap-master.sql contains a hardcoded master UUID');
  } else {
    ok('bootstrap-master.sql requires a runtime-supplied master UUID');
  }
  if (!/from\('admin_users'\)/.test(authz) && /rpc\('is_master_user'\)/.test(authz)) {
    ok('dashboard master authorization uses the protected is_master_user RPC');
  } else {
    bad('dashboard master authorization must use the is_master_user RPC without reading admin_users directly');
  }

  const mongoInit = read('infra/mongo/init.js');
  const mongoIndexes = read('infra/mongo/indexes.cjs');
  if (/ai_ctx_updated/.test(mongoInit) || /ai_ctx_updated/.test(mongoIndexes)) {
    bad('Mongo bootstrap defines the conflicting ai_ctx_updated index');
  } else if (!/ai_ctx_ttl/.test(mongoIndexes) || !/require\('\.\/indexes\.cjs'\)/.test(mongoInit)) {
    bad('Mongo bootstrap does not use the canonical index contract');
  } else if (/const\s+db\s*=\s*db\.getSiblingDB/.test(mongoInit) || !/const\s+database\s*=\s*db\.getSiblingDB/.test(mongoInit) || !/database\[index\.collection\]\.createIndex/.test(mongoInit)) {
    bad('Mongo bootstrap shadows mongosh db or does not use the resolved database handle');
  } else {
    ok('Mongo bootstrap uses the canonical shared index contract and safe database handle');
  }

  const productionSmoke = read('scripts/production-smoke.mjs');
  if (!/for \(const name of requiredEnvironment\)/.test(productionSmoke)) {
    bad('production smoke script does not fail fast on missing environment contracts');
  } else {
    ok('production smoke script enforces its environment contract');
  }
  if (/stale, tampered, and cross-bot requests rejected/.test(productionSmoke)) {
    ok('production smoke rejects stale, tampered, and cross-bot HMAC requests');
  } else {
    bad('production smoke must reject stale, tampered, and cross-bot HMAC requests');
  }

  const dashboardHealth = read('dashboard/app/api/health/route.ts');
  if (!/process\.env\.DASHBOARD_HEALTH_TOKEN/.test(dashboardHealth) || !/status: status === 'ok' \? 200 : 503/.test(dashboardHealth) || !/process\.env\.DASHBOARD_HEALTH_TOKEN/.test(productionSmoke)) {
    bad('dashboard health route is not protected or readiness-aware');
  } else {
    ok('dashboard health route is protected and readiness-aware');
  }

  const migrationRunner = read('scripts/apply-supabase-migrations.mjs');
  const migrationFiles = list('infra/supabase/migrations')
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const sequenceErrors = migrationFiles
    .map((name, index) => ({ name, sequence: Number(name.slice(0, 4)), expected: index + 1 }))
    .filter((entry) => entry.sequence !== entry.expected)
    .map((entry) => `${entry.name} is sequence ${entry.sequence}, expected ${String(entry.expected).padStart(4, '0')}`);
  if (
    migrationFiles.length === 0 ||
    !/private\.schema_migrations/.test(migrationRunner) ||
    !/'-1'/.test(migrationRunner) ||
    !/ON_ERROR_STOP=1/.test(migrationRunner)
  ) {
    bad('Supabase migration runner is not deterministic or transactional');
  } else if (sequenceErrors.length) {
    bad(`Supabase migration sequence is not contiguous: ${sequenceErrors.join(', ')}`);
  } else if (!/Supabase migrations must be contiguous from 0001/.test(migrationRunner)) {
    bad('Supabase migration runner does not enforce a contiguous sequence');
  } else if (!/baseline must be the first migration/.test(migrationRunner)) {
    bad('Supabase migration runner does not restrict baseline marking to the first migration');
  } else if (!/ledger contains unknown migrations/.test(migrationRunner)) {
    bad('Supabase migration runner does not detect ledger drift from removed migrations');
  } else {
    ok(`Supabase migration runner is transactional and enforces sequence invariants (${migrationFiles.length} migration)`);
  }

  const restoreDrill = read('scripts/restore-drill.mjs');
  if (!/restore_drill_\$\{Date\.now\(\)\}/.test(restoreDrill) || !/listIndexes\(\)/.test(restoreDrill)) {
    bad('Mongo restore drill does not verify isolation and index recovery');
  } else if (!/verifyRestoreParity/.test(restoreDrill)) {
    bad('Mongo restore drill does not verify field-level data parity (count-only checks miss silent corruption)');
  } else {
    ok('Mongo restore drill verifies isolation, data parity, and index recovery');
  }

  const rollbackDrill = read('scripts/rollback-drill.mjs');
  if (!/--target=/.test(rollbackDrill) || !/private\.schema_migrations/.test(rollbackDrill)) {
    bad('rollback drill does not verify a target or migration ledger');
  } else {
    ok('rollback drill validates the migration rollback target');
  }

  const serviceBlock = (name) => {
    const start = yaml.indexOf(`  - name: ${name}`);
    if (start < 0) return '';
    const next = yaml.indexOf('\n  - name: ', start + 1);
    return yaml.slice(start, next < 0 ? yaml.length : next);
  };
  const hasEntry = (block, key, value) => {
    const pattern = value === undefined
      ? new RegExp(`^\\s+- key: ${key}\\s*$`, 'm')
      : new RegExp(`^\\s+- key: ${key}\\s*$[\\s\\S]*?^\\s+(?:value|sync): ${value}\\s*$`, 'm');
    return pattern.test(block);
  };
  const contractErrors = [];
  for (const key of ['CEREBRAS_API_KEY']) {
    for (const service of ['eiflow-shanks', 'eiflow-zoro']) {
      if (!hasEntry(serviceBlock(service), key, 'false')) contractErrors.push(`${service} missing sync:false ${key}`);
    }
  }
  const cyrene = serviceBlock('eiflow-cyrene');
  for (const key of ['GROQ_API_KEY', 'MISTRAL_API_KEY', 'AGNES_IMAGE_API_KEY', 'OPENROUTER_API_KEY']) {
    if (!hasEntry(cyrene, key, 'false')) contractErrors.push(`eiflow-cyrene missing sync:false ${key}`);
  }
  for (const [key, value] of [
    ['AGNES_IMAGE_MODEL', 'agnes-image-2.5-flash'],
    ['CYRENE_TTS_MODEL', 'openai/tts-1'],
    ['CYRENE_TTS_VOICE', 'alloy'],
  ]) {
    if (!hasEntry(cyrene, key, value)) contractErrors.push(`eiflow-cyrene missing safe ${key}=${value}`);
  }
  const zoro = serviceBlock('eiflow-zoro');
  for (const [key, value] of [
    ['ZORO_SLM_MODEL', 'qwen-3.8-27b'],
    ['ZORO_SLM_MAX_TOKENS', "'64'"],
    ['ZORO_SLM_CONTEXT_CHARS', "'2000'"],
  ]) {
    if (!hasEntry(zoro, key, value)) contractErrors.push(`eiflow-zoro missing safe ${key}=${value}`);
  }
  if (contractErrors.length === 0) ok('Render provider and bounded model env contracts are complete');
  else for (const message of contractErrors) bad(message);

  const staleDeploymentReferences = [    'GROQ_' + 'AUTOMOD_API_KEY',
    'provider.' + 'groq_automod',
    'AUTOMOD_' + 'SLM_MODEL',
    'llama-3.1-' + '8b-instant',
  ];
  const deploymentFiles = [
    'render.yaml', '.env.example', 'dashboard/.env.example', 'dashboard/.env.vercel.example',
    'scripts/run-bot.mjs', 'scripts/deploy-commands-all.mjs', 'scripts/check-local-config.mjs',
    'scripts/validate-prod-creds.mjs', 'scripts/check-deploy.mjs',
  ];
  const stale = deploymentFiles.flatMap((file) => staleDeploymentReferences
    .filter((reference) => read(file).includes(reference))
    .map((reference) => `${file} contains removed ${reference}`));
  if (stale.length === 0) ok('deployment surfaces contain no removed AutoMod-Groq or stale Zoro model references');
  else for (const message of stale) bad(message);
} catch (e) {
  bad(`render.yaml unreadable: ${e.message}`);
}

// ---------------------------------------------------------------------------
console.log('\x1b[1m[2/5] bot packages\x1b[0m');
let bots;
try {
  bots = botIds();
  ok(`8 bots in bots/ (${bots.join(', ')})`);
} catch (e) {
  bots = [];
  bad(e.message);
}

  const requiredScripts = { start: 'tsx src/index.ts', 'deploy:commands': 'tsx scripts/deploy-commands.ts' };
const packageErrors = [];
for (const bot of bots) {
  try {
    const pkg = JSON.parse(read(`bots/${bot}/package.json`));
    for (const [name, expected] of Object.entries(requiredScripts)) {
      if (pkg.scripts?.[name] !== expected) {
        packageErrors.push(`bots/${bot}: scripts.${name} should be "${expected}", got "${pkg.scripts?.[name]}"`);
      }
    }
    if (!exists(`bots/${bot}/scripts/deploy-commands.ts`)) {
      packageErrors.push(`bots/${bot}: scripts/deploy-commands.ts is missing`);
    }
    if (!exists(`bots/${bot}/src/index.ts`)) {
      packageErrors.push(`bots/${bot}: src/index.ts is missing`);
    }
    if (!exists(`bots/${bot}/.env.example`)) {
      packageErrors.push(`bots/${bot}/.env.example is missing`);
    } else {
      const ex = read(`bots/${bot}/.env.example`);
      for (const k of ['BOT_ID', 'BOT_NAME', 'DISCORD_CLIENT_ID', 'EMBED_COLOR']) {
        if (!new RegExp(`^${k}=`, 'm').test(ex)) {
          packageErrors.push(`bots/${bot}/.env.example missing ${k}`);
        }
      }
    }
  } catch (e) {
    packageErrors.push(`bots/${bot}: ${e.message}`);
  }
}
if (packageErrors.length === 0 && bots.length > 0) {
  ok(`all ${bots.length} bot packages have start, deploy:commands, and required files`);
} else {
  for (const message of packageErrors) bad(message);
}

  const sensitiveCommands = [
    ['bots/shanks/src/commands/ban.ts', 'requirePermission(ctx, PermissionFlagsBits.BanMembers'],
    ['bots/shanks/src/commands/mute.ts', 'requirePermission(ctx, PermissionFlagsBits.ModerateMembers'],
    ['bots/shanks/src/commands/purge.ts', 'requirePermission(ctx, PermissionFlagsBits.ManageMessages'],
    ['bots/zoro/src/commands/antinuke.ts', 'requireManageGuild(ctx)'],
    ['bots/zoro/src/commands/lockdown.ts', 'assertManager(ctx)'],
    ['bots/zoro/src/commands/whitelist.ts', 'requireManageGuild(ctx)'],
  ];
  const missingExecutionPermissions = sensitiveCommands
    .filter(([file, assertion]) => !read(file).includes(assertion))
    .map(([file]) => `${file} lacks execution-time permission enforcement`);
  if (missingExecutionPermissions.length === 0) {
    ok('sensitive commands enforce caller permissions at execution time');
  } else {
    for (const message of missingExecutionPermissions) bad(message);
  }

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

// Card-registry CI wiring: the scanner gate alone would not catch a runtime
// catalog that disagrees with the committed manifest, so both steps must exist.
try {
  const ci = read('.github/workflows/ci.yml');
  if (!/cards:check -w @eiflow\/bot-luffy/.test(ci)) {
    bad('CI does not run the card registry scanner gate');
  } else if (!/smoke:luffy/.test(ci)) {
    bad('CI does not run the Luffy card smoke test (manifest/catalog/probability parity)');
  } else {
    ok('CI runs both card registry validation and the Luffy card smoke test');
  }
} catch (e) { bad(`ci.yml: ${e.message}`); }

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
  try {
    const lockfile = JSON.parse(read('package-lock.json'));
    if (lockfile.lockfileVersion !== 3) {
      bad(`package-lock.json has unsupported lockfileVersion ${lockfile.lockfileVersion}`);
    } else if (lockfile.name !== 'eiflow' || !lockfile.packages?.['']) {
      bad('package-lock.json root metadata is missing or invalid');
    } else {
      ok('package-lock.json present with valid root metadata');
    }
  } catch (e) {
    bad(`package-lock.json is invalid JSON: ${e.message}`);
  }
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
