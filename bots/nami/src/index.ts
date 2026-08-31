import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events, GatewayIntentBits, type Client } from 'discord.js';
import { createBot, keys, readBotConfig, type BotServices, type MongoCollections } from '@eiflow/shared';
import { DEFAULT_CONFIG, type LevelUpConfig } from './lib/store.js';
import { setXpTracker, XpTracker, type LevelUpEvent } from './lib/xp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

/* --- XP economy --------------------------------------------------------- */

/** Chat XP is credited at most once per member per window. */
const CHAT_COOLDOWN_SECONDS = 60;
const CHAT_XP_MIN = 5;
const CHAT_XP_MAX = 15;
/** One extra XP per 60 characters, capped. Long copy-paste is not worth more. */
const CHAT_XP_PER_CHAR = 1 / 60;

const VOICE_XP_PER_MINUTE = 2;
/** Sessions shorter than this are noise (channel hopping, accidental joins). */
const MIN_VOICE_SECONDS = 10;
/** Guards against a stale timestamp awarding days of voice XP. */
const MAX_VOICE_SECONDS = 6 * 3600;
const MAX_VOICE_XP = 300;

const FLUSH_INTERVAL_MS = 30_000;

function chatXp(contentLength: number): number {
  const bonus = Math.floor(contentLength * CHAT_XP_PER_CHAR);
  return Math.min(CHAT_XP_MAX, CHAT_XP_MIN + bonus);
}

function voiceXp(seconds: number): number {
  return Math.min(MAX_VOICE_XP, Math.floor(seconds / 60) * VOICE_XP_PER_MINUTE);
}

/** Announces a level-up in the configured channel, if there is one. */
async function announceLevelUp(
  client: Client,
  services: BotServices,
  event: LevelUpEvent,
): Promise<void> {
  const config = await readBotConfig<LevelUpConfig>(
    services.supabase,
    event.guildId,
    services.env.botId,
    DEFAULT_CONFIG,
  );
  if (!config.level_channel) return;

  const channel = await client.channels.fetch(config.level_channel).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  await channel.send({
    embeds: [
      services.embeds.brand('Level up!', `<@${event.userId}> reached **level ${event.level}**.`, {
        fields: [
          { name: 'Level', value: String(event.level), inline: true },
          { name: 'Total XP', value: String(event.xp), inline: true },
        ],
      }),
    ],
    allowedMentions: { users: [event.userId], roles: [] },
  });

  services.logs.push({
    bot_id: services.env.botId,
    guild_id: event.guildId,
    channel_id: channel.id,
    user_id: event.userId,
    action: 'levelup.reached',
    level: 'info',
    message: `Member reached level ${event.level}`,
    meta: { level: event.level, xp: event.xp },
    created_at: new Date(),
  });
}

await createBot({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    /**
     * Mongo handle holder. `services.mongo()` is re-read on a timer because
     * the shared runtime swaps in a fresh handle after a reconnect.
     */
    let collections: MongoCollections | null = null;
    const refreshCollections = async (): Promise<void> => {
      collections = await services.mongo();
    };
    void refreshCollections();
    const refresher = setInterval(() => void refreshCollections(), FLUSH_INTERVAL_MS);
    refresher.unref?.();

    const tracker = new XpTracker({
      getCollection: () => collections?.xp ?? null,
      log,
      intervalMs: FLUSH_INTERVAL_MS,
      onLevelUp: (event) => {
        void announceLevelUp(client, services, event).catch((err: unknown) => {
          log.error({ err, guildId: event.guildId, userId: event.userId }, 'level-up announcement failed');
        });
      },
    });
    setXpTracker(tracker);
    tracker.start();

    /* --- chat activity -------------------------------------------------- */
    client.on(Events.MessageCreate, async (message) => {
      try {
        // Bots and DMs never earn XP.
        if (message.author.bot || !message.guildId) return;

        const guildId = message.guildId;
        const userId = message.author.id;
        if (!(await services.isAuthorized(guildId))) return;

        // Spam cannot inflate XP: one credit per member per window.
        const verdict = await services.redis.allow(keys.xpDebounce(guildId, userId), 1, CHAT_COOLDOWN_SECONDS);
        if (!verdict.allowed) return;

        tracker.add(guildId, userId, { xp: chatXp(message.content.length), messages: 1 });
      } catch (err) {
        log.error({ err, guildId: message.guildId }, 'chat xp handler failed');
      }
    });

    /* --- voice activity ------------------------------------------------- */
    /** guildId:userId -> epoch ms when the current session started. */
    const sessions = new Map<string, number>();
    const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

    const endSession = (guildId: string, userId: string, bot: boolean): void => {
      const key = sessionKey(guildId, userId);
      const startedAt = sessions.get(key);
      sessions.delete(key);
      if (startedAt === undefined || bot) return;

      const seconds = Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - startedAt) / 1000));
      if (seconds < MIN_VOICE_SECONDS) return;

      const xp = voiceXp(seconds);
      if (xp <= 0) return;

      tracker.add(guildId, userId, { xp, voiceSeconds: seconds });
    };

    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      try {
        const guildId = newState.guild.id;
        if (!(await services.isAuthorized(guildId))) return;
        const userId = newState.id;
        const bot = newState.member?.user.bot ?? false;

        // Mute/deafen/suppress changes leave the channel untouched — ignore.
        if (oldState.channelId === newState.channelId) return;

        // Leaving (or moving) closes the open session.
        if (oldState.channelId) endSession(guildId, userId, bot);
        // Joining (or moving) opens a new one.
        if (newState.channelId && !bot) sessions.set(sessionKey(guildId, userId), Date.now());
      } catch (err) {
        log.error({ err, guildId: newState.guild.id }, 'voice xp handler failed');
      }
    });

    /* --- flush pending XP on shutdown ----------------------------------- */
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void tracker.flush().then(() => log.info({ pending: tracker.pending }, 'xp flush on shutdown finished'));
      });
    }

    log.info({ guilds: client.guilds.cache.size }, 'levelup bot initialised');
  },
});
