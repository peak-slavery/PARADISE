import type { CommandContext, XpDoc } from '@eiflow/shared';
import { readBotConfig, writeBotConfig } from '@eiflow/shared';

/**
 * Level Up persists in two places on purpose:
 *   Supabase `bot_configs` — the announcement channel (tiny, read-heavy)
 *   MongoDB `xp`           — the per-member counters (the write hot path)
 */

/**
 * A `type`, not an `interface`: `readBotConfig` constrains its generic to
 * `Record<string, unknown>` and TypeScript only grants implicit index
 * signatures to type aliases.
 */
export type LevelUpConfig = {
  level_channel: string | null;
};

export const DEFAULT_CONFIG: LevelUpConfig = { level_channel: null };

export function getConfig(ctx: CommandContext): Promise<LevelUpConfig> {
  return readBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, DEFAULT_CONFIG);
}

export async function setConfig(ctx: CommandContext, patch: Partial<LevelUpConfig>): Promise<boolean> {
  const current = await getConfig(ctx);
  return writeBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, {
    ...current,
    ...patch,
  });
}

export async function getXpDoc(ctx: CommandContext, guildId: string, userId: string): Promise<XpDoc | null> {
  const { xp } = await ctx.services.requireMongo();
  return xp.findOne({ guild_id: guildId, user_id: userId });
}

/** Highest XP first. Served by the `{ guild_id: 1, xp: -1 }` index. */
export async function topXp(ctx: CommandContext, guildId: string, limit: number): Promise<XpDoc[]> {
  const { xp } = await ctx.services.requireMongo();
  return xp.find({ guild_id: guildId }).sort({ xp: -1 }).limit(limit).toArray();
}

/** How many members have strictly more XP than `xp` — used for "rank #N". */
export async function membersAhead(ctx: CommandContext, guildId: string, xp: number): Promise<number> {
  const { xp: collection } = await ctx.services.requireMongo();
  return collection.countDocuments({ guild_id: guildId, xp: { $gt: xp } });
}
