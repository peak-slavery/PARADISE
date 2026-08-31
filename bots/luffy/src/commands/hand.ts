import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { evaluateHand, formatHand, HAND_SIZE } from '../lib/game.js';
import { loadGame, runQueued } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('hand')
  .setDescription('Show the hand from your last round');

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const game = await runQueued(ctx, () => loadGame(ctx));

  if (game.hand.length === 0) {
    await ctx.info('No hand yet', 'Use `/play` to deal your first round.');
    return;
  }

  const value = game.hand.length === HAND_SIZE ? evaluateHand(game.hand) : null;

  await ctx.replyEmbed(
    ctx.services.embeds.brand('Your hand', formatHand(game.hand), {
      fields: [
        { name: 'Cards', value: game.hand.join(' '), inline: true },
        { name: 'Best hand', value: value ? value.name : `Needs ${HAND_SIZE} cards`, inline: true },
        { name: 'Value', value: value ? String(value.points) : '—', inline: true },
        { name: 'Deck left', value: String(game.deck.length), inline: true },
      ],
    }),
  );
}
