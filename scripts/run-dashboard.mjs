// Local-only bootstrap: secrets stay in the server process, not in a new env file.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignmentValue,
  canonicalId,
  canonicalIdsFrom,
  canonicalRuntimeEnvironment,
  canonicalSnowflake,
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  MASTER_OPERATOR_DISCORD_ID,
} from './canonical-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(path.join(root, 'temp cred.txt'), 'utf8');
const env = { ...process.env };
const dashboardNames = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'HMAC_SECRETS_JSON',
  'SECRET_VAULT_MASTER_KEY',
  'SECRET_VAULT_SALT',
];
for (const name of dashboardNames) {
  const value = assignmentValue(raw, name);
  if (!env[name] && value) env[name] = value;
}

const canonical = canonicalIdsFrom(raw);
env.EIFLOW_ENV = canonicalRuntimeEnvironment(process.env.EIFLOW_ENV);
env.DEV_GUILD_ID ||= canonical.devGuildId;
env.MAIN_GUILD_ID ||= canonical.mainGuildId;
env.DEV_AUTH_CHANNEL_ID ||= canonical.devAuthChannelId;
env.MASTER_DISCORD_ID ||= canonical.masterDiscordId;
canonicalId('MASTER_DISCORD_ID', env.MASTER_DISCORD_ID, MASTER_OPERATOR_DISCORD_ID);
canonicalId('DEV_GUILD_ID', env.DEV_GUILD_ID, APPROVED_DEVELOPMENT_GUILD_ID);
canonicalId('MAIN_GUILD_ID', env.MAIN_GUILD_ID, APPROVED_PRODUCTION_GUILD_ID);
canonicalSnowflake('DEV_AUTH_CHANNEL_ID', env.DEV_AUTH_CHANNEL_ID, { required: false });

const mongo = raw.match(/#\s*primary mongo db([^#]*)/i)?.[1];
env.MONGODB_URI ||= mongo?.match(/connection string="?([^"\r\n]+)/)?.[1]?.trim() ?? '';
env.MONGODB_DB ||= 'eiflow';
env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'dashboard', '--hostname', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
