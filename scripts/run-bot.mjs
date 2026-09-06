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
const kv = (key) => field(raw, key);

const BOT_IDS = ['shanks','sanji','zoro','boahancock','nami','luffy','niko-robin','cyrene'];
const PORT_BASE = 3100; // shanks=3101 ... cyrene=3108

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
  const required = { token: 'token', clientId: 'application id', hmac: 'HMAC_SECRET', healthToken: 'HEALTH_TOKEN', embedColor: 'EMBED_COLOR' };
  const vals = {};
  for (const [k, credKey] of Object.entries(required)) {
    const v = field(sec, credKey);
    if (!v) throw new Error(`cred file: ${botId} missing ${credKey}`);
    vals[k] = v;
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
    OWNER_IDS: raw.match(/^#master id=(\d+)/m)?.[1] ?? '',
    DASHBOARD_URL: 'https://ei-point-dashboard.vercel.app',
    DEV_GUILD_ID: raw.match(/^#dev server=(\d+)/m)?.[1] ?? '',
    MAIN_GUILD_ID: raw.match(/^#main server=(\d+)/m)?.[1] ?? '',
    DEV_AUTH_CHANNEL_ID: raw.match(/^#auth channel=(\d+)/m)?.[1] ?? '',
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
  };
  const missing = Object.entries(own).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`empty required env values: ${missing.join(', ')}`);
  return { ...process.env, ...own };
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
