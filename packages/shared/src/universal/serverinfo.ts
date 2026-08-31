import { SlashCommandBuilder, type APIEmbedField } from 'discord.js';
import type { CommandModule } from '../types.js';
import { escapeMentions } from '../sanitize.js';

export const data = new SlashCommandBuilder()
  .setName('serverinfo')
  .setDescription('Show information about this server');

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const guild = ctx.interaction.guild;
  if (!guild) {
    await ctx.error('Server only', 'This command can only be used inside a server.');
    return;
  }

  const fields: APIEmbedField[] = [
    { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
    { name: 'Members', value: String(guild.memberCount), inline: true },
    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
    { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
    { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
    { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
  ];

  if (guild.ownerId) {
    fields.push({ name: 'Owner', value: `<@${guild.ownerId}>`, inline: true });
  }

  await ctx.replyEmbed(
    ctx.services.embeds.build('info', escapeMentions(guild.name), undefined, {
      fields,
      thumbnail: guild.iconURL({ size: 128 }),
    }),
  );
}
