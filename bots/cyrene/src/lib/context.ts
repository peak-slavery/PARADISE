import type { AiMessage, CommandContext } from '@eiflow/shared';
import type { AiScope, ResetScope } from './personas.js';
import type { ChatMessage } from './providers.js';

/**
 * Per-user, per-scope conversation memory in MongoDB `ai_context`.
 *
 * The collection has a unique index on (guild_id, user_id, scope), so `/ask`
 * and `/cyrene` memories can never leak into each other.
 *
 * Every failure here degrades silently: history is a nicety, never a reason to
 * lose a user's reply.
 */

/** ~5 turns of conversation. Keeps prompts small enough for the free tiers. */
export const CONTEXT_LIMIT = 10;

/** Reads the stored history for a scope. Empty in degraded mode. */
export async function readContext(ctx: CommandContext, scope: AiScope): Promise<ChatMessage[]> {
  const collections = await ctx.services.mongo();
  if (!collections) return [];

  try {
    const doc = await collections.ai_context.findOne({
      guild_id: ctx.guildId,
      user_id: ctx.userId,
      scope,
    });
    if (!doc) return [];
    return doc.messages
      .slice(-CONTEXT_LIMIT)
      .map((m): ChatMessage => ({ role: m.role, content: m.content }));
  } catch (err) {
    ctx.log.warn({ err, scope }, 'failed to read ai context — continuing without history');
    return [];
  }
}

/**
 * Persists the finished turn and trims the window to the last CONTEXT_LIMIT
 * messages. Never throws: a failed write must not fail the user's reply.
 */
export async function appendTurn(
  ctx: CommandContext,
  scope: AiScope,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const collections = await ctx.services.mongo();
  if (!collections) return;

  const now = new Date();
  const turn: AiMessage[] = [
    { role: 'user', content: userContent, ts: now },
    { role: 'assistant', content: assistantContent, ts: now },
  ];

  try {
    await collections.ai_context.updateOne(
      { guild_id: ctx.guildId, user_id: ctx.userId, scope },
      {
        $push: { messages: { $each: turn, $slice: -CONTEXT_LIMIT } },
        $set: { updated_at: now },
      },
      { upsert: true },
    );
  } catch (err) {
    ctx.log.warn({ err, scope }, 'failed to persist ai context');
  }
}

/**
 * Clears stored context. Returns the number of deleted documents, or null when
 * Mongo is unavailable or the write failed.
 */
export async function clearContext(ctx: CommandContext, scope: ResetScope): Promise<number | null> {
  const collections = await ctx.services.mongo();
  if (!collections) return null;

  const filter =
    scope === 'all'
      ? { guild_id: ctx.guildId, user_id: ctx.userId }
      : { guild_id: ctx.guildId, user_id: ctx.userId, scope };

  try {
    const res =
      scope === 'all'
        ? await collections.ai_context.deleteMany(filter)
        : await collections.ai_context.deleteOne(filter);
    return res.deletedCount;
  } catch (err) {
    ctx.log.warn({ err, scope }, 'failed to clear ai context');
    return null;
  }
}
