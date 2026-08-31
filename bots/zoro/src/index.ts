import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogEvent, Events, GatewayIntentBits, type ClientEvents, type GuildTextBasedChannel } from 'discord.js';
import { createBot, sanitizeText } from '@eiflow/shared';
import { evaluateThreat, gainedDangerousPermissions, type EventEnv, type ThreatSignal } from './lib/enforce.js';
import { readConfig } from './lib/store.js';
import { classifyContent, slmEnabled } from './lib/slm.js';
import { creditClean, recordIncident } from './lib/trust.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    // Required for GuildAuditLogEntryCreate, which is how we attribute every
    // destructive action to an actor.
    GatewayIntentBits.GuildModeration,
  ],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    const env: EventEnv = { client, services, log };

    /**
     * Registers an async listener whose rejection is always caught and logged.
     * Typing against `ClientEvents` keeps every handler parameter inferred while
     * still guaranteeing nothing escapes into the gateway.
     */
    const listen = <K extends keyof ClientEvents>(
      event: K,
      handler: (...args: ClientEvents[K]) => Promise<void>,
    ): void => {
      client.on(event, ((...args: ClientEvents[K]) => {
        void (async () => {
          const first = args[0] as { id?: string; guildId?: string; guild?: { id?: string } } | undefined;
          const second = args[1] as { id?: string; guildId?: string; guild?: { id?: string } } | undefined;
          const guildId = first?.guildId ?? first?.guild?.id ?? second?.guildId ?? second?.guild?.id ?? second?.id;
          if (guildId && !(await services.isAuthorized(guildId))) return;
          await handler(...args);
        })().catch((err: unknown) => {
          log.error({ err, event: String(event) }, 'antinuke event handler failed');
        });
      }) as (...args: unknown[]) => void);
    };

    const inspect = (signal: ThreatSignal): void => {
      void evaluateThreat(env, signal).catch((err: unknown) => {
        log.error({ err, guildId: signal.guildId, action: signal.action }, 'threat evaluation threw');
      });
    };

    /**
     * Every destructive action is attributed through the audit log, because the
     * direct gateway events (ChannelDelete, GuildRoleDelete, …) never tell us
     * *who* did it — and "who" is the entire basis of raid detection.
     */
    listen(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
      const actorId = entry.executorId;
      // No executor means we cannot attribute the action to anyone.
      if (!actorId) return;

      const targetId = entry.targetId;
      const reason = entry.reason ? sanitizeText(entry.reason, 256) : null;
      const base = { guildId: guild.id, actorId, details: { targetId, reason, auditEntryId: entry.id } };

      switch (entry.action) {
        case AuditLogEvent.ChannelDelete:
          return inspect({
            ...base,
            action: 'channel_delete',
            eventType: 'channel_delete',
            severity: 'high',
            title: 'Channel deletion raid',
            summary: `<@${actorId}> deleted ${entry.targetId ? `<#${targetId}>` : 'a channel'}`,
          });

        case AuditLogEvent.RoleDelete:
          return inspect({
            ...base,
            action: 'role_delete',
            eventType: 'role_delete',
            severity: 'high',
            title: 'Role deletion raid',
            summary: `<@${actorId}> deleted ${targetId ? `<@&${targetId}>` : 'a role'}`,
          });

        case AuditLogEvent.MemberKick:
          return inspect({
            ...base,
            action: 'member_kick',
            eventType: 'member_kick',
            severity: 'medium',
            title: 'Mass kick',
            summary: `<@${actorId}> kicked <@${targetId}>`,
          });

        case AuditLogEvent.MemberBanAdd:
          return inspect({
            ...base,
            action: 'member_ban',
            eventType: 'member_ban',
            severity: 'high',
            title: 'Mass ban',
            summary: `<@${actorId}> banned <@${targetId}>`,
          });

        case AuditLogEvent.BotAdd:
          return inspect({
            ...base,
            action: 'bot_add',
            eventType: 'bot_add',
            severity: 'critical',
            title: 'Bot spam',
            summary: `<@${actorId}> added the bot <@${targetId}>`,
          });

        case AuditLogEvent.WebhookCreate:
          return inspect({
            ...base,
            action: 'webhook_create',
            eventType: 'webhook_create',
            severity: 'high',
            title: 'Webhook spam',
            summary: `<@${actorId}> created a webhook`,
          });

        case AuditLogEvent.WebhookUpdate:
          return inspect({
            ...base,
            action: 'webhook_update',
            eventType: 'webhook_update',
            severity: 'medium',
            title: 'Webhook tampering',
            summary: `<@${actorId}> modified a webhook`,
          });

        case AuditLogEvent.RoleUpdate: {
          // Only permission *escalation* matters; renames and colour changes are
          // legitimate admin work and must not count towards the raid window.
          const change = entry.changes.find((c) => c.key === 'permissions');
          if (!change) return;

          const before = typeof change.old === 'string' ? change.old : null;
          const after = typeof change.new === 'string' ? change.new : null;
          const gained = gainedDangerousPermissions(before, after);
          if (gained.length === 0) return;

          return inspect({
            ...base,
            action: 'role_permission_escalation',
            eventType: 'role_permission_escalation',
            severity: 'critical',
            title: 'Permission escalation',
            summary: `<@${actorId}> gave ${targetId ? `<@&${targetId}>` : 'a role'} ${gained.join(', ')}`,
            details: { ...base.details, gained, roleId: targetId },
          });
        }

        default:
          return;
      }
    });

    /**
     * SLM second-opinion layer. Discord's own AutoMod already flags the obvious
     * stuff; whenever an action *executes* we forward the original content to a
     * small, fast Groq model and ask whether it is genuinely harmful — including
     * evasive forms (leetspeak, spacing, unicode) static word lists miss. The
     * dedicated `GROQ_AUTOMOD_API_KEY` keeps this off the chat quota.
     *
     * We fail OPEN: a transport/parse failure is a "not bad" verdict, and we
     * never punish from here — the classifier only *escalates* (records an
     * incident, alerts, writes the audit log). The audit log is what an admin
     * acts on; silent deletions of legit speech would be the worse failure mode.
     */
    listen(Events.AutoModerationActionExecution, async (execution) => {
      const env = services.env;
      const guild = execution.guild;
      if (!slmEnabled(env)) return;

      const text = execution.content?.trim();
      if (!text) return;

      const config = await readConfig(services, guild.id).catch(() => null);
      if (!config || !config.enabled || !config.automodSlm) return;

      const result = await classifyContent(env, text, log);
      if (!result.ok || !result.bad) {
        // Not flagged: a message hit AutoMod's static filter but the SLM judged
        // it benign. That is a clean-behaviour signal we bank toward trust.
        if (config.trustMode && execution.userId) {
          void creditClean(services, log, guild.id, execution.userId);
        }
        return;
      }
      if (result.confidence < config.slmThreshold) return;

      const severity =
        result.category === 'threat' || result.category === 'sexual' || result.category === 'hate' || result.category === 'slur'
          ? 'high'
          : 'medium';

      if (config.trustMode && execution.userId) {
        void recordIncident(services, log, guild.id, execution.userId, severity);
      }

      if (config.alert_channel) {
        const channel = await client.channels.fetch(config.alert_channel).catch(() => null);
        if (channel?.isTextBased()) {
          await (channel as GuildTextBasedChannel)
            .send({
              embeds: [
                services.embeds.error(
                  '🛡️ SLM flagged content',
                  `AutoMod ran on a message in <#${execution.channelId}> and the SLM judged it harmful.`,
                  {
                    fields: [
                      { name: 'User', value: `<@${execution.userId}>`, inline: true },
                      { name: 'Category', value: result.category, inline: true },
                      { name: 'Confidence', value: `${(result.confidence * 100).toFixed(0)}%`, inline: true },
                      {
                        name: 'Trigger',
                        value: execution.matchedKeyword || execution.ruleTriggerType.toString(),
                        inline: false,
                      },
                    ],
                  },
                ),
              ],
              allowedMentions: { parse: [] },
            })
            .catch(() => undefined);
        }
      }

      services.logs.push({
        bot_id: env.botId,
        guild_id: guild.id,
        channel_id: execution.channelId,
        user_id: execution.userId,
        action: 'automod.slm.flag',
        level: severity === 'high' ? 'error' : 'warn',
        message: sanitizeText(`${result.category} (${result.confidence.toFixed(2)}) — ${text.slice(0, 200)}`, 512),
        meta: { category: result.category, confidence: result.confidence, ruleTrigger: execution.ruleTriggerType },
        created_at: new Date(),
      });
    });

    log.info({ guilds: client.guilds.cache.size }, 'antinuke bot initialised');
  },
});
