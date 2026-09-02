import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  type APIEmbedField,
  type ChatInputCommandInteraction,
  type ClientOptions,
  type GuildMember,
  type User,
} from 'discord.js';
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
import { connectMongo, connectSecondaryMongo, type LogDoc, type MongoHandle } from './db/mongo.js';
import { createBatchWriter, type LogSink } from './log-sink.js';
import { createEmbedFactory, type EmbedFactory } from './embed.js';
import { QueueTimeoutError, ServiceBusyError, TaskQueue, type QueueOptions } from './queue.js';
import { LazyCommandRunner, UNIVERSAL_COMMANDS_DIR } from './commands.js';
import { attachServerLock, isGuildAuthorized } from './server-lock.js';
import { startHealthServer, type HealthDeps } from './health.js';
import { DEFAULT_POLICY, enforceRateLimit, type RateLimitPolicy } from './rate-limit.js';
import { replyOrFollowUp } from './responses.js';
import { sanitizeReason, sanitizeText } from './sanitize.js';
import type { BotControlState, BotServices, CommandContext } from './types.js';
import { BotInterlink } from './interlink.js';
import type { InterlinkEvent } from './interlink.js';
import { invalidateGuildWhitelistCache, writeGuildWhitelist } from './whitelist.js';
import { hydrateRuntimeSecrets } from './vault-client.js';

const MASTER_DISCORD_ID = '1479589523426902208';
const AUDIT_SECRET_KEY = /(token|secret|password|private.?key|service.?role|connection.?string|mongodb|redis|supabase|firebase|cloudflare|authorization|cookie)/i;

function redactAuditMeta(value: Record<string, unknown>): Record<string, unknown> {
  const walk = (input: unknown, depth: number): unknown => {
    if (depth > 4) return '[truncated]';
    if (typeof input === 'string') {
      if (/^(?:mongodb(?:\+srv)?|https?):\/\//i.test(input) || /-----BEGIN .*PRIVATE KEY-----/.test(input)) return '[redacted]';
      return input.slice(0, 512);
    }
    if (Array.isArray(input)) return input.slice(0, 25).map((item) => walk(item, depth + 1));
    if (input && typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input as Record<string, unknown>).slice(0, 50)) {
        output[key] = AUDIT_SECRET_KEY.test(key) ? '[redacted]' : walk(child, depth + 1);
      }
      return output;
    }
    return input;
  };
  const redacted = walk(value, 0) as Record<string, unknown>;
  try {
    if (Buffer.byteLength(JSON.stringify(redacted), 'utf8') > 8 * 1024) return { notice: 'audit metadata truncated' };
  } catch {
    return { notice: 'audit metadata unavailable' };
  }
  return redacted;
}

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

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

function safeUrl(value: unknown): string | null {
  const raw = boundedString(value, 2048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function hexColor(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim().replace(/^#/, '') : '';
  return /^[0-9a-f]{6}$/i.test(raw) ? Number.parseInt(raw, 16) : null;
}

function buildDashboardEmbed(payload: Record<string, unknown>): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null {
  const embed = new EmbedBuilder();
  const title = boundedString(payload.title, 256);
  const description = boundedString(payload.description, 4096);
  const url = safeUrl(payload.url);
  const color = hexColor(payload.color);
  const footer = boundedString(payload.footer, 2048);
  const thumbnail = safeUrl(payload.thumbnail);
  const image = safeUrl(payload.image);
  const author = payload.author && typeof payload.author === 'object' && !Array.isArray(payload.author)
    ? payload.author as Record<string, unknown>
    : null;

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (url) embed.setURL(url);
  if (color !== null) embed.setColor(color);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (author) {
    const name = boundedString(author.name, 256);
    if (name) {
      embed.setAuthor({ name, url: safeUrl(author.url) ?? undefined, iconURL: safeUrl(author.iconUrl) ?? undefined });
    }
  }

  const fields: APIEmbedField[] = [];
  if (Array.isArray(payload.fields)) {
    for (const rawField of payload.fields.slice(0, 25)) {
      if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) continue;
      const field = rawField as Record<string, unknown>;
      const name = boundedString(field.name, 256);
      const value = boundedString(field.value, 1024);
      if (name && value) fields.push({ name, value, inline: field.inline === true });
    }
  }
  if (fields.length > 0) embed.addFields(fields);

  const buttons: ButtonBuilder[] = [];
  if (Array.isArray(payload.buttons)) {
    for (const rawButton of payload.buttons.slice(0, 5)) {
      if (!rawButton || typeof rawButton !== 'object' || Array.isArray(rawButton)) continue;
      const button = rawButton as Record<string, unknown>;
      const label = boundedString(button.label, 80);
      const buttonUrl = safeUrl(button.url);
      if (label && buttonUrl) {
        buttons.push(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(buttonUrl));
      }
    }
  }

  return {
    embed,
    components: buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
  };
}

async function handleDashboardEmbed(client: Client, event: InterlinkEvent, log: Logger): Promise<void> {
  if (event.type !== 'dashboard.send_embed' || !event.guildId) return;
  const channelId = boundedString(event.payload.channelId, 32);
  if (!channelId || !/^\d{17,20}$/.test(channelId)) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased() || !('guild' in channel) || channel.guild?.id !== event.guildId || !('send' in channel)) {
    log.warn({ guildId: event.guildId, channelId }, 'dashboard embed channel rejected');
    return;
  }

  const built = buildDashboardEmbed(event.payload);
  if (!built) return;
  await channel.send({ embeds: [built.embed], components: built.components, allowedMentions: { parse: [] } });
}

export async function createBot(options: CreateBotOptions): Promise<BotRuntime> {
  const startedAt = Date.now();

  await hydrateRuntimeSecrets();
  const env = loadEnv();
  const log = createLogger(env);

  initSentry(env);
  installProcessGuards(env.botId, log);

  const supabase: TypedSupabase | null = createSupabase(env);
  const kv: Kv = createKv(env);
  let mongoHandle: MongoHandle | null = await connectMongo(env, log);
  const secondaryMongoHandle: MongoHandle | null = await connectSecondaryMongo(env, log);
  const embeds: EmbedFactory = createEmbedFactory(env);
  const queue = new TaskQueue(options.queue ?? { concurrency: 2, timeoutMs: 15_000 });
  const interlink = new BotInterlink(kv, env.botId);
  const controlCache = new Map<string, { state: BotControlState; expiresAt: number }>();

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
  const backupSink = createBatchWriter<LogDoc>({
    getCollection: () => secondaryMongoHandle?.collections.logs ?? null,
    intervalMs: 30_000,
    maxBatch: 200,
    onError: (err, dropped) => {
      // Backup failure must never interrupt primary bot operation.
      log.warn({ err, dropped }, 'secondary audit log batch failed');
    },
  });

  const logs: LogSink = {
    push(doc) {
      writeCount += 1;
      baseSink.push(doc);
      backupSink.push({ ...doc, meta: redactAuditMeta(doc.meta) });
    },
    flush: () => baseSink.flush(),
    stop: () => baseSink.stop(),
    stats: () => ({
      buffered: baseSink.stats().buffered + backupSink.stats().buffered,
      flushed: baseSink.stats().flushed,
      failed: baseSink.stats().failed + backupSink.stats().failed,
    }),
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
    isAuthorized: (guildId) => isGuildAuthorized(supabase, guildId, env, kv),
    interlink,
    async getControlState(guildId) {
      const cached = controlCache.get(guildId);
      if (cached && cached.expiresAt > Date.now()) return cached.state;
      const fallback: BotControlState = {
        enabled: true,
        paused: false,
        serverPaused: false,
        featureFlags: {},
      };
      if (!supabase) return fallback;
      const [settings, botState] = await Promise.all([
        supabase.from('server_settings').select('server_paused').eq('guild_id', guildId).maybeSingle(),
        supabase.from('bot_states').select('enabled,paused,feature_flags').eq('guild_id', guildId).eq('bot_id', env.botId).maybeSingle(),
      ]);
      if (settings.error || botState.error) {
        const blocked = { ...fallback, enabled: false, paused: true, serverPaused: true };
        controlCache.set(guildId, { state: blocked, expiresAt: Date.now() + 15_000 });
        return blocked;
      }
      const state: BotControlState = {
        enabled: botState.data?.enabled ?? true,
        paused: botState.data?.paused ?? false,
        serverPaused: settings.data?.server_paused ?? false,
        featureFlags: (botState.data?.feature_flags as Record<string, unknown> | null) ?? {},
      };
      controlCache.set(guildId, { state, expiresAt: Date.now() + 15_000 });
      return state;
    },
    isOwner: (userId) => env.ownerIds.includes(userId),
  };

  const client = new Client({ intents: options.intents, partials: options.partials });
  const stopInterlink = interlink.startPolling((event) => handleDashboardEmbed(client, event, log));
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
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith('guild-auth:')) return;
      if (interaction.user.id !== MASTER_DISCORD_ID) {
        await interaction.reply({ content: 'Only the master operator can approve guilds.', ephemeral: true }).catch(() => undefined);
        return;
      }
      const [, decision, guildId] = interaction.customId.split(':');
      if (!supabase || !guildId || !['full', 'temp', 'deny'].includes(decision ?? '')) {
        await interaction.reply({ content: 'Authorization storage is unavailable.', ephemeral: true }).catch(() => undefined);
        return;
      }
      try {
        const type = decision === 'deny' ? 'unauthorised' : decision;
        const expiresAt = decision === 'temp' ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : null;
        await writeGuildWhitelist(supabase, { guildId, type: type as 'full' | 'temp' | 'unauthorised', expiresAt });
        await supabase.from('servers').update({ authorized: decision !== 'deny' }).eq('guild_id', guildId);
        await invalidateGuildWhitelistCache(kv, guildId);
        await interaction.update({ components: [], content: `Authorization decision: ${decision === 'deny' ? 'denied' : decision === 'temp' ? 'temporary 24h' : 'full access'}` });
      } catch (error) {
        log.error({ err: error, guildId }, 'guild authorization decision failed');
        await interaction.reply({ content: 'The authorization decision could not be saved.', ephemeral: true }).catch(() => undefined);
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const guildId = interaction.guildId ?? 'dm';
    const ctx = buildContext(interaction, client, services);

    try {
      if (guildId !== 'dm' && !(await services.isAuthorized(guildId))) {
        await ctx.error('Not authorized', 'This server is not enabled for this bot.');
        return;
      }

      if (guildId !== 'dm') {
        const state = await services.getControlState(guildId);
        if (!state.enabled || state.paused || state.serverPaused) {
          await ctx.warn('Bot paused', 'This bot is currently paused for this server.');
          return;
        }
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
    void interlink.heartbeat(ready.guilds.cache.size);
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
    stopInterlink();
    server.close();
    client.destroy();
    baseSink.stop();
    await baseSink.flush();
    backupSink.stop();
    await backupSink.flush();
    await mongoHandle?.client.close().catch(() => undefined);
    await secondaryMongoHandle?.client.close().catch(() => undefined);
    log.info('shutdown complete');
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await client.login(env.discordToken);

  return { client, env, log, services, shutdown };
}

export type { Env, Logger };
