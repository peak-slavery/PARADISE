import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommands, UNIVERSAL_COMMANDS_DIR } from '@eiflow/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(here, '..', 'src', 'commands');

// Pass a guild ID to register instantly to one server (fast iteration).
// Omit it for global registration (up to 1 hour to propagate).
const guildId = process.argv[2];

const result = await registerCommands([commandsDir, UNIVERSAL_COMMANDS_DIR], guildId);

console.log(
  `[${result.botId}] registered ${result.count} command(s) ${result.scope === 'guild' ? `to guild ${guildId}` : 'globally'}`,
);
