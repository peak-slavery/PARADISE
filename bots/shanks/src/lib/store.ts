import type { GuildMember } from 'discord.js';
import type { CommandContext, ModActionRow } from '@eiflow/shared';
import { readBotConfig, UserError, writeBotConfig } from '@eiflow/shared';

export type ModActionType = 'warn' | 'mute' | 'unmute' | 'ban' | 'unban' | 'purge' | 'kick' | 'automod';

export interface RecordActionInput {
  action: ModActionType;
  targetId: string;
  reason: string;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  active?: boolean;
  meta?: Record<string, unknown>;
}

// Must be a `type`, not an `interface`: readBotConfig constrains T to
// Record<string, unknown>, and interfaces get no implicit index signature.
export type ModerationConfig = {
  automod_log_channel: string | null;
};

export const DEFAULT_CONFIG: ModerationConfig = { automod_log_channel: null };

/**
 * Writes a moderation record to Supabase (source of truth) and mirrors it to
 * MongoDB `logs` through the batched sink.
 *
 * Returns false when persistence failed. Commands surface that as a warning
 * rather than lying — the Discord-side action has already been applied at that
 * point, so claiming failure would be worse than admitting partial success.
 */
export async function recordAction(ctx: CommandContext, input: RecordActionInput): Promise<boolean> {
  const { services } = ctx;
  const db = services.supabase;

  const doc = {
    bot_id: services.env.botId,
    guild_id: ctx.guildId,
    channel_id: ctx.interaction.channelId,
    user_id: ctx.userId,
    action: `mod.${input.action}`,
    level: 'info' as const,
    message: `${input.action} applied to ${input.targetId}: ${input.reason}`,
    meta: { targetId: input.targetId, ...input.meta },
    created_at: new Date(),
  };

  if (!db) {
    ctx.log.warn({ action: input.action }, 'supabase unavailable — action not persisted');
    services.logs.push(doc);
    return false;
  }

  try {
    const { error } = await db.from('mod_actions').insert({
      guild_id: ctx.guildId,
      bot_id: services.env.botId,
      action: input.action,
      target_id: input.targetId,
      moderator_id: ctx.userId,
      reason: input.reason,
      duration_seconds: input.durationSeconds ?? null,
      active: input.active ?? true,
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
    });

    if (error) {
      ctx.log.error({ err: error }, 'failed to persist mod action');
      services.logs.push(doc);
      return false;
    }

    services.logs.push(doc);
    return true;
  } catch (err) {
    ctx.log.error({ err }, 'mod action persistence threw');
    services.logs.push(doc);
    return false;
  }
}

/**
 * Hierarchy guard: the bot must outrank the target, the caller must outrank the
 * target, and the server owner is untouchable.
 */
export function assertModeratable(ctx: CommandContext, member: GuildMember): void {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');

  if (member.id === guild.ownerId) {
    throw new UserError('The server owner cannot be moderated.');
  }
  if (member.id === ctx.userId) {
    throw new UserError('You cannot moderate yourself.');
  }

  const targetPos = member.roles.highest.position;

  // An APIInteractionGuildMember exposes roles as a plain string[], so the
  // array check is what narrows this to a cached GuildMember.
  const executor = ctx.interaction.member;
  if (executor && 'roles' in executor && !Array.isArray(executor.roles) && !ctx.services.isOwner(ctx.userId)) {
    if (targetPos >= (executor.roles.highest?.position ?? 0)) {
      throw new UserError('That member has an equal or higher role than you.');
    }
  }

  const botMember = guild.members.me;
  if (botMember && targetPos >= botMember.roles.highest.position) {
    throw new UserError('That member has an equal or higher role than me.');
  }
}

export async function listActiveWarns(
  ctx: CommandContext,
  targetId: string,
): Promise<Pick<ModActionRow, 'id' | 'reason' | 'moderator_id' | 'created_at'>[]> {
  const db = ctx.services.requireSupabase();
  const { data, error } = await db
    .from('mod_actions')
    .select('id, reason, moderator_id, created_at')
    .eq('guild_id', ctx.guildId)
    .eq('target_id', targetId)
    .eq('action', 'warn')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<ModActionRow, 'id' | 'reason' | 'moderator_id' | 'created_at'>[];
}

export async function clearWarn(ctx: CommandContext, id: string): Promise<boolean> {
  const db = ctx.services.requireSupabase();
  const { error } = await db
    .from('mod_actions')
    .update({ active: false })
    .eq('id', id)
    .eq('guild_id', ctx.guildId);
  return !error;
}

export async function getConfig(ctx: CommandContext): Promise<ModerationConfig> {
  return readBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, DEFAULT_CONFIG);
}

export async function setConfig(ctx: CommandContext, patch: Partial<ModerationConfig>): Promise<boolean> {
  const current = await getConfig(ctx);
  return writeBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, {
    ...current,
    ...patch,
  });
}

/** Best-effort DM notification; a blocked DM must never fail the command. */
export async function notifyTarget(ctx: CommandContext, targetId: string, embed: unknown): Promise<void> {
  try {
    const user = await ctx.client.users.fetch(targetId);
    await user.send({ embeds: [embed as never] });
  } catch {
    ctx.log.debug({ targetId }, 'could not DM target (DMs closed or user left)');
  }
}
