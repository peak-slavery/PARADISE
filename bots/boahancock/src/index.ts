import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Events,
  GatewayIntentBits,
  type GuildMember,
  type MessageCreateOptions,
  type PartialGuildMember,
} from 'discord.js';
import { createBot, readBotConfig } from '@eiflow/shared';
import {
  DEFAULT_CONFIG,
  channelFor,
  isCustom,
  renderTemplate,
  templateFor,
  type MessageKind,
  type WelcomeConfig,
} from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    /**
     * Renders the configured template for a join/leave and posts it.
     *
     * Never throws: an unhandled rejection inside a gateway event handler is
     * the one thing that can take a bot down, so every failure is swallowed
     * into the structured log.
     */
    const handle = async (kind: MessageKind, member: GuildMember | PartialGuildMember): Promise<void> => {
      try {
        // Bot additions are not real members joining — don't greet them.
        if (member.user.bot) return;

        const guild = member.guild;
        if (!(await services.isAuthorized(guild.id))) return;
        const config = await readBotConfig<WelcomeConfig>(
          services.supabase,
          guild.id,
          services.env.botId,
          DEFAULT_CONFIG,
        );

        const channelId = channelFor(config, kind);
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || channel.isDMBased()) return;

        const template = templateFor(config, kind);
        const rendered = renderTemplate(template, {
          userId: member.id,
          username: member.user.tag,
          serverName: guild.name,
          memberCount: guild.memberCount,
        });
        if (rendered.length === 0) return;

        // Only the subject may ever be pinged; roles and @everyone are off.
        const allowedMentions = { users: [member.id], roles: [] as string[] };

        const payload: MessageCreateOptions = isCustom(config, kind)
          ? { content: rendered, allowedMentions }
          : {
              embeds: [
                services.embeds.brand(
                  kind === 'welcome' ? 'Welcome!' : 'Goodbye',
                  rendered,
                  { thumbnail: member.user.displayAvatarURL({ size: 128 }) },
                ),
              ],
              allowedMentions,
            };

        await channel.send(payload);

        services.logs.push({
          bot_id: services.env.botId,
          guild_id: guild.id,
          channel_id: channel.id,
          user_id: member.id,
          action: kind === 'welcome' ? 'welcome.sent' : 'leave.sent',
          level: 'info',
          message: `${kind} message sent for ${member.user.tag}`,
          meta: { custom: isCustom(config, kind) },
          created_at: new Date(),
        });
      } catch (err) {
        log.error({ err, guildId: member.guild?.id, kind }, 'greeting handler failed');
      }
    };

    client.on(Events.GuildMemberAdd, (member) => {
      void handle('welcome', member);
    });

    client.on(Events.GuildMemberRemove, (member) => {
      void handle('leave', member);
    });

    log.info({ guilds: client.guilds.cache.size }, 'welcome bot initialised');
  },
});
