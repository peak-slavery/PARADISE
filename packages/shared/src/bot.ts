import { Client, Events, type ChatInputCommandInteraction, type ClientOptions, type EmbedBuilder, type GuildMember, type User } from 'discord.js';
import { loadEnv, type Env } from './env.js';
import { createLogger, type Logger } from './logger.js';
import {
  guard,
  initSentry,
  installProcessGuards,
  reportError,
  ServiceUnavailableError,
  UserError,
} from './errors.js';
import { createKv, keys, type Kv } from './redis.js';
import { createSupabase, type TypedSupabase } from './db/supabase.js';
import { connectMongo, type LogDoc, type MongoHandle } from './db/mongo.js';
import { createBatchWriter, type LogSink } from './log-sink.js';
import { createEmbedFactory, type EmbedFactory } from './embed.js';
import { QueueTimeoutError, ServiceBusyError, TaskQueue, type QueueOptions } from './queue.js';
import { LazyCommandRunner, UNIVERSAL_COMMANDS_DIR } from './commands.js';
import { attachServerLock, isGuildAuthorized } from './server-lock.js';
import { startHealthServer, type HealthDeps } from './health.js';
import { DEFAULT_POLICY, enforceRateLimit, type RateLimitPolicy } from './rate-limit.js';
import { replyOrFollowUp } from './responses.js';
import { sanitizeReason, sanitizeText } from './sanitize.js';
import type { BotServices, CommandContext } from './types.js';

export interface CreateBotOptions {
  intents: ClientOptions['intents'];
  partials?: ClientOptions['partials'];
  /** Absolute path to this bot's `src/commands` directory. */
  commandsDir: string;
  rateLimit?: RateLimitPolicy;
  queue?: QueueOptions;
  /** Commands exempt from the default limiter (read-only lookups). */
  unlimitedCommands?: string[];
  /** Wire up extra event listeners before login. */
  setup?: (ctx: { client: Client; services: BotServices; log: Logger; env: Env }) => void | Promise<void>;
}

export interface BotRuntime {
  client: Client;
  env: Env;
  log: Logger;
  services: BotServices;
  shutdown: (signal: string) => Promise<void>;
}

async function replyEmbed(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  ephemeral: boolean,
  log: Logger,
): Promise<void> {
  await replyOrFollowUp(interaction, { embeds: [embed], ephemeral }, log);
}

function buildContext(
  interaction: ChatInputCommandInteraction,
  client: Client,
  services: BotServices,
): CommandContext {
  const guildId = interaction.guildId ?? 'dm';
  const log = services.log.child({ command: interaction.commandName, guildId, userId: interaction.user.id });

  const send = (embed: EmbedBuilder, ephemeral = false) => replyEmbed(interaction, embed, ephemeral, log);

  const ctx: CommandContext = {
    interaction,
    client,
    services,
    log,
    guildId,
    userId: interaction.user.id,

    async defer(ephemeral = false) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral });
      }
    },

    replyEmbed: (embed, ephemeral = false) => send(embed, ephemeral),
    success: (title, description, ephemeral) => send(services.embeds.success(title, description), ephemeral),
    error: (title, description, ephemeral) => send(services.embeds.error(title, description), ephemeral),
    info: (title, description, ephemeral) => send(services.embeds.info(title, description), ephemeral),
    warn: (title, description, ephemeral) => send(services.embeds.warning(title, description), ephemeral),

    targetUser(): User {
      const user = interaction.options.getUser('user');
      if (!user) throw new UserError('You must specify a target user.');
      return user;
    },

    targetMember(): GuildMember | null {
      const member = interaction.options.getMember('user');
      return (member && 'joinedTimestamp' in member ? member : null) as GuildMember | null;
    },

    stringOption: (name) => {
      const raw = interaction.options.getString(name);
      return raw === null ? null : sanitizeText(raw, 512);
    },

    requiredString(name) {
      const raw = interaction.options.getString(name);
      if (raw === null || sanitizeText(raw).length === 0) {
        throw new UserError(`Missing required option \`${name}\`.`);
      }
      return sanitizeText(raw, 512);
    },

    intOption: (name) => interaction.options.getInteger(name),

    requiredInt(name) {
      const raw = interaction.options.getInteger(name);
      if (raw === null) throw new UserError(`Missing required option \`${name}\`.`);
      return raw;
    },

    reason(fallback) {
      return sanitizeReason(interaction.options.getString('reason') ?? undefined) === 'No reason provided'
        ? (fallback ?? 'No reason provided')
        : sanitizeReason(interaction.options.getString('reason') ?? undefined);
    },
  };

  return ctx;
}

async function renderFailure(ctx: CommandContext, err: Error): Promise<void> {
  if (err instanceof ServiceUnavailableError) {
    await ctx.replyEmbed(ctx.services.embeds.unavailable(err.service));
    return;
  }
  // Queue pressure is an expected overload condition, not a defect — it must
  // never reach Sentry as an unhandled error.
  if (err instanceof QueueTimeoutError) {
    await ctx.warn('Timed out', 'That request took too long to complete. Please try again.');
    return;
  }
  if (err instanceof ServiceBusyError) {
    await ctx.warn('Service busy', 'Too many requests are queued. Try again in a moment.');
    return;
  }
  if (err instanceof UserError) {
    await ctx.error('Request failed', err.message);
    return;
  }
  await ctx.error('Unexpected error', 'This has been reported automatically. Please try again shortly.');
}

export async function createBot(options: CreateBotOptions): Promise<BotRuntime> {
  const startedAt = Date.now();

  const env = loadEnv();
  const log = createLogger(env);

  initSentry(env);
  installProcessGuards(env.botId, log);

  const supabase: TypedSupabase | null = createSupabase(env);
  const kv: Kv = createKv(env);
  let mongoHandle: MongoHandle | null = await connectMongo(env, log);
  const embeds: EmbedFactory = createEmbedFactory(env);
  const queue = new TaskQueue(options.queue ?? { concurrency: 2, timeoutMs: 15_000 });

  /* Batched log writer — the main defence against blowing the Mongo write cap. */
  let writeCount = 0;
  let writeWindowStart = Date.now();
  const baseSink = createBatchWriter<LogDoc>({
    getCollection: () => mongoHandle?.collections.logs ?? null,
    intervalMs: 30_000,
    maxBatch: 200,
    onError: (err, dropped) => {
      log.error({ err, dropped }, 'log batch write failed');
      reportError(err, { botId: env.botId });
    },
  });

  const logs: LogSink = {
    push(doc) {
      writeCount += 1;
      baseSink.push(doc);
    },
    flush: () => baseSink.flush(),
    stop: () => baseSink.stop(),
    stats: () => baseSink.stats(),
  };

  const services: BotServices = {
    env,
    log,
    supabase,
    redis: kv,
    embeds,
    queue,
    logs,
    async mongo() {
      return mongoHandle?.collections ?? null;
    },
    async requireMongo() {
      if (!mongoHandle) throw new ServiceUnavailableError('Database');
      return mongoHandle.collections;
    },
    requireSupabase() {
      if (!supabase) throw new ServiceUnavailableError('Database');
      return supabase;
    },
    isAuthorized: (guildId) => isGuildAuthorized(supabase, guildId),
    isOwner: (userId) => env.ownerIds.includes(userId),
  };

  const client = new Client({ intents: options.intents, partials: options.partials });
  // Bot-specific handlers first; the shared universal commands are the fallback
  // so a bot can override /help or /about by defining its own.
  const runner = new LazyCommandRunner([options.commandsDir, UNIVERSAL_COMMANDS_DIR]);
  // Exposed so the shared /help command can enumerate this bot's commands.
  process.env.BOT_COMMANDS_DIR ??= options.commandsDir;
  const unlimited = new Set(options.unlimitedCommands ?? []);

  /* --- server lock ------------------------------------------------------ */
  attachServerLock(client, {
    env,
    log,
    supabase,
    record: ({ action, level, message, guildId, meta }) => {
      logs.push({
        bot_id: env.botId,
        guild_id: guildId ?? null,
        channel_id: null,
        user_id: null,
        action,
        level,
        message,
        meta: meta ?? {},
        created_at: new Date(),
      });
    },
  });

  /* --- command dispatch -------------------------------------------------- */
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const guildId = interaction.guildId ?? 'dm';
    const ctx = buildContext(interaction, client, services);

    try {
      if (guildId !== 'dm' && !(await services.isAuthorized(guildId))) {
        await ctx.error('Not authorized', 'This server is not enabled for this bot.');
        return;
      }

      if (!unlimited.has(name)) {
        const verdict = await enforceRateLimit(
          kv,
          keys.rateLimit(env.botId, guildId, interaction.user.id, name),
          options.rateLimit ?? DEFAULT_POLICY,
          services.isOwner(interaction.user.id),
        );
        if (!verdict.allowed) {
          await ctx.warn('Slow down', `You can use this command again in ${verdict.retryAfterSec}s.`);
          return;
        }
      }

      const result = await guard(
        name,
        () => runner.execute(name, ctx),
        { botId: env.botId, command: name, guildId, userId: interaction.user.id },
      );

      if (!result.ok) await renderFailure(ctx, result.error);
    } catch (err) {
      // Last-resort net: nothing escapes into the gateway.
      log.error({ err, command: name, guildId }, 'interaction handler crashed');
      reportError(err, { botId: env.botId, command: name, guildId });
    }
  });

  client.on(Events.ClientReady, (ready) => {
    log.info(
      { guilds: ready.guilds.cache.size, user: ready.user.tag, commands: options.commandsDir },
      'bot ready',
    );
  });

  client.on(Events.Error, (err) => {
    log.error({ err }, 'discord client error');
    reportError(err, { botId: env.botId });
  });

  await options.setup?.({ client, services, log, env });

  /* --- health + uptime --------------------------------------------------- */
  const healthDeps: HealthDeps = {
    env,
    log,
    startedAt,
    kv,
    supabase,
    getMongo: () => mongoHandle,
    queue,
    writes1h: () => {
      if (Date.now() - writeWindowStart > 3_600_000) {
        writeWindowStart = Date.now();
        writeCount = 0;
      }
      return writeCount;
    },
  };

  const server = await startHealthServer(healthDeps);

  /* --- Mongo auto-reconnect --------------------------------------------- */
  const reconnect = setInterval(() => {
    if (mongoHandle) return;
    void connectMongo(env, log).then((handle) => {
      if (handle) {
        mongoHandle = handle;
        log.info('mongodb reconnected');
      }
    });
  }, 60_000);
  reconnect.unref?.();

  /* --- graceful shutdown ------------------------------------------------- */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');

    clearInterval(reconnect);
    server.close();
    client.destroy();
    baseSink.stop();
    await baseSink.flush();
    await mongoHandle?.client.close().catch(() => undefined);
    log.info('shutdown complete');
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await client.login(env.discordToken);

  return { client, env, log, services, shutdown };
}

export type { Env, Logger };
