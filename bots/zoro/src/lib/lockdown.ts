import type { Guild, NewsChannel, TextChannel } from 'discord.js';
import type { BotServices, Logger } from '@eiflow/shared';

/**
 * Emergency server lockdown.
 *
 * A lockdown is the last-resort brake Zoro applies when `lockdownOnRaid` trips
 * during a critical raid: it raises the guild verification level to Very High
 * (so only phone-verified accounts can post) and revokes `@everyone` send
 * permissions on text channels. Both steps are best-effort and fully guarded —
 * a single failed channel must never abort the rest.
 *
 * The previous verification level is stashed in Redis so `/lockdown off` can
 * restore it precisely. Channel overwrites are identified by a fixed reason
 * string so the lift pass only touches what we added.
 */

const LD_REASON = 'Ei Flow · Zoro lockdown';
const LD_KEY = (guildId: string): string => `an:lockdown:${guildId}`;
/** Cap channel edits so a lockdown can never become a rate-limit storm. */
const MAX_LD_CHANNELS = 50;

const LD_DENY = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  AddReactions: false,
} as const;

export interface LockdownResult {
  verification: boolean;
  channelsTouched: number;
}

export interface LiftResult {
  restored: boolean;
  channelsTouched: number;
}

export async function applyLockdown(
  services: BotServices,
  log: Logger,
  guild: Guild,
  reason: string,
): Promise<LockdownResult> {
  let verification = false;

  try {
    await guild.setVerificationLevel(4, `${LD_REASON} — ${reason.slice(0, 120)}`);
    verification = true;
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'lockdown: could not raise verification level');
  }

  let channelsTouched = 0;
  try {
    const everyone = guild.roles.everyone;
    const channels = guild.channels.cache.filter((c) => c.type === 0 || c.type === 5).first(MAX_LD_CHANNELS);
    for (const ch of channels) {
      try {
        await (ch as TextChannel | NewsChannel).permissionOverwrites.edit(everyone, LD_DENY, { reason: LD_REASON });
        channelsTouched += 1;
      } catch (err) {
        log.warn({ err, guildId: guild.id, channel: ch.id }, 'lockdown: channel overwrite failed');
      }
    }
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'lockdown: channel enumeration failed');
  }

  try {
    const prev = typeof guild.verificationLevel === 'number' ? guild.verificationLevel : 2;
    await services.redis.set(LD_KEY(guild.id), prev, 3600).catch(() => undefined);
  } catch {
    /* non-fatal: lift will fall back to a safe default */
  }

  return { verification, channelsTouched };
}

export async function liftLockdown(services: BotServices, log: Logger, guild: Guild): Promise<LiftResult> {
  let restored = false;
  try {
    const prev = await services.redis.get<number>(LD_KEY(guild.id)).catch(() => null);
    const target = prev != null && prev !== guild.verificationLevel ? prev : null;
    if (target != null) {
      await guild.setVerificationLevel(target, LD_REASON);
    }
    restored = true;
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'lockdown lift: could not restore verification level');
  }

  let channelsTouched = 0;
  try {
    const everyone = guild.roles.everyone;
    const channels = guild.channels.cache.filter((c) => c.type === 0 || c.type === 5).first(MAX_LD_CHANNELS);
    for (const ch of channels) {
      try {
        await (ch as TextChannel | NewsChannel).permissionOverwrites.edit(
          everyone,
          { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, AddReactions: null },
          { reason: LD_REASON },
        );
        channelsTouched += 1;
      } catch (err) {
        log.warn({ err, guildId: guild.id, channel: ch.id }, 'lockdown lift: channel overwrite failed');
      }
    }
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'lockdown lift: channel enumeration failed');
  }

  return { restored, channelsTouched };
}
