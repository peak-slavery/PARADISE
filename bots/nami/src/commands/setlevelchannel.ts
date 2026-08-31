import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requireManageGuild, UserError, type CommandModule } from '@eiflow/shared';
import { setConfig } from '../lib/store.js';

type Ctx = Parameters<CommandModule['execute']>[0];

export const data = new SlashCommandBuilder()
  .setName('setlevelchannel')
  .setDescription('Set the channel where level-up announcements are posted')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Announcement channel')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

export async function execute(ctx: Ctx): Promise<void> {
  requireManageGuild(ctx);
  ctx.services.requireSupabase();

  const channel = ctx.interaction.options.getChannel('channel', true);

  const saved = await setConfig(ctx, { level_channel: channel.id });
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  await ctx.replyEmbed(
    ctx.services.embeds.success('Level-up channel set', `Level-ups will be announced in <#${channel.id}>.`, {
      fields: [{ name: 'Channel', value: `<#${channel.id}>`, inline: true }],
    }),
  );
}
