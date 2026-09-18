#!/usr/bin/env node
/**
 * Registers slash commands for all eight bots by reading "temp cred.txt"
 * (gitignored) in-process and injecting each bot's environment IN MEMORY —
 * credentials are never persisted anywhere new and never printed.
 *
 * Usage:
 *   node scripts/deploy-commands-all.mjs            # global registration
 *   node scripts/deploy-commands-all.mjs <botId>    # one bot, global registration
 *
 * Guild registration targets are not configurable. Public commands register
 * globally; development-only commands use the canonical development guild when
 * EIFLOW_ENV=development. The canonical main guild is cleared of stale copies.
 *
 * Reuses each bot's own scripts/deploy-commands.ts via tsx, so per-bot command
 * modules and the shared registerCommands() path stay identical to production.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBotChildEnv } from './bot-env.mjs';
import {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  canonicalId,
  canonicalIdsFrom,
  canonicalRuntimeEnvironment,
} from './canonical-config.mjs';
import { resolveCredential } from './credential-keys.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOTS = ['shanks', 'sanji', 'zoro', 'boahancock', 'nami', 'luffy', 'niko-robin', 'cyrene'];
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('usage: node scripts/deploy-commands-all.mjs [botId]');
  console.log('  Registers public commands globally and canonical development-only commands in development mode.');
  console.log('  Guild registration targets are not configurable.');
  process.exit(0);
}
if (args.length > 1 || args.some((arg) => arg.startsWith('--'))) {
  throw new Error('Guild registration targets are not configurable; commands register globally and use canonical development/main guild IDs only');
}
const only = args[0];
if (only && !BOTS.includes(only)) throw new Error('Unknown bot id');

const raw = readFileSync(path.join(ROOT, 'temp cred.txt'), 'utf8');

function section(headerRe) {
  const m = raw.match(new RegExp(headerRe, 'm'));
  if (!m) return '';
  const rest = raw.slice(m.index + m[0].length);
  const next = rest.search(/^#/m);
  return next === -1 ? rest : rest.slice(0, next);
}
const field = (src, key) => {
  const m = src.match(new RegExp(`${key}="?([^\\n"]+?)"?\\s*$`, 'm'));
  return m ? m[1].trim() : null;
};
const credential = (name, descriptive) => resolveCredential({
  raw,
  name,
  environment: process.env[name],
  descriptive,
});
const canonical = canonicalIdsFrom(raw);

const HEADERS = {
  'niko-robin': 'Niko Robin',
  boahancock: 'Boa hancock',
  nami: 'Nami',
  cyrene: 'Cyrene',
  zoro: 'Zoro',
  shanks: 'Shanks',
  luffy: 'Luffy',
  sanji: 'Sanji',
};

function buildEnv(botId) {
  const sec = section(`^${HEADERS[botId]}\\b`);
  const token = field(sec, 'token');
  const clientId = field(sec, 'application id');
  if (!token || !clientId) throw new Error(`cred file: ${botId} missing token or application id`);
  const own = {
    DISCORD_TOKEN: token,
    DISCORD_CLIENT_ID: clientId,
    BOT_ID: botId,
    BOT_NAME: HEADERS[botId],
    // These canonical IDs let registerCommands() clear stale guild scopes while
    // refusing any caller-supplied guild registration target.
    EIFLOW_ENV: canonicalRuntimeEnvironment(process.env.EIFLOW_ENV),
    DEV_GUILD_ID: canonical.devGuildId,
    MAIN_GUILD_ID: canonical.mainGuildId,
    MONGODB_DB: 'eiflow',
    LOG_LEVEL: 'error',
    ...(botId === 'cyrene' && {
      GROQ_API_KEY: credential('GROQ_API_KEY', /"gpt oss"\s*=\s*(\S+)/),
      MISTRAL_API_KEY: credential('MISTRAL_API_KEY', /"Ministral 3 8B"\s*=\s*(\S+)/),
      AGNES_IMAGE_API_KEY: credential('AGNES_IMAGE_API_KEY'),
      OPENROUTER_API_KEY: credential('OPENROUTER_API_KEY'),
    }),
    ...((botId === 'shanks' || botId === 'zoro') && {
      CEREBRAS_API_KEY: credential('CEREBRAS_API_KEY', /"qwen-3\.8-27b" with limit[^=]*=\s*(\S+)/),
    }),
    ...(botId === 'niko-robin' && {
      MODELSCOPE_API_KEY: credential('MODELSCOPE_API_KEY', /modelscope Qwen\/Qwen3\.5-35B-A3B = (\S+)/),
      BRAVE_SEARCH_API_KEY: credential('BRAVE_SEARCH_API_KEY'),
      SERPAPI_KEY: credential('SERPAPI_KEY'),
    }),
  };
  return createBotChildEnv(process.env, own);
}

canonicalId('DEV_GUILD_ID', canonical.devGuildId, APPROVED_DEVELOPMENT_GUILD_ID);
canonicalId('MAIN_GUILD_ID', canonical.mainGuildId, APPROVED_PRODUCTION_GUILD_ID);

let failed = 0;
for (const botId of BOTS) {
  if (only && botId !== only) continue;
  try {
    const env = buildEnv(botId);
    const argsToRun = ['node_modules/tsx/dist/cli.mjs', `bots/${botId}/scripts/deploy-commands.ts`];
    console.log(`→ ${botId}: registering public commands globally...`);
    const r = spawnSync(process.execPath, argsToRun, { cwd: ROOT, env, encoding: 'utf8' });

    const out = (r.stdout + r.stderr).trim();
    console.log(out ? `  ${out.replace(/\n/g, '\n  ')}` : '  (no output)');
    if (r.status !== 0) {
      failed += 1;
      console.log(`  ✗ ${botId} FAILED (exit ${r.status})`);
    }
  } catch {
    failed += 1;
    console.error(`  ${botId}: registration failed; check its local credentials`);
  }
}
if (failed) {
  console.log(`\n${failed} bot(s) failed`);
  process.exit(1);
}
console.log('\nall bots registered');
