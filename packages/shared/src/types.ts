import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Message,
  User,
  GuildMember,
} from 'discord.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import type { Kv } from './redis.js';
import type { TypedSupabase } from './db/supabase.js';
import type { MongoCollections } from './db/mongo.js';
import type { EmbedFactory } from './embed.js';
import type { TaskQueue } from './queue.js';
import type { LogSink } from './log-sink.js';
import type { BotInterlink } from './interlink.js';

export interface BotControlState {
  enabled: boolean;
  paused: boolean;
  serverPaused: boolean;
  featureFlags: Record<string, unknown>;
}

export interface BotServices {
  env: Env;
  log: Logger;
  /** Null when Supabase is not configured — always degrade, never crash. */
  supabase: TypedSupabase | null;
  redis: Kv;
  embeds: EmbedFactory;
  queue: TaskQueue;
  /** Batched Mongo log writer. */
  logs: LogSink;
  /** Resolves the live Mongo collections, or null in degraded mode. */
  mongo(): Promise<MongoCollections | null>;
  /** Throws ServiceUnavailableError when Mongo is down. */
  requireMongo(): Promise<MongoCollections>;
  /** Throws ServiceUnavailableError when Supabase is down. */
  requireSupabase(): TypedSupabase;
  isAuthorized(guildId: string): Promise<boolean>;
  getControlState(guildId: string): Promise<BotControlState>;
  interlink: BotInterlink;
  /** True for IDs listed in OWNER_IDS (bypass rate limits + antinuke). */
  isOwner(userId: string): boolean;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  client: Client;
  services: BotServices;
  log: Logger;
  guildId: string;
  /** Command directory for the bot that received this interaction. */
  commandsDir: string;
  userId: string;

  defer(ephemeral?: boolean): Promise<void>;
  /** Send any embed, handling deferred/already-replied states. */
  replyEmbed(embed: EmbedBuilder, ephemeral?: boolean): Promise<void>;
  success(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  error(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  info(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  warn(title: string, description?: string, ephemeral?: boolean): Promise<void>;

  /** Typed option helpers that fail with a UserError instead of undefined. */
  targetUser(): User;
  targetMember(): GuildMember | null;
  stringOption(name: string): string | null;
  requiredString(name: string): string;
  intOption(name: string): number | null;
  requiredInt(name: string): number;
  /** Validated reason string, length-capped, newlines stripped. */
  reason(fallback?: string): string;
}

export interface CommandModule {
  data: { name: string; toJSON(): unknown };
  execute(ctx: CommandContext): Promise<void>;
  /**
   * Access scope. `public` (default) commands register globally and work in
   * every authorized server. `dev` commands — authentication, authorization
   * and other operator-critical controls — register ONLY in DEV_GUILD_ID and
   * are rejected at runtime everywhere else.
   */
  access?: 'public' | 'dev';
}

/**
 * Button interactions carry no options, so this is `CommandContext` minus the
 * option helpers. Handlers are dispatched through the shared runner and pass
 * through the same authorization, pause, dev-guild and rate-limit gates as a
 * slash command.
 */
export interface ButtonContext {
  interaction: ButtonInteraction;
  client: Client;
  services: BotServices;
  log: Logger;
  guildId: string;
  userId: string;

  defer(ephemeral?: boolean): Promise<void>;
  replyEmbed(embed: EmbedBuilder, ephemeral?: boolean): Promise<void>;
  success(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  error(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  info(title: string, description?: string, ephemeral?: boolean): Promise<void>;
  warn(title: string, description?: string, ephemeral?: boolean): Promise<void>;
}

/** A bot-owned button handler. Return `false` for customIds this bot ignores. */
export type ButtonHandler = (ctx: ButtonContext) => Promise<boolean>;

export interface EventContext {
  client: Client;
  services: BotServices;
  log: Logger;
}

/** Shared shape for message-like events consumed by the logging bot. */
export type LoggableMessage = Pick<Message, 'id' | 'content' | 'author' | 'guildId' | 'channelId' | 'createdTimestamp'>;
