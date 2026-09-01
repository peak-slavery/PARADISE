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

/**
 * Persists the player's row.
 *
 * Passing `expected` turns the write into a compare-and-swap: it only applies
 * while the stored row still matches the state the caller loaded. Without it,
 * two concurrent `/play` invocations read the same deck, both deal from it, and
 * the second `$set` silently discards the first round — losing its score, its
 * deck advance and any loot it granted.
 *
 * Returns false when the CAS lost, meaning the caller should abort rather than
 * report a result that was never persisted.
 */
export async function saveGame(
  ctx: CommandContext,
  state: GameState,
  expected?: { games_played: number; deck: string[] },
): Promise<boolean> {
  const db = await ctx.services.requireMongo();

  const filter = expected
    ? {
        guild_id: ctx.guildId,
        user_id: ctx.userId,
        games_played: expected.games_played,
        deck: expected.deck,
      }
    : { guild_id: ctx.guildId, user_id: ctx.userId };

  const result = await db.card_games.updateOne(
    filter,
    { $set: { ...state, updated_at: new Date() } },
    { upsert: !expected },
  );

  return result.matchedCount > 0 || Boolean(result.upsertedCount);
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
  const updatedAt = new Date();

  // Pass 1 — top up a stack the player already holds.
  const topped = await db.inventories.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId, 'items.item_id': item.item_id },
    { $inc: { 'items.$.quantity': item.quantity }, $set: { updated_at: updatedAt } },
  );
  if (topped.matchedCount > 0) return true;

  // Pass 2 — append a new stack.
  //
  // The `$ne` guard is what makes this safe under concurrency. Without it, two
  // simultaneous grants of an item the player does not yet hold would both
  // observe "no match" in pass 1 and both `$push`, producing two separate
  // entries for one `item_id` and breaking the stacking invariant.
  const pushed = await db.inventories.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId, 'items.item_id': { $ne: item.item_id } },
    {
      $push: { items: item },
      $set: { updated_at: updatedAt },
      $setOnInsert: { guild_id: ctx.guildId, user_id: ctx.userId },
    },
    { upsert: true },
  );
  if (pushed.modifiedCount > 0 || pushed.upsertedCount > 0) return true;

  // Lost the race: another grant created the stack between passes 1 and 2, so
  // the `$ne` filter excluded our document. Retry the increment once so the
  // quantity is never silently dropped.
  const retried = await db.inventories.updateOne(
    { guild_id: ctx.guildId, user_id: ctx.userId, 'items.item_id': item.item_id },
    { $inc: { 'items.$.quantity': item.quantity }, $set: { updated_at: updatedAt } },
  );

  return retried.matchedCount > 0;
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
