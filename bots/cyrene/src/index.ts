import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayIntentBits } from 'discord.js';
import { createBot } from '@eiflow/shared';
import { createRoutes, routeChain } from './lib/providers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  // Model calls are slow and bursty: more concurrency than default, with a
  // timeout long enough for a real completion but well under any gateway stall.
  queue: { concurrency: 4, timeoutMs: 20_000 },

  setup: async ({ services, log }) => {
    const routes = Object.values(createRoutes(services.env));
    const ready = routes
      .filter((r) => routeChain(r).some((p) => p.available))
      .map((r) => r.label);

    log.info({ providers: ready }, 'ai bot initialised');

    if (ready.length === 0) {
      log.warn(
        'no AI provider API key configured (GROQ/MISTRAL/GEMINI/OPENROUTER) — /ask and /cyrene will degrade to an unavailable embed',
      );
    }
  },
});
