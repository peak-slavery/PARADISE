#!/usr/bin/env node
/**
 * Scaffolds a new Ei Flow bot.
 *
 *   node scripts/new-bot.mjs <id> <hexColour> <displayName> [description]
 *
 * Example:
 *   node scripts/new-bot.mjs sanji 3498DB "Sanji" "message + server event logs"
 *
 * Every bot is an isolated service: its own package, its own Render account,
 * its own token. They share only @eiflow/shared.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [id, colour, ...rest] = process.argv.slice(2);
if (!id || !colour || rest.length === 0) {
  console.error('Usage: node scripts/new-bot.mjs <id> <hexColour> <displayName> [description]');
  process.exit(1);
}

const displayName = rest[0];
const description = rest.slice(1).join(' ') || `${displayName} bot`;

if (!/^[a-z][a-z0-9-]{0,20}$/.test(id)) {
  console.error('Bot id must be lowercase kebab-case, e.g. "antinuke".');
  process.exit(1);
}
if (!/^[0-9a-fA-F]{6}$/.test(colour)) {
  console.error('Colour must be a 6-digit hex value without the #, e.g. "5865F2".');
  process.exit(1);
}

const dir = path.join(root, 'bots', id);
const pkgName = `@eiflow/bot-${id}`;

const files = {
  'package.json': `${JSON.stringify(
    {
      name: pkgName,
      version: '1.0.0',
      private: true,
      type: 'module',
      description,
      scripts: {
        dev: 'tsx watch src/index.ts',
        start: 'tsx src/index.ts',
        typecheck: 'tsc --noEmit',
        'deploy:commands': 'tsx scripts/deploy-commands.ts',
      },
      dependencies: {
        '@eiflow/shared': '*',
        'discord.js': '^14.15.3',
      },
      devDependencies: {
        '@types/node': '^22.7.5',
        tsx: '^4.19.1',
        typescript: '^5.6.3',
      },
    },
    null,
    2,
  )}\n`,

  'tsconfig.json': `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: { types: ['node'] },
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
    },
    null,
    2,
  )}\n`,

  '.env.example': `# ${displayName} — copy to .env and fill in
BOT_ID=${id}
BOT_NAME=${displayName}
BOT_VERSION=1.0.0
EMBED_COLOR=#${colour.toUpperCase()}
DISCORD_TOKEN=
DISCORD_CLIENT_ID=

# Shared across all bot services
HMAC_SECRET=
OWNER_IDS=
EIFLOW_ENV=development
DEV_GUILD_ID=1444582621417046071
MAIN_GUILD_ID=848841415940898827
DEV_AUTH_CHANNEL_ID=
MASTER_DISCORD_ID=1479589523426902208
DASHBOARD_URL=https://ei-point-dashboard.vercel.app
MONGODB_DB=eiflow
MONGODB_SECONDARY_DB=eipointsecurity
SENTRY_DSN=
LOG_LEVEL=info
PORT=3000
HEALTH_TOKEN=
REDIS_DAILY_COMMAND_BUDGET=8000
`,

  'src/index.ts': `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayIntentBits } from 'discord.js';
import { createBot } from '@eiflow/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  // Wire guild-specific event listeners here.
  setup: async ({ client, services, log }) => {
    log.info({ guilds: client.guilds.cache.size }, '${id} bot initialised');
    void services;
  },
});
`,

  'scripts/deploy-commands.ts': `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommands, UNIVERSAL_COMMANDS_DIR } from '@eiflow/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(here, '..', 'src', 'commands');

// Operator-facing registration is global-only. Development-only commands use
// the canonical development guild when EIFLOW_ENV=development.
const result = await registerCommands([commandsDir, UNIVERSAL_COMMANDS_DIR]);

console.log(\`[\${result.botId}] registered \${result.count} command(s) globally\`);
`,
};

try {
  await access(dir);
  console.error(`bots/${id} already exists — refusing to overwrite.`);
  process.exit(1);
} catch {
  // Expected: the directory must not exist.
}

for (const [rel, content] of Object.entries(files)) {
  const target = path.join(dir, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}
await mkdir(path.join(dir, 'src', 'commands'), { recursive: true });

console.log(`created bots/${id} (${pkgName}, #${colour.toUpperCase()})`);
console.log('next: npm install, then write command modules in src/commands/');
