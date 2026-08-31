import { SlashCommandBuilder, type APIEmbedField } from 'discord.js';
import { requireManageGuild, sanitizeText, truncateFieldValue, UserError, type CommandModule, type SecurityEventRow } from '@eiflow/shared';
import { MAX_ROWS, listSecurityEvents, runSecurityQuery } from '../lib/store.js';

const SEVERITY_ICON: Record<SecurityEventRow['severity'], string> = {
  low: '🟢',
  medium: '🟡',
  high: '🟠',
  critical: '🔴',
};

function toField(row: SecurityEventRow, index: number): APIEmbedField {
  const stamp = Math.floor(new Date(row.created_at).getTime() / 1000);
  const taken = row.action_taken ? sanitizeText(row.action_taken, 120) : 'none recorded';

  return {
    name: truncateFieldValue(`#${index + 1} • ${SEVERITY_ICON[row.severity]} ${row.event_type}`, 256),
    value: truncateFieldValue(
      `<t:${stamp}:R> • actor <@${row.actor_id}>\nseverity \`${row.severity}\` • action: ${taken}`,
      1024,
    ),
  };
}

export const data = new SlashCommandBuilder()
  .setName('security')
  .setDescription('Inspect recorded security events')
  .addSubcommand((sub) =>
    sub
      .setName('log')
      .setDescription('Show recent antinuke events for this server')
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
  requireManageGuild(ctx);
  if (ctx.interaction.options.getSubcommand() !== 'log') {
    throw new UserError('Unknown subcommand.');
  }

  const limit = ctx.intOption('limit') ?? 10;

  await ctx.defer(true);

  const rows = await runSecurityQuery(ctx, () => listSecurityEvents(ctx, limit));

  if (rows.length === 0) {
    await ctx.info('No security events', 'Nothing has been recorded for this server yet.');
    return;
  }

  await ctx.replyEmbed(
    ctx.services.embeds.brand(`Security log (${rows.length})`, undefined, {
      fields: rows.map((row, i) => toField(row, i)),
      footerSuffix: 'newest first',
    }),
  );
}
