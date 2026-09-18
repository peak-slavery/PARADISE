import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events, GatewayIntentBits } from 'discord.js';
import { createBot, createGuildEventGate, readBotConfig, sendChannelEmbed } from '@eiflow/shared';
import { classifyText, slmEnabled } from './lib/slm.js';
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
    GatewayIntentBits.AutoModerationExecution,
  ],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    const listen = createGuildEventGate(client, services);
    /**
     * Discord AutoMod executes rules server-side; all this bot does is mirror
     * the outcome into the configured channel and the batched log stream.
     */
    listen(Events.AutoModerationActionExecution, async (execution) => {
      try {
        // AutoModerationActionExecution exposes `guild`, not `guildId`.
        const guildId = execution.guild.id;

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

        /**
         * SLM second opinion: when the security classifier is configured, run
         * the flagged content through it and auto-warn on a confident "bad"
         * verdict. Fail-open — an unavailable classifier never blocks the
         * mirror log above and never escalates on its own.
         */
        const content = execution.matchedContent ?? execution.content ?? null;
        if (config.automod_warnings !== false && slmEnabled(services.env) && content && content.trim().length > 0) {
          // Discord emits one event per rule action. Review a message only once.
          const reviewKey = `shanks:automod:${guildId}:${execution.messageId ?? `${execution.userId}:${execution.ruleId}`}`;
          const claimed = await services.redis.incr(reviewKey, 60).catch(() => 0);
          const result = claimed === 1
            ? await services.queue.run(() => classifyText(services.env, content), { maxPending: 16 }).catch(() => null)
            : null;
          if (result?.ok && result.bad && result.confidence >= services.env.automodSlmThreshold) {
            const reason = `AutoMod: ${result.category} (confidence ${(result.confidence * 100).toFixed(0)}%)`;

            services.logs.push({
              bot_id: services.env.botId,
              guild_id: guildId,
              channel_id: execution.channelId ?? null,
              user_id: execution.userId,
              action: 'automod.slm',
              level: 'warn',
              message: `SLM flagged ${result.category} at ${(result.confidence * 100).toFixed(0)}% — warning issued`,
              meta: {
                model: result.model,
                category: result.category,
                confidence: result.confidence,
                ruleId: execution.ruleId,
              },
              created_at: new Date(),
            });

            if (services.supabase) {
              const { error } = await services.supabase
                .from('mod_actions')
                .insert({
                  guild_id: guildId,
                  bot_id: services.env.botId,
                  action: 'warn',
                  target_id: execution.userId,
                  moderator_id: client.user!.id,
                  reason,
                  duration_seconds: null,
                  active: true,
                  expires_at: null,
                });
              if (error) log.warn({ err: error }, 'automod warn not persisted');
            }

            try {
              const user = await client.users.fetch(execution.userId);
              await user.send({
                embeds: [
                  services.embeds.warning('AutoMod warning', reason, {
                    fields: [
                      { name: 'Channel', value: execution.channelId ? `<#${execution.channelId}>` : 'Unknown', inline: true },
                      { name: 'Reviewed by', value: `automated check (\`${result.model}\`)`, inline: true },
                    ],
                  }),
                ],
              });
            } catch (err) {
              log.debug({ err, userId: execution.userId }, 'automod warn DM not delivered');
            }
          }
        }

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
