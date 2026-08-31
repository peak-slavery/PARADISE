import type { CardGameDoc, CommandContext, InventoryDoc, InventoryItem } from '@eiflow/shared';
import { QueueTimeoutError, ServiceUnavailableError } from '@eiflow/shared';
import { createDeck, shuffle } from './game.js';

/**
 * Persistence for the card game.
 *
 * MongoDB is the write-heavy activity store, so game state lives in
 * `card_games` and drops live in `inventories`, both keyed on
 * `(guild_id, user_id)`. Every read is an upsert, so a first-time player is
 * seeded with a fresh shuffled deck without a separate insert path.
 */

const QUEUE_TIMEOUT_MS = 8_000;

/**
 * Runs a unit of database work off the gateway event loop.
 *
 * The shared queue gives us a concurrency cap and a hard timeout; a hung Mongo
 * replica must surface as "Database is unavailable", not as an unhandled
 * rejection or a stalled interaction.
 */
export async function runQueued<T>(ctx: CommandContext, task: () => Promise<T>): Promise<T> {
  try {
    return await ctx.services.queue.run(task, { timeoutMs: QUEUE_TIMEOUT_MS, maxPending: 16 });
  } catch (err) {
    if (err instanceof QueueTimeoutError) throw new ServiceUnavailableError('Database');
    throw err;
  }
}

function freshDeck(): string[] {
  return shuffle(createDeck());
}

export interface GameState {
  deck: string[];
  hand: string[];
  score: number;
  games_played: number;
  games_won: number;
}

/** Loads the player's row, seeding a new player on first use. */
export async function loadGame(ctx: CommandContext): Promise<CardGameDoc> {
  const db = await ctx.services.requireMongo();

  const doc = await db.card_games.findOneAndUpdate(
    { guild_id: ctx.guildId, user_id: ctx.userId },
    {
      $set: { updated_at: new Date() },
      $setOnInsert: {
        guild_id: ctx.guildId,
        user_id: ctx.userId,
        deck: freshDeck(),
        hand: [],
        score: 0,
        games_played: 0,
        games_won: 0,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (!doc) throw new ServiceUnavailableError('Database');
  return doc;
}

export async function saveGame(ctx: CommandContext, state: GameState): Promise<void> {
  const db = await ctx.services.requireMongo();
  await db.card_games.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId },
    { $set: { ...state, updated_at: new Date() } },
    { upsert: true },
  );
}

/** Loads the player's inventory, creating an empty one on first use. */
export async function getInventory(ctx: CommandContext): Promise<InventoryDoc> {
  const db = await ctx.services.requireMongo();

  const doc = await db.inventories.findOneAndUpdate(
    { guild_id: ctx.guildId, user_id: ctx.userId },
    {
      $set: { updated_at: new Date() },
      $setOnInsert: { guild_id: ctx.guildId, user_id: ctx.userId, items: [] },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (!doc) throw new ServiceUnavailableError('Database');
  return doc;
}

/**
 * Adds `item` to the player's inventory, incrementing the stack when the item is
 * already held.
 *
 * Two atomic writes rather than read-modify-write: the positional `$inc` needs
 * a matching array element, which an upsert cannot provide, so we top up the
 * stack first and only `$push` (with upsert) when nothing matched.
 */
export async function grantItem(ctx: CommandContext, item: InventoryItem): Promise<boolean> {
  const db = await ctx.services.requireMongo();

  const topped = await db.inventories.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId, 'items.item_id': item.item_id },
    { $inc: { 'items.$.quantity': item.quantity }, $set: { updated_at: new Date() } },
  );
  if (topped.matchedCount > 0) return true;

  const pushed = await db.inventories.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId },
    {
      $push: { items: item },
      $set: { updated_at: new Date() },
      $setOnInsert: { guild_id: ctx.guildId, user_id: ctx.userId },
    },
    { upsert: true },
  );

  return pushed.acknowledged;
}

/** Mirrors a game event into the batched Mongo log stream. */
export function logEvent(
  ctx: CommandContext,
  action: string,
  message: string,
  meta: Record<string, unknown> = {},
): void {
  ctx.services.logs.push({
    bot_id: ctx.services.env.botId,
    guild_id: ctx.guildId,
    channel_id: ctx.interaction.channelId,
    user_id: ctx.userId,
    action,
    level: 'info',
    message,
    meta,
    created_at: new Date(),
  });
}
