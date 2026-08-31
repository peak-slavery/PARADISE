import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { clearContext } from '../lib/context.js';
import { RESET_SCOPES, type ResetScope } from '../lib/personas.js';

export const data = new SlashCommandBuilder()
  .setName('reset')
  .setDescription('Clear your stored AI conversation context')
  .addStringOption((o) =>
    o
      .setName('scope')
      .setDescription('Which conversation to clear (default: all)')
      .setRequired(false)
      .addChoices(...RESET_SCOPES.map((s) => ({ name: s, value: s }))),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  await ctx.defer(true);

  const scope = (ctx.stringOption('scope') as ResetScope | null) ?? 'all';
  if (!RESET_SCOPES.includes(scope)) {
    await ctx.error('Invalid scope', 'Choose one of: `ask`, `cyrene`, `all`.');
    return;
  }

  const deleted = await clearContext(ctx, scope);

  if (deleted === null) {
    await ctx.replyEmbed(ctx.services.embeds.unavailable('Database'));
    return;
  }

  await ctx.success(
    'Context cleared',
    deleted > 0
      ? `Removed **${deleted}** stored conversation(s) for \`${scope}\`.`
      : `There was no stored conversation for \`${scope}\`.`,
  );
}
