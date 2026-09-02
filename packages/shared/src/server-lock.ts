import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  type Client,
} from 'discord.js';
import type { TypedSupabase } from './db/supabase.js';
import type { Logger } from './logger.js';
import { reportError } from './errors.js';
import type { Env } from './env.js';
import { isGuildWhitelisted, isPermanentGuild } from './whitelist.js';
import type { Kv } from './redis.js';

export interface ServerLockDeps {
  env: Env;
  log: Logger;
  supabase: TypedSupabase | null;
  kv?: Kv;
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
  env?: Pick<Env, 'devGuildId' | 'mainGuildId'>,
  kv?: Kv,
): Promise<boolean> {
  return isGuildWhitelisted(supabase, guildId, env, kv);
}

async function upsertServer(
  supabase: TypedSupabase | null,
  guild: { id: string; name: string; ownerId: string; iconURL(): string | null },
  authorized: boolean,
): Promise<void> {
  if (!supabase) return;
  await supabase.from('servers').upsert(
    {
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL(),
      owner_id: guild.ownerId,
      authorized,
    },
    { onConflict: 'guild_id' },
  );
}

async function postAuthorizationRequest(
  client: Client,
  env: Env,
  guild: { id: string; name: string; ownerId: string; memberCount: number },
): Promise<void> {
  if (!env.devGuildId || !env.devAuthChannelId || guild.id === env.devGuildId) return;
  const channel = await client.channels.fetch(env.devAuthChannelId).catch(() => null);
  if (!channel || channel.isDMBased() || !('send' in channel)) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Guild authorization request')
    .setDescription('A bot was invited to a guild that is not currently whitelisted. Review the guild before granting command access.')
    .addFields(
      { name: 'Guild', value: `${guild.name}\n\`${guild.id}\``, inline: true },
      { name: 'Owner', value: `<@${guild.ownerId}>\n\`${guild.ownerId}\``, inline: true },
      { name: 'Members', value: String(guild.memberCount), inline: true },
    )
    .setFooter({ text: 'Only the master operator can approve this request.' })
    .setTimestamp();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`guild-auth:full:${guild.id}`).setLabel('Approve full').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`guild-auth:temp:${guild.id}`).setLabel('Temporary 24h').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`guild-auth:deny:${guild.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
  await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
}

/**
 * Server-lock: record new guilds and keep them command-locked until approved.
 * Fixed dev/main guilds bypass the review flow; all other guilds receive a
 * private review request in the configured dev channel.
 */
export function attachServerLock(client: Client, deps: ServerLockDeps): void {
  const reconcile = async (): Promise<void> => {
    for (const guild of client.guilds.cache.values()) {
      try {
        if (isPermanentGuild(deps.env, guild.id)) {
          await upsertServer(deps.supabase, guild, true);
          continue;
        }
        if (!(await isGuildAuthorized(deps.supabase, guild.id, deps.env, deps.kv))) {
          deps.log.warn({ guildId: guild.id, name: guild.name }, 'guild remains command-locked pending authorization');
        }
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
      const permanent = isPermanentGuild(deps.env, guild.id);
      const allowed = permanent || await isGuildAuthorized(deps.supabase, guild.id, deps.env, deps.kv);
      await upsertServer(deps.supabase, guild, allowed);

      if (!allowed) {
        deps.log.warn({ guildId: guild.id, name: guild.name }, 'guild joined pending authorization');
        deps.record({
          action: 'server_lock.pending',
          level: 'warn',
          message: `Guild ${guild.name} is pending authorization`,
          guildId: guild.id,
          meta: { guildName: guild.name, memberCount: guild.memberCount },
        });
        await postAuthorizationRequest(client, deps.env, guild);
        return;
      }

      deps.record({
        action: 'server_lock.joined',
        level: 'info',
        message: `Joined authorized guild ${guild.name} (${guild.id})`,
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
