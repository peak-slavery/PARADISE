import { readdir } from 'node:fs/promises';
import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../types.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List the commands this bot provides');

const UNIVERSAL = ['userinfo', 'serverinfo', 'about', 'help'];

/**
 * Enumerates command names straight from the filesystem — importing every
 * module just to print a list would defeat the lazy loader.
 */
async function listBotCommands(dir: string | undefined): Promise<string[]> {
  if (!dir) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts'))
      .map((e) => e.name.replace(/\.(ts|js)$/, ''))
      .filter((n) => /^[a-z0-9_-]{1,32}$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const botCommands = await listBotCommands(process.env.BOT_COMMANDS_DIR);
  const universal = UNIVERSAL.filter((c) => !botCommands.includes(c));

  const botList = botCommands.length ? botCommands.map((c) => `\`/${c}\``).join('  ') : '_none_';
  const universalList = universal.length ? universal.map((c) => `\`/${c}\``).join('  ') : '_none_';

  await ctx.replyEmbed(
    ctx.services.embeds.brand(`${ctx.services.env.botName} — commands`, undefined, {
      fields: [
        { name: 'This bot', value: botList },
        { name: 'Universal', value: universalList },
      ],
      footerSuffix: `v${ctx.services.env.botVersion}`,
    }),
  );
}
