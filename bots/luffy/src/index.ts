import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayIntentBits } from 'discord.js';
import { createBot } from '@eiflow/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],
  // Every round is a pair of Mongo round-trips; two at a time keeps the
  // free-tier connection pool comfortable.
  queue: { concurrency: 2, timeoutMs: 10_000 },

  setup: async ({ client, services, log }) => {
    log.info({ guilds: client.guilds.cache.size }, 'cardgame bot initialised');
    void services;
  },
});
