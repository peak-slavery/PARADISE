import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { MAX_ROWS, OTHER_LOG_ACTIONS, queryLogs, runLogQuery, toField } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('other')
  .setDescription('Look up non-message server event logs')
  .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
  .addSubcommand((sub) =>
    sub
      .setName('logs')
      .setDescription('Show recent member, channel, role, voice and moderation events')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Only show events that reference this channel')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
      )
      .addIntegerOption((o) =>
        o
          .setName('limit')
          .setDescription(`Rows to show (1–${MAX_ROWS})`)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(MAX_ROWS),
      ),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.ViewAuditLog, 'View Audit Log');
  if (ctx.interaction.options.getSubcommand() !== 'logs') {
    throw new UserError('Unknown subcommand.');
  }

  const channel = ctx.interaction.options.getChannel('channel');
  const limit = ctx.intOption('limit') ?? 10;

  await ctx.defer(true);

  const rows = await runLogQuery(ctx, () =>
    queryLogs(ctx, { actions: OTHER_LOG_ACTIONS, channelId: channel?.id ?? null, limit }),
  );

  if (rows.length === 0) {
    await ctx.info(
      'No event logs',
      channel
        ? `Nothing has been recorded for <#${channel.id}> yet.`
        : 'No non-message events have been recorded in this server yet.',
    );
    return;
  }

  await ctx.replyEmbed(
    ctx.services.embeds.info(`Server event logs (${rows.length})`, undefined, {
      fields: rows.map((doc, i) => toField(doc, i)),
      footerSuffix: channel ? `filtered by #${channel.name}` : 'newest first',
    }),
  );
}
