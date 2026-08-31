import { SlashCommandBuilder } from 'discord.js';
import { type CommandModule, type InventoryItem, UserError } from '@eiflow/shared';
import { dealRound, formatHand, MIN_DECK, resolveRound, rollLoot, createDeck, shuffle } from '../lib/game.js';
import { grantItem, loadGame, logEvent, runQueued, saveGame } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Deal a round of five-card draw against the house');

type Ctx = Parameters<CommandModule['execute']>[0];

interface PlayResult {
  player: string[];
  house: string[];
  outcome: 'win' | 'loss' | 'push';
  points: number;
  playerHand: string;
  houseHand: string;
  score: number;
  gamesPlayed: number;
  gamesWon: number;
  reward: InventoryItem | null;
  reshuffled: boolean;
}

export async function execute(ctx: Ctx): Promise<void> {
  await ctx.defer();

  const result = await runQueued(ctx, async (): Promise<PlayResult> => {
    const game = await loadGame(ctx);

    // The deck runs out after five rounds; rebuild it rather than refusing to play.
    const reshuffled = game.deck.length < MIN_DECK;
    const deck = reshuffled ? shuffle(createDeck()) : [...game.deck];

    const deal = dealRound(deck);
    if (!deal) throw new UserError('Your deck could not be dealt. Try again in a moment.');

    const round = resolveRound(deal.player, deal.house);
    const gamesPlayed = game.games_played + 1;
    const gamesWon = game.games_won + (round.outcome === 'win' ? 1 : 0);
    const score = game.score + round.points;

    await saveGame(ctx, {
      deck: deal.rest,
      hand: deal.player,
      score,
      games_played: gamesPlayed,
      games_won: gamesWon,
    });

    let reward: InventoryItem | null = null;
    if (round.outcome === 'win') {
      const drop = rollLoot();
      if (drop) {
        const granted = await grantItem(ctx, drop);
        if (granted) reward = drop;
      }
    }

    logEvent(ctx, 'card.play', `/play ${round.outcome} with ${round.player.name}`, {
      outcome: round.outcome,
      hand: deal.player,
      house: deal.house,
      points: round.points,
      score,
      reward: reward?.item_id ?? null,
    });

    return {
      player: deal.player,
      house: deal.house,
      outcome: round.outcome,
      points: round.points,
      playerHand: round.player.name,
      houseHand: round.house.name,
      score,
      gamesPlayed,
      gamesWon,
      reward,
      reshuffled,
    };
  });

  const kind = result.outcome === 'win' ? 'success' : result.outcome === 'push' ? 'warning' : 'error';
  const title = result.outcome === 'win' ? 'You win' : result.outcome === 'push' ? 'Push' : 'House wins';
  const losses = result.gamesPlayed - result.gamesWon;
  const winRate = result.gamesPlayed > 0 ? Math.round((result.gamesWon / result.gamesPlayed) * 100) : 0;

  const fields = [
    { name: 'Your hand', value: `${formatHand(result.player)}\n*${result.playerHand}*`, inline: false },
    { name: 'House hand', value: `${formatHand(result.house)}\n*${result.houseHand}*`, inline: false },
    { name: 'Points', value: `+${result.points}`, inline: true },
    { name: 'Score', value: String(result.score), inline: true },
    { name: 'Record', value: `${result.gamesWon}W / ${losses}L (${winRate}%)`, inline: true },
  ];

  if (result.reward) {
    fields.push({ name: 'Drop', value: `**${result.reward.name}** ×${result.reward.quantity}`, inline: true });
  }

  await ctx.replyEmbed(
    ctx.services.embeds.build(kind, title, `You drew **${result.playerHand}** against the house.`, {
      fields,
      footerSuffix: result.reshuffled ? 'Deck reshuffled' : undefined,
    }),
  );
}
