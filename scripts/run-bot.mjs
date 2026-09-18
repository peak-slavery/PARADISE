#!/usr/bin/env node
/**
 * Local production bot launcher. Reads "temp cred.txt" (gitignored) and
 * injects the bot's environment IN MEMORY at spawn time — credentials are
 * never persisted anywhere new and never printed. Usage:
 *
 *   node scripts/run-bot.mjs <botId>
 *
 * With no botId, lists the eight bot ids and their ports. Bots write logs to
 * $CLAUDE_JOB_DIR/tmp/bot-logs/<botId>.log (job-scoped, auto-cleaned).
 */
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBotChildEnv } from './bot-env.mjs';
import { resolveCredential } from './credential-keys.mjs';
import {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  MASTER_OPERATOR_DISCORD_ID,
  canonicalId,
  canonicalIdsFrom,
  canonicalRuntimeEnvironment,
  canonicalSnowflake,
} from './canonical-config.mjs';

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
const kv = (key) => process.env[key]?.trim() || field(raw, key);
const credential = (name, descriptive) => resolveCredential({
  raw,
  name,
  environment: process.env[name],
  descriptive,
});

const BOT_IDS = ['shanks','sanji','zoro','boahancock','nami','luffy','niko-robin','cyrene'];
const PORT_BASE = 3100; // shanks=3101 ... cyrene=3108
const canonical = canonicalIdsFrom(raw);

function botSection(botId) {
  const headers = {
    'niko-robin': 'Niko Robin',
    boahancock: 'Boa hancock',
    nami: 'Nami',
    cyrene: 'Cyrene',
    zoro: 'Zoro',
    shanks: 'Shanks',
    luffy: 'Luffy',
    sanji: 'Sanji',
  };
  return section(`^${headers[botId]}\\b`);
}

function buildEnv(botId, port) {
  const sec = botSection(botId);
  const required = {
    token: ['DISCORD_TOKEN', 'token'],
    clientId: ['DISCORD_CLIENT_ID', 'application id'],
    hmac: ['HMAC_SECRET', 'HMAC_SECRET'],
    healthToken: ['HEALTH_TOKEN', 'HEALTH_TOKEN'],
    embedColor: ['EMBED_COLOR', 'EMBED_COLOR'],
  };
  const vals = {};
  for (const [k, [name, label]] of Object.entries(required)) {
    const value = resolveCredential({ raw: sec, name, environment: process.env[name], descriptive: new RegExp(`${label}=?\\s*([^\\n]+)`, 'i') });
    if (!value) throw new Error(`cred file: ${botId} missing ${label}`);
    vals[k] = value;
  }
  const MONGO_PRIMARY = section('#\\s*primary mongo db');
  const MONGO_SECONDARY = section('#\\s*mongodb 2');
  const own = {
    BOT_ID: botId,
    BOT_NAME: botId.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join(' '),
    BOT_VERSION: '1.0.0',
    EMBED_COLOR: vals.embedColor,
    DISCORD_TOKEN: vals.token,
    DISCORD_CLIENT_ID: vals.clientId,
    HMAC_SECRET: vals.hmac,
    HEALTH_TOKEN: vals.healthToken,
    OWNER_IDS: process.env.OWNER_IDS || '',
    MASTER_DISCORD_ID: canonical.masterDiscordId,
    DASHBOARD_URL: process.env.DASHBOARD_URL || 'https://ei-point-dashboard.vercel.app',
    EIFLOW_ENV: canonicalRuntimeEnvironment(process.env.EIFLOW_ENV),
    DEV_GUILD_ID: canonical.devGuildId,
    MAIN_GUILD_ID: canonical.mainGuildId,
    DEV_AUTH_CHANNEL_ID: canonical.devAuthChannelId,
    MONGODB_URI: field(MONGO_PRIMARY, 'connection string'),
    MONGODB_DB: 'eiflow',
    MONGODB_SECONDARY_URI: field(MONGO_SECONDARY, 'connection string'),
    MONGODB_SECONDARY_DB: field(MONGO_SECONDARY, 'database name') ?? 'eipointsecurity',
    SUPABASE_URL: kv('NEXT_PUBLIC_SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: kv('SUPABASE_SERVICE_ROLE_KEY'),
    UPSTASH_REDIS_REST_URL: kv('UPSTASH_REDIS_REST_URL'),
    UPSTASH_REDIS_REST_TOKEN: kv('UPSTASH_REDIS_REST_TOKEN'),
    SENTRY_DSN: kv('sentry key'),
    LOG_LEVEL: 'info',
    PORT: String(port),
    REDIS_DAILY_COMMAND_BUDGET: '8000',
    // Per-bot provider keys from the cred file (optional — a missing key
    // leaves the feature disabled, never a boot failure). Parsed in-process,
    // injected straight into the child env, never printed or persisted.
    ...(botId === 'cyrene' && {
      GROQ_API_KEY: credential('GROQ_API_KEY', /"gpt oss"\s*=\s*(\S+)/),
      MISTRAL_API_KEY: credential('MISTRAL_API_KEY', /"Ministral 3 8B"\s*=\s*(\S+)/),
      GEMINI_API_KEY: credential('GEMINI_API_KEY'),
      OPENROUTER_API_KEY: credential('OPENROUTER_API_KEY'),
      AGNES_IMAGE_API_KEY: credential('AGNES_IMAGE_API_KEY'),
      CYRENE_MODEL: process.env.CYRENE_MODEL || kv('CYRENE_MODEL') || 'openai/gpt-oss-20b',
      ASSISTANT_MODEL: process.env.ASSISTANT_MODEL || kv('ASSISTANT_MODEL') || 'ministral-8b-latest',
      AGNES_IMAGE_MODEL: process.env.AGNES_IMAGE_MODEL || kv('AGNES_IMAGE_MODEL') || 'agnes-image-2.5-flash',
      CYRENE_TTS_MODEL: process.env.CYRENE_TTS_MODEL || kv('CYRENE_TTS_MODEL') || '',
      CYRENE_TTS_VOICE: process.env.CYRENE_TTS_VOICE || kv('CYRENE_TTS_VOICE') || '',
    }),
    ...(botId === 'shanks' && {
      NVIDIA_NIM_API_KEY: credential('NVIDIA_NIM_API_KEY', /nemotron-3\.5-content-safety" on nvidia nim\s*=\s*(\S+)/),
      CEREBRAS_API_KEY: credential('CEREBRAS_API_KEY', /"qwen-3\.8-27b" with limit[^=]*=\s*(\S+)/),
      SECURITY_SLM_MODEL: process.env.SECURITY_SLM_MODEL || kv('SECURITY_SLM_MODEL') || 'nvidia/nemotron-3.5-content-safety',
      SECURITY_SLM_FALLBACK_MODEL: process.env.SECURITY_SLM_FALLBACK_MODEL || kv('SECURITY_SLM_FALLBACK_MODEL') || 'qwen-3.8-27b',
    }),
    ...(botId === 'zoro' && {
      CEREBRAS_API_KEY: credential('CEREBRAS_API_KEY', /"qwen-3\.8-27b" with limit[^=]*=\s*(\S+)/),
      ZORO_SLM_MODEL: process.env.ZORO_SLM_MODEL || kv('ZORO_SLM_MODEL') || 'qwen-3.8-27b',
      ZORO_SLM_MAX_TOKENS: process.env.ZORO_SLM_MAX_TOKENS || kv('ZORO_SLM_MAX_TOKENS') || '64',
      ZORO_SLM_CONTEXT_CHARS: process.env.ZORO_SLM_CONTEXT_CHARS || kv('ZORO_SLM_CONTEXT_CHARS') || '2000',
    }),
    ...(botId === 'niko-robin' && {
      MODELSCOPE_API_KEY: credential('MODELSCOPE_API_KEY', /modelscope Qwen\/Qwen3\.5-35B-A3B = (\S+)/),
      BRAVE_SEARCH_API_KEY: credential('BRAVE_SEARCH_API_KEY'),
      SERPAPI_KEY: credential('SERPAPI_KEY'),
    }),
    // Match Render's 512MB free-plan contract: cap the V8 heap so a leak
    // crashes into a visible restart instead of eating the whole machine.
    NODE_OPTIONS: '--max-old-space-size=384',
  };
  canonicalId('MASTER_DISCORD_ID', own.MASTER_DISCORD_ID, MASTER_OPERATOR_DISCORD_ID);
  canonicalId('DEV_GUILD_ID', own.DEV_GUILD_ID, APPROVED_DEVELOPMENT_GUILD_ID);
  canonicalId('MAIN_GUILD_ID', own.MAIN_GUILD_ID, APPROVED_PRODUCTION_GUILD_ID);
  canonicalSnowflake('DEV_AUTH_CHANNEL_ID', own.DEV_AUTH_CHANNEL_ID);
  const requiredEnv = ['BOT_ID', 'BOT_NAME', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'HMAC_SECRET', 'HEALTH_TOKEN', 'EIFLOW_ENV'];
  const missing = requiredEnv.filter((k) => !own[k]);
  if (missing.length) throw new Error(`empty required env values: ${missing.join(', ')}`);
  return createBotChildEnv(process.env, own);
}

const botId = process.argv[2];
if (!botId || botId === '--help' || botId === '-h') {
  console.log('usage: node scripts/run-bot.mjs <botId>');
  console.log(`bot ids: ${BOT_IDS.join(', ')} (ports 3101-3108 in listed order)`);
  process.exit(0);
}
if (!BOT_IDS.includes(botId)) {
  console.error(`unknown bot id "${botId}" — expected one of: ${BOT_IDS.join(', ')}`);
  process.exit(1);
}
const port = PORT_BASE + BOT_IDS.indexOf(botId) + 1;

const logsDir = process.env.CLAUDE_JOB_DIR
  ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp', 'bot-logs')
  : path.join(ROOT, '.bot-logs');
mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `${botId}.log`);

const env = buildEnv(botId, port);
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', `bots/${botId}/src/index.ts`], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stamp = (line) => appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n');
child.stdout.on('data', (d) => stamp(d.toString()));
child.stderr.on('data', (d) => stamp(d.toString()));
console.log(`started ${botId} on port ${port} (pid ${child.pid}, log: ${logFile})`);
child.on('exit', (code, sig) => {
  stamp(`\n[launcher] ${botId} exited code=${code} signal=${sig}\n`);
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('exit', () => { try { child.kill('SIGKILL'); } catch {} });
