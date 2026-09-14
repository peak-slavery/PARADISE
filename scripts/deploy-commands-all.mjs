#!/usr/bin/env node
/**
 * Registers slash commands for all eight bots by reading "temp cred.txt"
 * (gitignored) in-process and injecting each bot's environment IN MEMORY —
 * credentials are never persisted anywhere new and never printed.
 *
 * Usage:
 *   node scripts/deploy-commands-all.mjs            # global (up to 1h propagate)
 *   node scripts/deploy-commands-all.mjs <botId>    # one bot only
 *   node scripts/deploy-commands-all.mjs --guild    # dev guild instant scope
 *
 * Reuses each bot's own scripts/deploy-commands.ts via tsx, so per-bot command
 * modules and the shared registerCommands() path stay identical to production.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBotChildEnv } from './bot-env.mjs';
import { resolveCredential } from './credential-keys.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const BOTS = ['shanks', 'sanji', 'zoro', 'boahancock', 'nami', 'luffy', 'niko-robin', 'cyrene'];
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
    // Guild IDs are REQUIRED for global deploys: registerCommands() clears
    // dev/main guild scopes so commands never exist in two scopes at once
    // (the source of the "double slash commands" reports).
    DEV_GUILD_ID: field(raw, 'DEV_GUILD_ID') ?? raw.match(/^#dev server=(\d+)/m)?.[1] ?? '',
    MAIN_GUILD_ID: field(raw, 'MAIN_GUILD_ID') ?? raw.match(/^#main server=(\d+)/m)?.[1] ?? '',
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

const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const guildScope = process.argv.includes('--guild');
if (only && !BOTS.includes(only)) throw new Error('Unknown bot id');
const devGuild = raw.match(/^#dev server=(\d+)/m)?.[1];
if (guildScope && !devGuild) throw new Error('cred file: #dev server id missing for --guild scope');

let failed = 0;
for (const botId of BOTS) {
  if (only && botId !== only) continue;
  try {
  const env = buildEnv(botId);
  const args = ['node_modules/tsx/dist/cli.mjs', `bots/${botId}/scripts/deploy-commands.ts`];
  if (guildScope) args.push(devGuild);
  console.log(`→ ${botId}: registering ${guildScope ? `to dev guild ${devGuild}` : 'globally'}…`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8' });
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
