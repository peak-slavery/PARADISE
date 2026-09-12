// Local-only bootstrap: secrets stay in the server process, not in a new env file.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const raw = readFileSync(new URL('../temp cred.txt', import.meta.url), 'utf8');
const env = { ...process.env };
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'HMAC_SECRETS_JSON', 'SECRET_ENCRYPTION_KEY']) {
  const value = raw.match(new RegExp(`(?:^|\\n)(?:- )?${name}\\s*=\\s*"?([^"\\r\\n]+)`))?.[1]?.trim();
  if (!env[name] && value) env[name] = value;
}
const mongo = raw.match(/#\s*primary mongo db([^#]*)/i)?.[1];
env.MONGODB_URI ||= mongo?.match(/connection string="?([^"\r\n]+)/)?.[1]?.trim() ?? '';
env.MONGODB_DB ||= 'eiflow';
env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
env.DEV_GUILD_ID ||= raw.match(/^#dev server=(\d+)/m)?.[1] ?? '';
env.MAIN_GUILD_ID ||= raw.match(/^#main server=(\d+)/m)?.[1] ?? '';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'dashboard', '--hostname', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
