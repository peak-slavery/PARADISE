import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { loadDeployEnv, validateCanonicalDeployConfig } from './env.js';
import { isApprovedGuild } from './guild-policy.js';
import { loadAllCommandModules } from './commands.js';

export interface DeployResult {
  botId: string;
  count: number;
  scope: 'global' | 'guild';
  /** Guild scopes cleared after a global registration (dedup self-healing). */
  clearedGuilds?: string[];
}

/**
 * Registers slash commands with Discord.
 *
 * Run offline (`npm run deploy:commands`), never at boot:
 *  - global registration is rate-limited and can take up to an hour to propagate
 *  - it would force every command module to load, defeating lazy loading
 */
export async function registerCommands(dirs: string[], guildId?: string): Promise<DeployResult> {
  const env = loadDeployEnv();
  validateCanonicalDeployConfig(env);

  if (guildId && (!isApprovedGuild(guildId, env) || guildId !== env.devGuildId)) {
    throw new Error(`Explicit command guild must be the canonical development guild ${env.devGuildId} for ${env.runtimeEnvironment}`);
  }

  const seen = new Set<string>();
  const modules = (
    await Promise.all(dirs.map((dir) => loadAllCommandModules(dir)))
  ).flat();

  // Later dirs are fallback dirs — a bot's own command always wins.
  const publicBody: RESTPostAPIApplicationCommandsJSONBody[] = [];
  const devBody: RESTPostAPIApplicationCommandsJSONBody[] = [];
  for (const mod of modules) {
    const json = mod.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody & { name?: string };
    if (!json.name || seen.has(json.name)) continue;
    seen.add(json.name);
    if (mod.access === 'dev') devBody.push(json);
    else publicBody.push(json);
  }

  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  const application = await rest.get(Routes.oauth2CurrentApplication()) as { id: string };
  if (application.id !== env.discordClientId) {
    throw new Error(`Application id does not match the token for ${env.botId}`);
  }

  // Explicit guild scope (dev-iteration escape hatch) replaces the guild's
  // command set with the same body the split model would install there.
  if (guildId) {
    const devRoute = Routes.applicationGuildCommands(env.discordClientId, guildId);
    await rest.put(devRoute, { body: devBody });
    const registered = await rest.get(devRoute) as { name: string; type: number }[];
    const names = new Set(registered.filter((command) => command.type === 1).map((command) => command.name));
    if (names.size !== devBody.length) throw new Error(`Command verification failed for ${env.botId}`);
    return { botId: env.botId, count: devBody.length, scope: 'guild' };
  }

  // Split scopes so no command ever exists in two places:
  //   global          -> public commands (usable in every authorized server)
  //   DEV_GUILD_ID    -> dev-only commands (authorization and operator controls)
  //   MAIN_GUILD_ID   -> cleared of stale guild-scoped copies
  const globalRoute = Routes.applicationCommands(env.discordClientId);
  await rest.put(globalRoute, { body: publicBody });
  const registered = await rest.get(globalRoute) as { name: string; type: number }[];
  const names = new Set(registered.filter((command) => command.type === 1).map((command) => command.name));
  if (names.size !== publicBody.length || publicBody.some((command) => !names.has(command.name))) {
    throw new Error(`Command verification failed for ${env.botId}`);
  }

  const clearedGuilds: string[] = [];
  if (env.runtimeEnvironment === 'development') {
    if (env.devGuildId) {
      const devRoute = Routes.applicationGuildCommands(env.discordClientId, env.devGuildId);
      await rest.put(devRoute, { body: devBody });
      const devRegistered = await rest.get(devRoute) as { name: string; type: number }[];
      const devNames = new Set(devRegistered.filter((command) => command.type === 1).map((command) => command.name));
      if (devNames.size !== devBody.length) throw new Error(`Dev-guild command verification failed for ${env.botId}`);
    } else if (devBody.length) {
      console.warn(`[${env.botId}] ${devBody.length} dev-only command(s) not registered: DEV_GUILD_ID is not set`);
    }
  }

  if (env.mainGuildId) {
    try {
      await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.mainGuildId), { body: [] });
      clearedGuilds.push(env.mainGuildId);
    } catch {
      // Not a member / guild gone — nothing to clear.
    }
  }

  return {
    botId: env.botId,
    count: publicBody.length + (env.runtimeEnvironment === 'development' ? devBody.length : 0),
    scope: 'global',
    ...(clearedGuilds.length ? { clearedGuilds } : {}),
  };
}
