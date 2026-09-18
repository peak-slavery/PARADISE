import {
  AuditLogEvent,
  Events,
  type Client,
  type Guild,
} from 'discord.js';
import type { TypedSupabase } from './db/supabase.js';
import type { Logger } from './logger.js';
import { reportError } from './errors.js';
import type { Env } from './env.js';
import { resolveGuildAuthorization } from './whitelist.js';
import type { Kv } from './redis.js';

export interface ServerLockDeps {
  env: Pick<Env, 'runtimeEnvironment' | 'botId'>;
  log: Logger;
  supabase: TypedSupabase | null;
  kv?: Kv;
  /** Receives the result of every server-lock reconciliation. */
  onReady?: (ready: boolean) => void;
  /** Records the event to MongoDB `logs` (batched). */
  record: (doc: {
    action: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    guildId?: string | null;
    meta?: Record<string, unknown>;
  }) => void;
}

export interface ServerLockControl {
  stop: () => void;
  reconcile: () => Promise<boolean>;
  isReady: () => boolean;
}

/**
 * Resolve the canonical environment-scoped guild boundary. Database rows and
 * cache entries can only narrow access; they can never add a guild to the
 * approved set.
 */
export async function isGuildAuthorized(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: Pick<Env, 'runtimeEnvironment'>,
  kv?: Kv,
): Promise<boolean> {
  return (await resolveGuildAuthorization(supabase, guildId, env, kv)) === 'allowed';
}

async function upsertServer(
  supabase: TypedSupabase | null,
  guild: { id: string; name: string; ownerId: string; iconURL(): string | null },
): Promise<void> {
  if (!supabase) return;
  await supabase.from('servers').upsert(
    {
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL(),
      owner_id: guild.ownerId,
      authorized: true,
    },
    { onConflict: 'guild_id' },
  );
}

async function recordBotInviter(
  client: Client,
  supabase: TypedSupabase | null,
  guildId: string,
): Promise<void> {
  if (!supabase || !client.user) return;

  try {
    const audit = await client.guilds.cache.get(guildId)?.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 10,
    });
    if (!audit) return;

    const now = Date.now();
    const entry = audit.entries.find((candidate) => {
      const executorId = candidate.executor?.id;
      const targetId = candidate.target && 'id' in candidate.target ? candidate.target.id : null;
      return Boolean(
        executorId &&
          targetId === client.user?.id &&
          now - candidate.createdTimestamp >= 0 &&
          now - candidate.createdTimestamp <= 15 * 60_000,
      );
    });
    const inviterId = entry?.executor?.id;
    if (!inviterId) return;

    await supabase.from('guild_access').upsert(
      {
        guild_id: guildId,
        discord_user_id: inviterId,
        access_source: 'inviter',
        verified_at: new Date(entry.createdTimestamp).toISOString(),
        revoked_at: null,
      },
      { onConflict: 'guild_id,discord_user_id,access_source' },
    );
  } catch {
    // Audit-log access is optional and may be unavailable without the View
    // Audit Log permission. Never block the server-lock decision on it.
  }
}

/**
 * Server-lock: the canonical guild policy is the only membership boundary.
 * Unapproved guilds are left immediately. Authorization outages and persistence
 * failures make readiness false until a later reconciliation succeeds.
 */
export function attachServerLock(client: Client, deps: ServerLockDeps): ServerLockControl {
  let ready = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let reconciliation: Promise<boolean> | null = null;

  const publishReady = (value: boolean): void => {
    ready = value;
    deps.onReady?.(value);
  };

  const leaveUnauthorized = async (
    guild: { id: string; name: string; memberCount?: number; leave(): Promise<unknown> },
    reason: 'denied' | 'unavailable',
  ): Promise<boolean> => {
    deps.log.warn({ guildId: guild.id, name: guild.name, reason }, 'guild is not authorized; leaving');
    deps.record({
      action: reason === 'denied' ? 'SECURITY_UNAUTHORIZED_GUILD' : 'SECURITY_AUTHORIZATION_UNAVAILABLE',
      level: 'warn',
      message: `Guild ${guild.name} was rejected by the canonical guild policy`,
      guildId: guild.id,
      meta: {
        reason,
        guildName: guild.name,
        ...(guild.memberCount === undefined ? {} : { memberCount: guild.memberCount }),
      },
    });
    try {
      await guild.leave();
      return true;
    } catch (error) {
      deps.log.error({ err: error, guildId: guild.id }, 'failed to leave unauthorized guild');
      reportError(error, { botId: deps.env.botId, guildId: guild.id });
      return false;
    }
  };

  const reconcileOnce = async (): Promise<boolean> => {
    // Authorization outages are still a definitive readiness failure. Iterate
    // the current guild cache so every unavailable guild is rejected before a
    // later recovery attempt can make the bot reachable again.
    let succeeded = Boolean(deps.supabase);
    for (const guild of client.guilds.cache.values()) {
      let authorization: Awaited<ReturnType<typeof resolveGuildAuthorization>>;
      try {
        authorization = await resolveGuildAuthorization(deps.supabase, guild.id, deps.env, deps.kv);
      } catch (error) {
        succeeded = false;
        deps.log.error({ err: error, guildId: guild.id }, 'guild authorization reconciliation failed');
        reportError(error, { botId: deps.env.botId, guildId: guild.id });
        await leaveUnauthorized(guild, 'unavailable');
        continue;
      }

      if (authorization === 'unavailable') {
        succeeded = false;
        await leaveUnauthorized(guild, 'unavailable');
        continue;
      }
      if (authorization !== 'allowed') {
        const left = await leaveUnauthorized(guild, 'denied');
        if (!left) succeeded = false;
        continue;
      }

      try {
        await upsertServer(deps.supabase, guild);
        await recordBotInviter(client, deps.supabase, guild.id);
        deps.record({
          action: 'server_lock.joined',
          level: 'info',
          message: `Joined authorized guild ${guild.name} (${guild.id})`,
          guildId: guild.id,
          meta: { memberCount: guild.memberCount },
        });
        deps.log.info({ guildId: guild.id, name: guild.name }, 'authorized guild reconciled');
      } catch (error) {
        succeeded = false;
        deps.log.error({ err: error, guildId: guild.id }, 'authorized guild persistence failed');
        reportError(error, { botId: deps.env.botId, guildId: guild.id });
        deps.record({
          action: 'server_lock.persistence_failed',
          level: 'error',
          message: `Authorized guild ${guild.name} could not be persisted`,
          guildId: guild.id,
        });
      }
    }

    publishReady(succeeded);
    return succeeded;
  };

  const reconcile = (): Promise<boolean> => {
    if (!reconciliation) {
      reconciliation = reconcileOnce().finally(() => {
        reconciliation = null;
      });
    }
    return reconciliation;
  };

  const markUnavailable = (): void => {
    publishReady(false);
  };

  const handleReady = (): void => {
    if (stopped) return;
    void reconcile();
    if (!timer) {
      timer = setInterval(() => {
        void reconcile();
      }, 5 * 60_000);
      timer.unref?.();
    }
  };

  const handleGuildCreate = async (guild: Guild): Promise<void> => {
    let authorized: boolean;
    try {
      authorized = await isGuildAuthorized(deps.supabase, guild.id, deps.env, deps.kv);
    } catch (error) {
      publishReady(false);
      deps.log.error({ err: error, guildId: guild.id }, 'guild authorization check failed');
      reportError(error, { botId: deps.env.botId, guildId: guild.id });
      await leaveUnauthorized(guild, 'unavailable');
      return;
    }

    if (!authorized) {
      publishReady(false);
      await leaveUnauthorized(guild, 'denied');
      return;
    }

    try {
      await upsertServer(deps.supabase, guild);
      await recordBotInviter(client, deps.supabase, guild.id);
      deps.record({
        action: 'server_lock.joined',
        level: 'info',
        message: `Joined authorized guild ${guild.name} (${guild.id})`,
        guildId: guild.id,
        meta: { memberCount: guild.memberCount },
      });
      deps.log.info({ guildId: guild.id, name: guild.name }, 'authorized guild joined');
    } catch (error) {
      publishReady(false);
      deps.log.error({ err: error, guildId: guild.id }, 'authorized guild persistence failed; retaining guild membership');
      reportError(error, { botId: deps.env.botId, guildId: guild.id });
      deps.record({
        action: 'server_lock.persistence_failed',
        level: 'error',
        message: `Authorized guild ${guild.name} could not be persisted`,
        guildId: guild.id,
      });
    }
  };

  const handleShardResume = (): void => {
    if (!stopped) void reconcile();
  };

  const handleGuildDelete = (): void => {
    deps.record({
      action: 'server_lock.removed',
      level: 'info',
      message: 'Guild membership removed',
    });
  };

  client.once(Events.ClientReady, handleReady);
  client.on(Events.ShardResume, handleShardResume);
  client.on(Events.Invalidated, markUnavailable);
  client.on(Events.ShardReconnecting, markUnavailable);
  client.on(Events.ShardDisconnect, markUnavailable);
  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.GuildDelete, handleGuildDelete);

  const stop = (): void => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    client.off(Events.ClientReady, handleReady);
    client.off(Events.ShardResume, handleShardResume);
    client.off(Events.Invalidated, markUnavailable);
    client.off(Events.ShardReconnecting, markUnavailable);
    client.off(Events.ShardDisconnect, markUnavailable);
    client.off(Events.GuildCreate, handleGuildCreate);
    client.off(Events.GuildDelete, handleGuildDelete);
  };

  return { stop, reconcile, isReady: () => ready };
}
