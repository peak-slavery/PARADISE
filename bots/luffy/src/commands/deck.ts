import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { cardSuit, createDeck, formatHand, MIN_DECK, shuffle, SUITS, SUIT_GLYPH } from '../lib/game.js';
import { loadGame, logEvent, runQueued, saveGame } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('deck')
  .setDescription('Show or reshuffle your deck')
  .addBooleanOption((o) =>
    o.setName('reshuffle').setDescription('Rebuild a fresh 52-card deck and clear your hand').setRequired(false),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const reshuffle = ctx.interaction.options.getBoolean('reshuffle') ?? false;

  if (reshuffle) {
    await runQueued(ctx, async () => {
      const game = await loadGame(ctx);
      await saveGame(ctx, {
        deck: shuffle(createDeck()),
        hand: [],
        score: game.score,
        games_played: game.games_played,
        games_won: game.games_won,
      });
      logEvent(ctx, 'card.reshuffle', 'deck reshuffled', { previous: game.deck.length });
    });

    await ctx.success('Deck reshuffled', 'A fresh 52-card deck is ready and your hand is empty.');
    return;
  }

  const game = await runQueued(ctx, () => loadGame(ctx));

  const bySuit = SUITS.map((suit) => {
    const count = game.deck.filter((card) => cardSuit(card) === suit).length;
    return `${SUIT_GLYPH[suit]} ${count}`;
  }).join('   ');

  const low = game.deck.length < MIN_DECK;

  await ctx.replyEmbed(
    ctx.services.embeds.brand('Your deck', low ? 'Running low — the next round reshuffles automatically.' : undefined, {
      fields: [
        { name: 'Cards left', value: String(game.deck.length), inline: true },
        { name: 'Last hand', value: formatHand(game.hand), inline: true },
        { name: 'By suit', value: bySuit, inline: false },
        {
          name: 'Rounds left',
          value: String(Math.floor(game.deck.length / MIN_DECK)),
          inline: true,
        },
      ],
    }),
  );
}
