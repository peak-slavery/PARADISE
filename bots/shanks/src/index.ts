import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events, GatewayIntentBits } from 'discord.js';
import { createBot, readBotConfig, sendChannelEmbed } from '@eiflow/shared';
import { DEFAULT_CONFIG } from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    /**
     * Discord AutoMod executes rules server-side; all this bot does is mirror
     * the outcome into the configured channel and the batched log stream.
     */
    client.on(Events.AutoModerationActionExecution, async (execution) => {
      try {
        // AutoModerationActionExecution exposes `guild`, not `guildId`.
        const guildId = execution.guild.id;
        if (!(await services.isAuthorized(guildId))) return;

        const config = await readBotConfig(
          services.supabase,
          guildId,
          services.env.botId,
          DEFAULT_CONFIG,
        );

        services.logs.push({
          bot_id: services.env.botId,
          guild_id: guildId,
          channel_id: execution.channelId ?? null,
          user_id: execution.userId,
          action: 'automod.execution',
          level: 'warn',
          message: `AutoMod ${execution.action.type} triggered by rule ${execution.ruleTriggerType}`,
          meta: {
            ruleId: execution.ruleId,
            ruleTriggerType: execution.ruleTriggerType,
            actionType: execution.action.type,
            matchedContent: execution.matchedContent,
          },
          created_at: new Date(),
        });

        const channelId = config.automod_log_channel;
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);

        await sendChannelEmbed(
          channel,
          services.embeds.warning('AutoMod action', `**Trigger:** ${execution.ruleTriggerType}`, {
            fields: [
              { name: 'User', value: `<@${execution.userId}>`, inline: true },
              { name: 'Action', value: String(execution.action.type), inline: true },
              {
                name: 'Channel',
                value: execution.channelId ? `<#${execution.channelId}>` : 'Unknown',
                inline: true,
              },
            ],
          }),
          log,
        );
      } catch (err) {
        log.error({ err }, 'automod handler failed');
      }
    });
  },
});
