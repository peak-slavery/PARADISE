import { SlashCommandBuilder } from 'discord.js';
import { escapeMarkdown, UserError, type CommandModule } from '@eiflow/shared';
import { levelProgress } from '../lib/levels.js';
import { topXp } from '../lib/store.js';

type Ctx = Parameters<CommandModule['execute']>[0];

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the members with the most XP in this server')
  .addIntegerOption((o) =>
    o
      .setName('limit')
      .setDescription(`How many members to show (1–${MAX_LIMIT})`)
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_LIMIT),
  );

export async function execute(ctx: Ctx): Promise<void> {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');

  const requested = ctx.intOption('limit') ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, requested));

  await ctx.defer();

  const docs = await topXp(ctx, guild.id, limit);
  if (docs.length === 0) {
    await ctx.info('No XP yet', 'Nobody has earned XP in this server yet.');
    return;
  }

  // Resolved from the client cache only — no per-row API call on a hot command.
  const lines = docs.map((doc, index) => {
    const name = ctx.client.users.cache.get(doc.user_id)?.tag ?? `User ${doc.user_id}`;
    const { level } = levelProgress(doc.xp);
    return `**#${index + 1}** ${escapeMarkdown(name)} — level ${level} • ${doc.xp} XP`;
  });

  await ctx.replyEmbed(
    ctx.services.embeds.brand(`Top ${docs.length} in ${escapeMarkdown(guild.name)}`, lines.join('\n'), {
      footerSuffix: 'Sorted by XP',
    }),
  );
}
