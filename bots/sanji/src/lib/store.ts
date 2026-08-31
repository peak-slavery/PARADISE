import {
  ChannelType,
  type APIEmbedField,
  type Client,
  type EmbedBuilder,
  type GuildTextBasedChannel,
} from 'discord.js';
import {
  escapeMentions,
  QueueTimeoutError,
  readBotConfig,
  sanitizeText,
  truncateFieldValue,
  UserError,
  writeBotConfig,
  type BotServices,
  type CommandContext,
  type EmbedKind,
  type LogDoc,
  type Logger,
} from '@eiflow/shared';

/** Message bodies are truncated to this many chars before being stored/shown. */
export const CONTENT_LIMIT = 300;
/** Hard cap on rows rendered in one embed — Discord allows at most 25 fields. */
export const MAX_ROWS = 25;

export const LOG_CATEGORIES = ['messages', 'members', 'channels', 'roles', 'voice', 'moderation'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

/**
 * A type alias, not an interface: `readBotConfig<T extends Record<string, unknown>>`
 * only accepts object types that carry an implicit index signature, which
 * TypeScript grants to aliases but not to interfaces.
 */
export type LoggingConfig = {
  /** Channel that receives live log embeds. Null until /setlogchannel is used. */
  log_channel: string | null;
  /** Per-category switches. A missing key means "enabled". */
  events: Partial<Record<LogCategory, boolean>>;
}

export const DEFAULT_CONFIG: LoggingConfig = {
  log_channel: null,
  events: {},
};

/**
 * Action catalog: `log.<category>.<event>`.
 *
 * The shape lets `/message logs` and `/other logs` select with `$in` against an
 * explicit list (index-friendly) instead of a regex scan over the collection.
 */
export const MESSAGE_LOG_ACTIONS = [
  'log.message.delete',
  'log.message.update',
  'log.message.bulk_delete',
] as const;

export const OTHER_LOG_ACTIONS = [
  'log.member.add',
  'log.member.remove',
  'log.channel.create',
  'log.channel.delete',
  'log.role.create',
  'log.role.delete',
  'log.voice.join',
  'log.voice.leave',
  'log.voice.move',
  'log.moderation.kick',
  'log.moderation.ban',
  'log.moderation.unban',
] as const;

export type LogAction = (typeof MESSAGE_LOG_ACTIONS)[number] | (typeof OTHER_LOG_ACTIONS)[number];

const CATEGORY_TABLE: Record<LogAction, LogCategory> = {
  'log.message.delete': 'messages',
  'log.message.update': 'messages',
  'log.message.bulk_delete': 'messages',
  'log.member.add': 'members',
  'log.member.remove': 'members',
  'log.channel.create': 'channels',
  'log.channel.delete': 'channels',
  'log.role.create': 'roles',
  'log.role.delete': 'roles',
  'log.voice.join': 'voice',
  'log.voice.leave': 'voice',
  'log.voice.move': 'voice',
  'log.moderation.kick': 'moderation',
  'log.moderation.ban': 'moderation',
  'log.moderation.unban': 'moderation',
};

export function categoryOf(action: string): LogCategory | null {
  return Object.prototype.hasOwnProperty.call(CATEGORY_TABLE, action)
    ? CATEGORY_TABLE[action as LogAction]
    : null;
}

export function isCategoryEnabled(config: LoggingConfig, action: string): boolean {
  const category = categoryOf(action);
  if (!category) return false;
  return config.events[category] ?? true;
}

/** Event handlers have no CommandContext — only services, a logger and the client. */
export interface EventEnv {
  client: Client;
  services: BotServices;
  log: Logger;
}

export async function readConfig(services: BotServices, guildId: string): Promise<LoggingConfig> {
  return readBotConfig(services.supabase, guildId, services.env.botId, DEFAULT_CONFIG);
}

export async function writeConfig(
  services: BotServices,
  guildId: string,
  patch: Partial<LoggingConfig>,
): Promise<boolean> {
  const current = await readConfig(services, guildId);
  return writeBotConfig(services.supabase, guildId, services.env.botId, { ...current, ...patch });
}

export async function getConfig(ctx: CommandContext): Promise<LoggingConfig> {
  return readConfig(ctx.services, ctx.guildId);
}

export async function setConfig(ctx: CommandContext, patch: Partial<LoggingConfig>): Promise<boolean> {
  return writeConfig(ctx.services, ctx.guildId, patch);
}

/**
 * Message bodies are user-controlled and land in both Mongo and an embed, so
 * they are sanitised, mention-escaped and truncated before either happens.
 * Returns a placeholder when Discord did not hand us the content (uncached
 * message, embed-only edit, attachment with no caption).
 */
export function redactContent(content: string | null | undefined): string {
  if (!content) return '[content unavailable]';
  const clean = escapeMentions(sanitizeText(content, CONTENT_LIMIT));
  return clean.length === 0 ? '[no text content]' : clean;
}

export function redactName(name: string | null | undefined): string {
  return name ? sanitizeText(name, 100) : 'unknown';
}

export interface LogEventInput {
  guildId: string;
  action: LogAction;
  /** Embed title, e.g. "Message deleted". */
  title: string;
  /** One-line summary, truncated and used as the embed body. */
  message: string;
  level?: LogDoc['level'];
  channelId?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
  fields?: APIEmbedField[];
}

export interface LogEventResult {
  /** True when the live embed was delivered to the configured channel. */
  posted: boolean;
  /** False when the event's category is switched off (nothing was attempted). */
  enabled: boolean;
}

const KIND_BY_LEVEL: Record<LogDoc['level'], EmbedKind> = {
  debug: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

/**
 * The single write path for every guild event.
 *
 *   1. always buffer a LogDoc — the sink batches, so this is never per-event I/O
 *   2. only then, if a channel is configured and the category is on, post an embed
 *
 * A failure in either step is logged and swallowed: log delivery must never
 * take the process down.
 */
export async function recordEvent(env: EventEnv, input: LogEventInput): Promise<LogEventResult> {
  const { client, services, log } = env;
  const level = input.level ?? 'info';

  services.logs.push({
    bot_id: services.env.botId,
    guild_id: input.guildId,
    channel_id: input.channelId ?? null,
    user_id: input.userId ?? null,
    action: input.action,
    level,
    message: sanitizeText(input.message, 512),
    meta: input.meta ?? {},
    created_at: new Date(),
  });

  let config: LoggingConfig;
  try {
    config = await readConfig(services, input.guildId);
  } catch (err) {
    log.error({ err, guildId: input.guildId, action: input.action }, 'log config read failed');
    return { posted: false, enabled: false };
  }

  if (!isCategoryEnabled(config, input.action)) {
    return { posted: false, enabled: false };
  }

  const channelId = config.log_channel;
  if (!channelId) return { posted: false, enabled: true };

  const embed: EmbedBuilder = services.embeds.build(
    KIND_BY_LEVEL[level],
    input.title,
    truncateFieldValue(input.message, 1024),
    { fields: input.fields },
  );

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      log.warn({ guildId: input.guildId, channelId }, 'configured log channel is not text based');
      return { posted: false, enabled: true };
    }
    await (channel as GuildTextBasedChannel).send({ embeds: [embed], allowedMentions: { parse: [] } });
    return { posted: true, enabled: true };
  } catch (err) {
    log.warn({ err, guildId: input.guildId, channelId }, 'failed to post log embed');
    return { posted: false, enabled: true };
  }
}

/** Renders one stored log row as an embed field, respecting the 1024-char cap. */
export function toField(doc: LogDoc, index: number): APIEmbedField {
  const stamp = Math.floor(doc.created_at.getTime() / 1000);
  const author = doc.user_id ? `<@${doc.user_id}>` : 'system';
  const where = doc.channel_id ? `<#${doc.channel_id}>` : '—';

  return {
    name: truncateFieldValue(`#${index + 1} • ${doc.action}`, 256),
    value: truncateFieldValue(`<t:${stamp}:R> • ${author} • ${where}\n${doc.message}`, 1024),
  };
}

/**
 * Queries the `logs` collection. Always scoped to a single guild, newest first,
 * and never returns more than MAX_ROWS rows no matter what was requested.
 */
export async function queryLogs(
  ctx: CommandContext,
  opts: { actions: readonly string[]; userId?: string | null; channelId?: string | null; limit: number },
): Promise<LogDoc[]> {
  const { logs } = await ctx.services.requireMongo();

  const filter: Record<string, unknown> = {
    guild_id: ctx.guildId,
    action: { $in: [...opts.actions] },
  };
  if (opts.userId) filter.user_id = opts.userId;
  if (opts.channelId) filter.channel_id = opts.channelId;

  return logs
    .find(filter)
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(opts.limit, 1), MAX_ROWS))
    .toArray();
}

/**
 * Runs a log query through the shared task queue so a slow Mongo round trip
 * can never pile up on the gateway. ServiceBusyError is left to the runtime to
 * render; a timeout is downgraded to a UserError so it stays out of Sentry.
 */
export async function runLogQuery<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await ctx.services.queue.run(fn, { timeoutMs: 10_000, maxPending: 16 });
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      throw new UserError('The log query timed out. Try again with a smaller limit.');
    }
    throw err;
  }
}

/** Text and announcement channels — anything an embed can be posted to. */
export const LOG_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
