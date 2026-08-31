import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { LOG_CHANNEL_TYPES, getConfig, setConfig } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('setlogchannel')
  .setDescription('Set the channel where live log embeds are posted')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post logs in')
      .setRequired(true)
      .addChannelTypes(...LOG_CHANNEL_TYPES),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.ManageGuild, 'Manage Server');
  const channel = ctx.interaction.options.getChannel('channel', true);

  if (!ctx.services.supabase) {
    throw new UserError('Configuration storage is unavailable right now. Please try again later.');
  }

  // Confirm the bot can actually post there before saving, so the operator
  // finds out now instead of the next time an event fires.
  const resolved = await ctx.client.channels.fetch(channel.id).catch(() => null);
  if (!resolved?.isTextBased()) {
    throw new UserError('That channel is not a text channel I can post in.');
  }

  const saved = await setConfig(ctx, { log_channel: channel.id });
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  const config = await getConfig(ctx);

  await ctx.replyEmbed(
    ctx.services.embeds.success('Log channel set', `Live log embeds will be posted in <#${channel.id}>.`, {
      fields: [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Stored as', value: `\`${config.log_channel ?? 'unset'}\``, inline: true },
        {
          name: 'Next step',
          value: 'Use `/logconfig` to choose which event types are logged.',
          inline: false,
        },
      ],
    }),
  );
}
