import { PermissionFlagsBits } from 'discord.js';
import {
  QueueTimeoutError,
  readBotConfigWithStatus,
  UserError,
  writeBotConfig,
  type AntinukeWhitelistRow,
  type BotServices,
  type CommandContext,
  type Logger,
  type SecurityEventsInsert,
  type SecurityEventRow,
} from '@eiflow/shared';
import type { ThreatAction } from './enforce.js';

/**
 * Persistence helpers for the antinuke bot. Every Supabase call is optional by
 * construction: if the database is unreachable the bot keeps protecting the
 * guild with the last config it managed to read, and says so in the reply.
 */

/**
 * `keys` in @eiflow/shared has no whitelist entry yet, so the cache key is built
 * here and deliberately prefixed to match the `an:` antinuke namespace.
 */
const whitelistCacheKey = (guildId: string): string => `an:wl:${guildId}`;
const WHITELIST_CACHE_TTL_SEC = 60;

/** Hard cap on rows rendered in one embed — Discord allows at most 25 fields. */
export const MAX_ROWS = 25;

/**
 * A type alias, not an interface: `readBotConfig<T extends Record<string, unknown>>`
 * only accepts object types carrying an implicit index signature, which
 * TypeScript grants to aliases but not to interfaces.
 *
 * Every key here is also a `key` in the dashboard's antinuke config form
 * (`dashboard/lib/bots.ts`), so the control plane drives the engine directly.
 */
export type AntinukeConfig = {
  /** Master switch. Off by default — Zoro must be opted into explicitly. */
  enabled: boolean;
  /** Channel that receives raid alerts. Null means "no alerts". */
  alert_channel: string | null;
  /** revert = revert + quarantine, revertOnly = revert only, notify = alert only. */
  mode: 'revert' | 'revertOnly' | 'notify';
  /** Mass-ban / mass-kick trip count within the window. */
  banThreshold: number;
  /** Channel-delete trip count within the window. */
  channelThreshold: number;
  /** Role-create / role-delete trip count within the window. */
  roleThreshold: number;
  /** Sliding-window length in seconds (Redis-backed). */
  windowSeconds: number;
  /** ban | kick | stripRoles | none. */
  punishment: 'ban' | 'kick' | 'stripRoles' | 'none';
  /** Watch webhook creation as a raid signal. */
  protectWebhooks: boolean;
  /** Use the SLM to catch evasive bad words AutoMod's static rules miss. */
  automodSlm: boolean;
  /** Minimum SLM confidence (0..1) before a message is escalated. */
  slmThreshold: number;
  /** Revoke send/create permissions fleet-wide on a critical raid. */
  lockdownOnRaid: boolean;
  /** Capture roles+channels before a revert so it can be rolled back. */
  snapshotOnChange: boolean;
  /** Track a per-member trust score; low-trust actors trip faster. */
  trustMode: boolean;
};

export const DEFAULT_CONFIG: AntinukeConfig = {
  enabled: false,
  alert_channel: null,
  mode: 'revert',
  banThreshold: 3,
  channelThreshold: 2,
  roleThreshold: 3,
  windowSeconds: 60,
  punishment: 'ban',
  protectWebhooks: true,
  automodSlm: true,
  slmThreshold: 0.75,
  lockdownOnRaid: false,
  snapshotOnChange: true,
  trustMode: true,
};

const CONFIG_CACHE_TTL_MS = 5 * 60_000;
const CONFIG_CACHE = new Map<string, { config: AntinukeConfig; expiresAt: number }>();

// If no verified configuration is available, protect rather than silently
// disabling antinuke. The emergency posture avoids automatic punishment while
// still detecting and notifying on every destructive signal.
const EMERGENCY_CONFIG: AntinukeConfig = {
  ...DEFAULT_CONFIG,
  enabled: true,
  mode: 'notify',
  punishment: 'none',
  banThreshold: 1,
  channelThreshold: 1,
  roleThreshold: 1,
  windowSeconds: 10,
};

/** Returns the trip threshold for a given destructive action. */
export function thresholdFor(config: AntinukeConfig, action: ThreatAction): number {
  switch (action) {
    case 'member_ban':
    case 'member_kick':
      return config.banThreshold;
    case 'channel_delete':
      return config.channelThreshold;
    case 'role_delete':
    case 'role_permission_escalation':
      return config.roleThreshold;
    case 'bot_add':
    case 'webhook_create':
    case 'webhook_update':
      // Webhooks/bots are rarer, so trip a little sooner than roles.
      return Math.max(2, Math.round(config.roleThreshold * 0.75));
    default:
      return config.roleThreshold;
  }
}

export type WhitelistTargetType = AntinukeWhitelistRow['target_type'];

export interface WhitelistTarget {
  targetType: WhitelistTargetType;
  targetId: string;
}

export async function readConfig(services: BotServices, guildId: string): Promise<AntinukeConfig> {
  const key = `${guildId}:${services.env.botId}`;
  const result = await readBotConfigWithStatus(services.supabase, guildId, services.env.botId, DEFAULT_CONFIG);
  if (result.available) {
    CONFIG_CACHE.set(key, { config: result.config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return result.config;
  }

  const cached = CONFIG_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  return EMERGENCY_CONFIG;
}

export async function writeConfig(
  services: BotServices,
  guildId: string,
  patch: Partial<AntinukeConfig>,
): Promise<boolean> {
  const current = await readConfig(services, guildId);
  return writeBotConfig(services.supabase, guildId, services.env.botId, { ...current, ...patch });
}

export async function getConfig(ctx: CommandContext): Promise<AntinukeConfig> {
  return readConfig(ctx.services, ctx.guildId);
}

export async function setConfig(ctx: CommandContext, patch: Partial<AntinukeConfig>): Promise<boolean> {
  return writeConfig(ctx.services, ctx.guildId, patch);
}

/**
 * Loads the guild whitelist, cached in Redis for a minute.
 *
 * The cache matters: the whitelist is read on every destructive audit-log entry,
 * so without it a raid would generate one Supabase query per event. On a cache
 * miss with the database down we fall back to an empty list, which is the safe
 * direction — nobody gets an unexpected bypass.
 */
export async function loadWhitelist(
  services: BotServices,
  guildId: string,
): Promise<AntinukeWhitelistRow[]> {
  const cacheKey = whitelistCacheKey(guildId);

  const cached = await services.redis.get<AntinukeWhitelistRow[]>(cacheKey).catch(() => null);
  if (cached) return cached;

  const db = services.supabase;
  if (!db) return [];

  const { data, error } = await db
    .from('antinuke_whitelist')
    .select('*')
    .eq('guild_id', guildId)
    .limit(200);

  if (error || !data) return [];

  await services.redis.set(cacheKey, data, WHITELIST_CACHE_TTL_SEC).catch(() => undefined);
  return data;
}

export async function invalidateWhitelistCache(services: BotServices, guildId: string): Promise<void> {
  await services.redis.del(whitelistCacheKey(guildId)).catch(() => undefined);
}

export async function addWhitelistEntry(ctx: CommandContext, target: WhitelistTarget): Promise<boolean> {
  const db = ctx.services.requireSupabase();
  const { error } = await db.from('antinuke_whitelist').insert({
    guild_id: ctx.guildId,
    target_type: target.targetType,
    target_id: target.targetId,
  });

  await invalidateWhitelistCache(ctx.services, ctx.guildId);
  return !error;
}

export async function removeWhitelistEntry(ctx: CommandContext, target: WhitelistTarget): Promise<boolean> {
  const db = ctx.services.requireSupabase();
  const { data, error } = await db
    .from('antinuke_whitelist')
    .delete()
    .eq('guild_id', ctx.guildId)
    .eq('target_type', target.targetType)
    .eq('target_id', target.targetId)
    .select('id');

  await invalidateWhitelistCache(ctx.services, ctx.guildId);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Writes a row to Supabase `security_events`. Returns false when the write
 * failed; callers log it and continue — the punishment has already happened and
 * losing the audit trail must not undo or block it.
 */
export async function recordSecurityEvent(
  services: BotServices,
  log: Logger,
  row: SecurityEventsInsert,
): Promise<boolean> {
  const db = services.supabase;
  if (!db) {
    log.warn({ guildId: row.guild_id, eventType: row.event_type }, 'supabase down — security event not persisted');
    return false;
  }

  const { error } = await db.from('security_events').insert(row);
  if (error) {
    log.error({ err: error, eventType: row.event_type }, 'failed to record security event');
    return false;
  }
  return true;
}

/** Reads the most recent security events for a guild, newest first. */
export async function listSecurityEvents(ctx: CommandContext, limit: number): Promise<SecurityEventRow[]> {
  const db = ctx.services.requireSupabase();
  const { data, error } = await db
    .from('security_events')
    .select('*')
    .eq('guild_id', ctx.guildId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), MAX_ROWS));

  if (error) {
    ctx.log.error({ err: error, guildId: ctx.guildId }, 'failed to read security log');
    throw new UserError('Could not read the security log right now. Please try again later.');
  }
  return data ?? [];
}

/**
 * Runs a Supabase query through the shared task queue so a slow round trip can
 * never pile up on the gateway. ServiceBusyError is left to the runtime to
 * render; a timeout is downgraded to a UserError so it stays out of Sentry.
 */
export async function runSecurityQuery<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await ctx.services.queue.run(fn, { timeoutMs: 10_000, maxPending: 16 });
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      throw new UserError('The security log query timed out. Try again with a smaller limit.');
    }
    throw err;
  }
}

/** Resolves the mutually exclusive `user` / `role` options on /whitelist. */
export function resolveWhitelistTarget(ctx: CommandContext): WhitelistTarget {
  const user = ctx.interaction.options.getUser('user');
  const role = ctx.interaction.options.getRole('role');

  if (user && role) throw new UserError('Specify either a user or a role, not both.');
  if (user) return { targetType: 'user', targetId: user.id };
  if (role) return { targetType: 'role', targetId: role.id };

  throw new UserError('You must specify a user or a role.');
}

/**
 * Restricts the new Zoro control commands to users who can manage the server
 * (or bot owners). Keeps the security surface off the hands of ordinary
 * members — the audit log and dashboard remain the only places to change policy.
 */
export function assertManager(ctx: CommandContext): void {
  const perms = ctx.interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.ManageGuild)) return;
  if (ctx.services.isOwner(ctx.userId)) return;
  throw new UserError('You need the "Manage Server" permission (or to be a bot owner) to use this command.');
}
