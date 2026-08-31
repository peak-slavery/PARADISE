import { SlashCommandBuilder, type APIEmbedField } from 'discord.js';
import type { CommandModule } from '../types.js';

export const data = new SlashCommandBuilder()
  .setName('about')
  .setDescription('Show version and status for this bot');

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const { env, redis } = ctx.services;

  const fields: APIEmbedField[] = [
    { name: 'Bot', value: env.botName, inline: true },
    { name: 'Version', value: `v${env.botVersion}`, inline: true },
    { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true },
    { name: 'Memory', value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`, inline: true },
    { name: 'Node', value: process.version, inline: true },
    { name: 'Redis commands', value: String(redis.commandsUsed()), inline: true },
  ];

  await ctx.replyEmbed(
    ctx.services.embeds.brand('About', 'Part of the Ei Flow bot network.', {
      fields,
      footerSuffix: 'Ei Flow',
    }),
  );
}
