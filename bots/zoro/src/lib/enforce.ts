import {
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import {
  keys,
  sanitizeText,
  type BotServices,
  type Logger,
  type SecurityEventRow,
} from '@eiflow/shared';
import {
  loadWhitelist,
  readConfig,
  recordSecurityEvent,
  thresholdFor,
  type AntinukeConfig,
} from './store.js';
import { captureSnapshot } from './snapshot.js';
import { applyLockdown } from './lockdown.js';
import { computeTrust, scaledThreshold, recordIncident } from './trust.js';

/**
 * Raid detection and punishment.
 *
 * Design rules, in order of importance:
 *   1. Nothing in this file may throw. Every step — whitelist lookup, Redis
 *      counter, role strip, kick, ban, Supabase insert, alert — has its own
 *      try/catch and logs its own failure. A failed punishment must never abort
 *      logging.
 *   2. Whitelist and owner checks run before the counter is touched, so trusted
 *      actors never burn Redis commands on a path that can never trip.
 *   3. Punishment is best-effort. If the kick fails we still record the event,
 *      because the audit trail is what an admin acts on afterwards.
 *   4. Every advanced feature (trust scaling, snapshot, lockdown) degrades when
 *      its backing store is unavailable — none of them is on the hot path to a
 *      "safe" verdict.
 */

/** Sliding window length in seconds (used as a fallback when config is absent). */
export const RAID_WINDOW_SEC = 10;
/** Baseline trip count; the live config supplies per-action thresholds. */
export const RAID_THRESHOLD = 5;
/** Cap on punishments for one actor+action per minute, so a missing permission cannot cause a loop. */
const MAX_PUNISHMENTS_PER_MINUTE = 3;
const PUNISH_LOCK_TTL_SEC = 60;

export type ThreatAction =
  | 'channel_delete'
  | 'role_delete'
  | 'member_kick'
  | 'member_ban'
  | 'bot_add'
  | 'webhook_create'
  | 'webhook_update'
  | 'role_permission_escalation';

export interface ThreatSignal {
  guildId: string;
  action: ThreatAction;
  actorId: string;
  /** Written to `security_events.event_type`. */
  eventType: string;
  severity: SecurityEventRow['severity'];
  /** Alert embed title. */
  title: string;
  /** One-line human summary, also used as the Mongo log message. */
  summary: string;
  details: Record<string, unknown>;
}

export interface EventEnv {
  client: Client;
  services: BotServices;
  log: Logger;
}

export interface ThreatOutcome {
  /** False when antinuke is disabled or the actor is exempt — nothing was done. */
  evaluated: boolean;
  /** True once the sliding-window threshold was exceeded. */
  tripped: boolean;
  punished: boolean;
}

const NOTHING: ThreatOutcome = { evaluated: false, tripped: false, punished: false };

/** Permissions whose acquisition by an untrusted actor is treated as critical. */
export const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageWebhooks,
] as const;

const PERMISSION_LABELS: Record<string, string> = {
  [String(PermissionFlagsBits.Administrator)]: 'Administrator',
  [String(PermissionFlagsBits.ManageGuild)]: 'Manage Server',
  [String(PermissionFlagsBits.ManageRoles)]: 'Manage Roles',
  [String(PermissionFlagsBits.ManageWebhooks)]: 'Manage Webhooks',
};

/**
 * Returns the dangerous permissions present in `after` but absent from `before`.
 * Accepts the decimal bitfield strings the audit log hands us.
 */
export function gainedDangerousPermissions(before: string | null, after: string | null): string[] {
  const oldBits = before ? safeBigInt(before) : 0n;
  const newBits = after ? safeBigInt(after) : 0n;
  if (newBits === 0n) return [];

  const gained = new PermissionsBitField(newBits & ~oldBits);
  return DANGEROUS_PERMISSIONS.filter((flag) => gained.has(flag)).map(
    (flag) => PERMISSION_LABELS[String(flag)] ?? String(flag),
  );
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

async function isExempt(env: EventEnv, signal: ThreatSignal): Promise<boolean> {
  const { client, services, log } = env;

  try {
    const guild = await client.guilds.fetch(signal.guildId).catch(() => null);
    if (!guild) return false;

    if (signal.actorId === guild.ownerId) return true;
    if (services.isOwner(signal.actorId)) return true;
    // Never punish ourselves.
    if (signal.actorId === client.user?.id) return true;

    const entries = await loadWhitelist(services, signal.guildId);
    if (entries.some((e) => e.target_type === 'user' && e.target_id === signal.actorId)) return true;

    const roleIds = entries.filter((e) => e.target_type === 'role').map((e) => e.target_id);
    if (roleIds.length === 0) return false;

    const member = await guild.members.fetch(signal.actorId).catch(() => null);
    if (!member) return false;

    return roleIds.some((id) => member.roles.cache.has(id));
  } catch (err) {
    // A failed lookup must never become a whitelist bypass. Owner and self
    // exemptions above are positive-only checks.
    log.error({ err, guildId: signal.guildId, actorId: signal.actorId }, 'exemption check failed — treating as untrusted');
    return false;
  }
}

/**
 * Applies the configured punishment to the actor.
 *
 *   - 'none'       → no action (notify-only posture).
 *   - 'stripRoles' → remove every role the bot is allowed to remove.
 *   - 'kick'       → strip, then kick.
 *   - 'ban'        → strip, then ban.
 *
 * The strip step runs for every destructive punishment so a banned/kicked actor
 * leaves as little privilege behind as possible.
 */
async function punish(
  env: EventEnv,
  signal: ThreatSignal,
  config: AntinukeConfig,
): Promise<{ punished: boolean; taken: string }> {
  const { client, log } = env;
  const steps: string[] = [];

  if (config.punishment === 'none') return { punished: false, taken: 'no punishment configured' };

  let member: GuildMember | null = null;
  try {
    const guild = await client.guilds.fetch(signal.guildId);
    member = await guild.members.fetch(signal.actorId);
  } catch (err) {
    log.warn({ err, actorId: signal.actorId }, 'could not resolve actor member — skipping punishment');
    return { punished: false, taken: 'actor not found' };
  }

  /* 1 — strip roles ---------------------------------------------------- */
  try {
    const botMember = member.guild.members.me;
    const botHighest = botMember?.roles.highest.position ?? 0;
    const removable = member.roles.cache.filter(
      (role) => role.id !== member.guild.roles.everyone.id && !role.managed && role.position < botHighest,
    );

    if (removable.size > 0) {
      await member.roles.remove(removable, `Antinuke: ${signal.eventType}`);
      steps.push(`stripped ${removable.size} role(s)`);
    } else {
      steps.push('no removable roles');
    }
  } catch (err) {
    log.warn({ err, actorId: signal.actorId }, 'failed to strip actor roles');
    steps.push('role strip failed');
  }

  /* 2 — ban / kick ------------------------------------------------------ */
  const reason = `Antinuke: ${signal.eventType} (raid detected)`;
  try {
    if (config.punishment === 'ban') {
      if (!member.bannable) steps.push('not bannable');
      else {
        await member.ban({ reason, deleteMessageSeconds: 0 });
        steps.push('banned');
      }
    } else if (config.punishment === 'kick') {
      if (!member.kickable) steps.push('not kickable');
      else {
        await member.kick(reason);
        steps.push('kicked');
      }
    }
  } catch (err) {
    log.warn({ err, actorId: signal.actorId }, `failed to ${config.punishment} actor`);
    steps.push(`${config.punishment} failed`);
  }

  const didStrip = steps.some((s) => s.startsWith('stripped'));
  const didBan = steps.includes('banned');
  const didKick = steps.includes('kicked');
  const punished =
    didBan || didKick || (config.punishment === 'stripRoles' && didStrip);
  return { punished, taken: steps.join(', ') };
}

async function sendAlert(
  env: EventEnv,
  signal: ThreatSignal,
  channelId: string,
  taken: string,
  effective: number,
): Promise<void> {
  const { client, services, log } = env;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      log.warn({ guildId: signal.guildId, channelId }, 'alert channel is not text based');
      return;
    }

    await (channel as GuildTextBasedChannel).send({
      embeds: [
        services.embeds.error('🚨 Antinuke triggered', signal.summary, {
          fields: [
            { name: 'Actor', value: `<@${signal.actorId}>`, inline: true },
            { name: 'Event', value: signal.eventType, inline: true },
            { name: 'Severity', value: signal.severity, inline: true },
            { name: 'Trip threshold', value: String(effective), inline: true },
            { name: 'Action taken', value: taken, inline: false },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    log.warn({ err, guildId: signal.guildId, channelId }, 'failed to send antinuke alert');
  }
}

/**
 * Entry point for every destructive event the bot observes. Never throws.
 *
 * Order: config → exemption → trust-aware threshold → sliding window →
 * punish-lock → snapshot / lockdown / punish → persist → alert.
 */
export async function evaluateThreat(env: EventEnv, signal: ThreatSignal): Promise<ThreatOutcome> {
  const { services, log, client } = env;

  let config: AntinukeConfig;
  try {
    config = await readConfig(services, signal.guildId);
  } catch (err) {
    log.error({ err, guildId: signal.guildId }, 'antinuke config read failed — skipping evaluation');
    return NOTHING;
  }

  if (!config.enabled) return NOTHING;

  if (await isExempt(env, signal)) return NOTHING;

  /* --- trust-aware effective threshold -------------------------------- */
  const windowSeconds = config.windowSeconds > 0 ? config.windowSeconds : RAID_WINDOW_SEC;
  let effective = thresholdFor(config, signal.action);
  if (config.trustMode) {
    try {
      const guild = await client.guilds.fetch(signal.guildId).catch(() => null);
      const member = guild ? await guild.members.fetch(signal.actorId).catch(() => null) : null;
      const trust = await computeTrust(services, log, signal.guildId, signal.actorId, member?.joinedAt ?? null);
      effective = scaledThreshold(thresholdFor(config, signal.action), trust.tier);
      signal.details = { ...signal.details, trustTier: trust.tier, trustScore: trust.score };
    } catch (err) {
      log.warn({ err, guildId: signal.guildId, actorId: signal.actorId }, 'trust scoring failed — using base threshold');
    }
  }

  /* --- sliding window -------------------------------------------------- */
  let count: number;
  try {
    count = await services.redis.slidingCount(
      keys.antinuke(signal.guildId, signal.actorId, signal.action),
      windowSeconds,
    );
  } catch (err) {
    // With no working counter we cannot tell a raid from normal admin work.
    log.error({ err, guildId: signal.guildId, action: signal.action }, 'sliding window unavailable');
    return NOTHING;
  }

  if (count <= effective) {
    log.debug(
      { guildId: signal.guildId, actorId: signal.actorId, action: signal.action, count, effective },
      'destructive action below raid threshold',
    );
    return { evaluated: true, tripped: false, punished: false };
  }

  /* --- rate-limit punishment itself ------------------------------------ */
  let attempts: number;
  try {
    attempts = await services.redis.incr(
      keys.antinuke(signal.guildId, signal.actorId, `${signal.action}:lock`),
      PUNISH_LOCK_TTL_SEC,
    );
  } catch (err) {
    log.error({ err, guildId: signal.guildId }, 'punishment lock unavailable');
    return { evaluated: true, tripped: true, punished: false };
  }

  if (attempts > MAX_PUNISHMENTS_PER_MINUTE) {
    log.warn(
      { guildId: signal.guildId, actorId: signal.actorId, action: signal.action, attempts },
      'raid still in progress but punishment cap reached',
    );
    return { evaluated: true, tripped: true, punished: false };
  }

  /* --- act: snapshot / lockdown / punish ------------------------------ */
  let taken = 'alert only (notify mode)';
  let punished = false;

  if (config.mode !== 'notify') {
    const guild = await client.guilds.fetch(signal.guildId).catch(() => null);

    if (config.snapshotOnChange && guild) {
      await captureSnapshot(services, log, guild, `raid:${signal.action}`, signal.actorId).catch(() => null);
    }
    if (config.lockdownOnRaid && guild) {
      await applyLockdown(services, log, guild, `Raid detected: ${signal.title}`).catch((err: unknown) =>
        log.warn({ err, guildId: signal.guildId }, 'lockdown-on-raid failed'),
      );
    }

    const res = await punish(env, signal, config);
    punished = res.punished;
    taken = res.taken;
  }

  if (config.trustMode) {
    void recordIncident(services, log, signal.guildId, signal.actorId, signal.severity);
  }

  /* --- persist --------------------------------------------------------- */
  try {
    await recordSecurityEvent(services, log, {
      guild_id: signal.guildId,
      event_type: signal.eventType,
      actor_id: signal.actorId,
      severity: signal.severity,
      details: { ...signal.details, windowCount: count, threshold: effective },
      action_taken: taken,
    });
  } catch (err) {
    log.error({ err, guildId: signal.guildId }, 'security event insert threw');
  }

  try {
    services.logs.push({
      bot_id: services.env.botId,
      guild_id: signal.guildId,
      channel_id: null,
      user_id: signal.actorId,
      action: `antinuke.${signal.action}`,
      level: 'error',
      message: sanitizeText(`${signal.summary} — ${taken}`, 512),
      meta: { ...signal.details, windowCount: count, effectiveThreshold: effective, actionTaken: taken },
      created_at: new Date(),
    });
  } catch (err) {
    log.error({ err, guildId: signal.guildId }, 'failed to buffer antinuke log doc');
  }

  /* --- alert ----------------------------------------------------------- */
  if (config.alert_channel) {
    await sendAlert(env, signal, config.alert_channel, taken, effective);
  }

  log.warn(
    { guildId: signal.guildId, actorId: signal.actorId, action: signal.action, count, taken },
    'antinuke triggered',
  );

  return { evaluated: true, tripped: true, punished };
}
