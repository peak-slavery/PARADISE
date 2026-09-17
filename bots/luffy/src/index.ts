import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayIntentBits } from 'discord.js';
import { createBot } from '@eiflow/shared';

import { handleCardPagerButton } from './commands/cards.js';
import { parseManifest } from './lib/cards/registry/scanner.js';
import { syncRegistry } from './lib/cards/registry/sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');
const manifestPath = path.resolve(here, '..', '..', '..', 'generated', 'cards.manifest.json');

await createBot({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],
  // Collection pagination is a read-only lookup, so it shares the unlimited
  // budget the read-only commands already use.
  handleButton: (ctx) => handleCardPagerButton(ctx),
  // Every round is a pair of Mongo round-trips; two at a time keeps the
  // free-tier connection pool comfortable.
  queue: { concurrency: 2, timeoutMs: 10_000 },

  setup: async ({ client, services, log }) => {
    const collections = await services.mongo();
    if (!collections) {
      log.warn('card registry sync skipped because primary Mongo is unavailable');
      return;
    }

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const parsed = parseManifest(raw);
      if (!parsed.ok) {
        log.error({ error: parsed.error }, 'card registry manifest invalid; sync skipped');
        return;
      }
      const summary = await syncRegistry({ collections, manifest: parsed.manifest });
      if (summary.errors.length > 0) {
        log.error({ summary }, 'card registry sync completed with errors');
      } else {
        log.info({ summary }, 'card registry synchronized');
      }
    } catch (err) {
      log.error({ err, manifestPath }, 'card registry sync failed');
    }

    log.info({ guilds: client.guilds.cache.size }, 'cardgame bot initialised');
  },
});
