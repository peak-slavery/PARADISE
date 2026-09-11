import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { loadEnv } from './env.js';
import { loadAllCommandModules } from './commands.js';

export interface DeployResult {
  botId: string;
  count: number;
  scope: 'global' | 'guild';
}

/**
 * Registers slash commands with Discord.
 *
 * Run offline (`npm run deploy:commands`), never at boot:
 *  - global registration is rate-limited and can take up to an hour to propagate
 *  - it would force every command module to load, defeating lazy loading
 */
export async function registerCommands(dirs: string[], guildId?: string): Promise<DeployResult> {
  const env = loadEnv();

  const seen = new Set<string>();
  const modules = (
    await Promise.all(dirs.map((dir) => loadAllCommandModules(dir)))
  ).flat();

  // Later dirs are fallback dirs — a bot's own command always wins.
  const body: RESTPostAPIApplicationCommandsJSONBody[] = [];
  for (const mod of modules) {
    const json = mod.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody & { name?: string };
    if (json.name && !seen.has(json.name)) {
      seen.add(json.name);
      body.push(json);
    }
  }

  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  const route = guildId
    ? Routes.applicationGuildCommands(env.discordClientId, guildId)
    : Routes.applicationCommands(env.discordClientId);
  const application = await rest.get(Routes.oauth2CurrentApplication()) as { id: string };
  if (application.id !== env.discordClientId) {
    throw new Error(`Application id does not match the token for ${env.botId}`);
  }
  await rest.put(route, { body });
  const registered = await rest.get(route) as { name: string; type: number }[];
  const names = new Set(registered.filter((command) => command.type === 1).map((command) => command.name));
  if (names.size !== body.length || body.some((command) => !names.has(command.name))) {
    throw new Error(`Command verification failed for ${env.botId}`);
  }

  return { botId: env.botId, count: body.length, scope: guildId ? 'guild' : 'global' };
}
