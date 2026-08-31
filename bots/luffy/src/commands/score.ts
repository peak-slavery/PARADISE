import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { loadGame, runQueued } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('score')
  .setDescription('Show your score and win/loss record');

type Ctx = Parameters<CommandModule['execute']>[0];

/** Purely cosmetic ladder so a score has something to climb. */
function tier(score: number): string {
  if (score >= 500) return 'High Roller';
  if (score >= 200) return 'Card Sharp';
  if (score >= 75) return 'Regular';
  if (score >= 15) return 'Beginner';
  return 'Newcomer';
}

export async function execute(ctx: Ctx): Promise<void> {
  const game = await runQueued(ctx, () => loadGame(ctx));

  const losses = game.games_played - game.games_won;
  const winRate = game.games_played > 0 ? Math.round((game.games_won / game.games_played) * 100) : 0;

  await ctx.replyEmbed(
    ctx.services.embeds.brand('Score', game.games_played === 0 ? 'No rounds played yet.' : undefined, {
      fields: [
        { name: 'Score', value: String(game.score), inline: true },
        { name: 'Tier', value: tier(game.score), inline: true },
        { name: 'Rounds', value: String(game.games_played), inline: true },
        { name: 'Won', value: String(game.games_won), inline: true },
        { name: 'Lost', value: String(Math.max(0, losses)), inline: true },
        { name: 'Win rate', value: `${winRate}%`, inline: true },
      ],
    }),
  );
}
