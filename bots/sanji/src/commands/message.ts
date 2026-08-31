import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { MAX_ROWS, MESSAGE_LOG_ACTIONS, queryLogs, runLogQuery, toField } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('message')
  .setDescription('Look up stored message event logs')
  .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
  .addSubcommand((sub) =>
    sub
      .setName('logs')
      .setDescription('Show recent message edits and deletions')
      .addUserOption((o) =>
        o.setName('user').setDescription('Only show events for this member').setRequired(false),
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

  const user = ctx.interaction.options.getUser('user');
  const limit = ctx.intOption('limit') ?? 10;

  await ctx.defer(true);

  const rows = await runLogQuery(ctx, () =>
    queryLogs(ctx, { actions: MESSAGE_LOG_ACTIONS, userId: user?.id ?? null, limit }),
  );

  if (rows.length === 0) {
    await ctx.info(
      'No message logs',
      user
        ? `<@${user.id}> has no recorded message events in this server yet.`
        : 'No message events have been recorded in this server yet.',
    );
    return;
  }

  await ctx.replyEmbed(
    ctx.services.embeds.info(`Message logs (${rows.length})`, undefined, {
      fields: rows.map((doc, i) => toField(doc, i)),
      footerSuffix: user ? `filtered by ${user.tag}` : 'newest first',
    }),
  );
}
