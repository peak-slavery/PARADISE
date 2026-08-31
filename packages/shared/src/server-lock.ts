import { Events, type Client } from 'discord.js';
import type { TypedSupabase } from './db/supabase.js';
import type { Logger } from './logger.js';
import { reportError } from './errors.js';
import type { Env } from './env.js';

export interface ServerLockDeps {
  env: Env;
  log: Logger;
  supabase: TypedSupabase | null;
  /** Records the event to MongoDB `logs` (batched). */
  record: (doc: {
    action: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    guildId?: string | null;
    meta?: Record<string, unknown>;
  }) => void;
}

/**
 * A guild is authorized when a row exists in `servers` with authorized = true.
 * With Supabase unavailable we fail CLOSED: a missing authorization source
 * must never allow a bot to operate in an unverified guild.
 */
export async function isGuildAuthorized(
  supabase: TypedSupabase | null,
  guildId: string,
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('servers')
      .select('authorized')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) return false;
    return data?.authorized === true;
  } catch {
    return false;
  }
}

/**
 * Server-lock: on guildCreate, verify authorization. Unauthorized servers are
 * left immediately, the attempt is logged to Mongo, and Sentry is alerted.
 */
export function attachServerLock(client: Client, deps: ServerLockDeps): void {
  const reconcile = async (): Promise<void> => {
    for (const guild of client.guilds.cache.values()) {
      try {
        if (await isGuildAuthorized(deps.supabase, guild.id)) continue;
        deps.log.warn({ guildId: guild.id, name: guild.name }, 'unauthorized guild — leaving during reconciliation');
        await guild.leave();
        deps.record({
          action: 'server_lock.reconciled_leave',
          level: 'warn',
          guildId: guild.id,
          message: 'Left an unauthorized guild during authorization reconciliation',
        });
      } catch (err) {
        deps.log.error({ err, guildId: guild.id }, 'guild authorization reconciliation failed');
      }
    }
  };

  client.once(Events.ClientReady, () => {
    void reconcile();
    const timer = setInterval(() => void reconcile(), 5 * 60_000);
    timer.unref?.();
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      const allowed = await isGuildAuthorized(deps.supabase, guild.id);

      if (!allowed) {
        deps.log.warn({ guildId: guild.id, name: guild.name }, 'unauthorized guild — leaving');

        deps.record({
          action: 'server_lock.blocked',
          level: 'warn',
          message: `Blocked unauthorized guild ${guild.name} (${guild.id})`,
          guildId: guild.id,
          meta: { guildName: guild.name, memberCount: guild.memberCount },
        });

        reportError(new Error(`Unauthorized guild join attempt: ${guild.id}`), {
          botId: deps.env.botId,
          guildId: guild.id,
        });

        await guild.leave();
        return;
      }

      // Upsert so the dashboard always has a row with the latest name.
      if (deps.supabase) {
        await deps.supabase.from('servers').upsert(
          {
            guild_id: guild.id,
            name: guild.name,
            owner_id: guild.ownerId,
            authorized: true,
          },
          { onConflict: 'guild_id' },
        );
      }

      deps.record({
        action: 'server_lock.joined',
        level: 'info',
        message: `Joined ${guild.name} (${guild.id})`,
        guildId: guild.id,
        meta: { memberCount: guild.memberCount },
      });

      deps.log.info({ guildId: guild.id, name: guild.name }, 'authorized guild joined');
    } catch (err) {
      deps.log.error({ err, guildId: guild.id }, 'server lock handler failed');
      reportError(err, { botId: deps.env.botId, guildId: guild.id });
    }
  });

  // Keep the server directory fresh without extra writes on every event.
  client.on(Events.GuildDelete, async (guild) => {
    deps.record({
      action: 'server_lock.removed',
      level: 'info',
      message: `Removed from ${guild.name ?? 'unknown'} (${guild.id})`,
      guildId: guild.id,
    });
  });
}
