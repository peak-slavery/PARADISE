import type {
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
  /** True for IDs listed in OWNER_IDS (bypass rate limits + antinuke). */
  isOwner(userId: string): boolean;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  client: Client;
  services: BotServices;
  log: Logger;
  guildId: string;
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
}

export interface EventContext {
  client: Client;
  services: BotServices;
  log: Logger;
}

/** Shared shape for message-like events consumed by the logging bot. */
export type LoggableMessage = Pick<Message, 'id' | 'content' | 'author' | 'guildId' | 'channelId' | 'createdTimestamp'>;
