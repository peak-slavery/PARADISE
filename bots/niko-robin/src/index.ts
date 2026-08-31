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
  // Provider calls are the only slow work this bot does; a wider queue keeps a
  // slow Brave response from blocking everyone behind it.
  queue: { concurrency: 4, timeoutMs: 10_000 },

  setup: async ({ client, services, log }) => {
    const providers = [services.env.braveSearchApiKey ? 'brave' : null, services.env.serpapiKey ? 'serpapi' : null].filter(
      (p): p is string => p !== null,
    );

    log.info(
      { guilds: client.guilds.cache.size, providers, cache: services.env.hasRedis },
      'search bot initialised',
    );

    if (providers.length === 0) {
      log.warn('no search provider configured — /search will reply with a not-configured embed');
    }
  },
});
