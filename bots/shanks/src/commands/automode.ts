import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { getConfig, setConfig } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('automode')
  .setDescription('Configure AutoMod event logging')
  .addSubcommand((sub) =>
    sub
      .setName('log')
      .setDescription('Set the channel where AutoMod actions are logged')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Log channel')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.ManageGuild, 'Manage Server');
  const sub = ctx.interaction.options.getSubcommand();
  if (sub !== 'log') throw new UserError('Unknown subcommand.');

  const channel = ctx.interaction.options.getChannel('channel', true);

  if (!ctx.services.supabase) {
    throw new UserError('Configuration storage is unavailable right now. Please try again later.');
  }

  const saved = await setConfig(ctx, { automod_log_channel: channel.id });
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  const config = await getConfig(ctx);

  await ctx.replyEmbed(
    ctx.services.embeds.success('AutoMod logging configured', `Actions will be logged in <#${channel.id}>.`, {
      fields: [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Stored as', value: `\`${config.automod_log_channel ?? 'unset'}\``, inline: true },
      ],
    }),
  );
}
