import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommands, UNIVERSAL_COMMANDS_DIR } from '@eiflow/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(here, '..', 'src', 'commands');

// Operator-facing registration is global-only. Development-only commands use
// the canonical development guild when EIFLOW_ENV=development.
const result = await registerCommands([commandsDir, UNIVERSAL_COMMANDS_DIR]);

console.log(`[${result.botId}] registered ${result.count} command(s) globally`);
