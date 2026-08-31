import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { MAX_TEMPLATE_LENGTH, PLACEHOLDER_HELP, saveTemplate } from '../lib/store.js';
import { requireManageGuild } from '@eiflow/shared';

type Ctx = Parameters<CommandModule['execute']>[0];

export const data = new SlashCommandBuilder()
  .setName('setwelcome')
  .setDescription('Set the channel and message sent when someone joins')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel to post join messages in')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  )
  .addStringOption((o) =>
    o
      .setName('message')
      .setDescription(`Placeholders: ${PLACEHOLDER_HELP}`)
      .setRequired(false)
      .setMaxLength(MAX_TEMPLATE_LENGTH),
  );

export async function execute(ctx: Ctx): Promise<void> {
  requireManageGuild(ctx);
  // Throws ServiceUnavailableError -> renders the standard unavailable embed.
  ctx.services.requireSupabase();

  const channel = ctx.interaction.options.getChannel('channel', true);
  const message = ctx.stringOption('message');

  const saved = await saveTemplate(ctx, 'welcome', channel.id, message);
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  await ctx.replyEmbed(
    ctx.services.embeds.success('Join message configured', `New members will be greeted in <#${channel.id}>.`, {
      fields: [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        {
          // A whitespace-only option sanitises to '' and Discord rejects an
          // empty field value with a 400, so fall back to the default label.
          name: 'Message',
          value: message && message.length > 0 ? message : 'Default template',
          inline: false,
        },
      ],
      footerSuffix: 'Preview it with /testwelcome',
    }),
  );
}
