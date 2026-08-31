import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuditLogEvent,
  Events,
  GatewayIntentBits,
  Partials,
  type ClientEvents,
  type VoiceState,
} from 'discord.js';
import { createBot, sanitizeText } from '@eiflow/shared';
import { redactContent, redactName, recordEvent, type EventEnv, type LogAction } from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, 'commands');

await createBot({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    // Privileged: without it Discord never sends message bodies.
    GatewayIntentBits.MessageContent,
    // Voice join/leave/move events never fire without it.
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Deleted/edited messages are only in cache if recent; partials let discord.js
  // hand us what it still has instead of nothing.
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  commandsDir,
  unlimitedCommands: ['userinfo', 'serverinfo', 'about', 'help'],

  setup: async ({ client, services, log }) => {
    const env: EventEnv = { client, services, log };

    /**
     * Registers an async listener whose rejection is always caught.
     *
     * A logging bot is the last thing that should be able to take a process
     * down, so no handler is ever allowed to throw out of the event emitter.
     * Typing against `ClientEvents` keeps every handler parameter inferred.
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
          log.error({ err, event: String(event) }, 'logging event handler failed');
        });
      }) as (...args: unknown[]) => void);
    };

    /** Fire-and-forget wrapper: persists the LogDoc, then posts the live embed. */
    const emit = (input: Parameters<typeof recordEvent>[1]): void => {
      void recordEvent(env, input).catch((err: unknown) => {
        log.error({ err, action: input.action, guildId: input.guildId }, 'failed to record event');
      });
    };

    /* --- messages ------------------------------------------------------- */

    listen(Events.MessageDelete, async (message) => {
      if (!message.guildId || message.author?.bot) return;

      const content = redactContent(message.content);
      emit({
        guildId: message.guildId,
        action: 'log.message.delete',
        title: 'Message deleted',
        message: `${message.author ? `<@${message.author.id}> ` : ''}deleted a message in <#${message.channelId}>`,
        channelId: message.channelId,
        userId: message.author?.id ?? null,
        meta: { content, messageId: message.id },
        fields: [
          { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
          { name: 'Author', value: message.author ? `<@${message.author.id}>` : 'unknown', inline: true },
          { name: 'Content', value: content, inline: false },
        ],
      });
    });

    listen(Events.MessageUpdate, async (oldMessage, newMessage) => {
      const guildId = newMessage.guildId ?? oldMessage.guildId;
      if (!guildId || newMessage.author?.bot) return;

      const before = oldMessage.content;
      const after = newMessage.content;
      // Link unfurls and embed loads fire MessageUpdate without an edit.
      if (before === after || before === null || after === null) return;
      if (before === undefined || after === undefined) return;

      const redactedBefore = redactContent(before);
      const redactedAfter = redactContent(after);

      emit({
        guildId,
        action: 'log.message.update',
        title: 'Message edited',
        message: `${newMessage.author ? `<@${newMessage.author.id}> ` : ''}edited a message in <#${newMessage.channelId}>`,
        channelId: newMessage.channelId,
        userId: newMessage.author?.id ?? null,
        meta: { before: redactedBefore, after: redactedAfter, messageId: newMessage.id },
        fields: [
          { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
          {
            name: 'Author',
            value: newMessage.author ? `<@${newMessage.author.id}>` : 'unknown',
            inline: true,
          },
          { name: 'Before', value: redactedBefore, inline: false },
          { name: 'After', value: redactedAfter, inline: false },
        ],
      });
    });

    listen(Events.MessageBulkDelete, async (messages, channel) => {
      if (!channel.guildId) return;

      const authors = new Set<string>();
      for (const message of messages.values()) {
        if (message.author && !message.author.bot) authors.add(message.author.id);
      }

      emit({
        guildId: channel.guildId,
        action: 'log.message.bulk_delete',
        title: 'Messages purged',
        message: `${messages.size} message(s) were bulk-deleted in <#${channel.id}>`,
        channelId: channel.id,
        level: 'warn',
        meta: { count: messages.size, authors: [...authors] },
        fields: [
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Deleted', value: String(messages.size), inline: true },
          { name: 'Authors', value: authors.size ? `${authors.size} member(s)` : 'unknown', inline: true },
        ],
      });
    });

    /* --- members -------------------------------------------------------- */

    listen(Events.GuildMemberAdd, async (member) => {
      emit({
        guildId: member.guild.id,
        action: 'log.member.add',
        title: 'Member joined',
        message: `<@${member.id}> (${sanitizeText(member.user.tag, 64)}) joined the server`,
        userId: member.id,
        meta: { tag: member.user.tag },
        fields: [
          { name: 'Member', value: `<@${member.id}>`, inline: true },
          { name: 'Account', value: sanitizeText(member.user.tag, 64), inline: true },
        ],
      });
    });

    listen(Events.GuildMemberRemove, async (member) => {
      emit({
        guildId: member.guild.id,
        action: 'log.member.remove',
        title: 'Member left',
        message: `<@${member.id}> left (or was removed from) the server`,
        userId: member.id,
        meta: { tag: member.user?.tag ?? null },
        fields: [{ name: 'Member', value: `<@${member.id}>`, inline: true }],
      });
    });

    /* --- channels ------------------------------------------------------- */

    listen(Events.ChannelCreate, async (channel) => {
      if (channel.isDMBased() || !channel.guildId) return;
      const name = redactName(channel.name);
      emit({
        guildId: channel.guildId,
        action: 'log.channel.create',
        title: 'Channel created',
        message: `#${name} was created`,
        channelId: channel.id,
        meta: { name, type: channel.type },
        fields: [
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Name', value: name, inline: true },
        ],
      });
    });

    listen(Events.ChannelDelete, async (channel) => {
      if (channel.isDMBased() || !channel.guildId) return;
      const name = redactName(channel.name);
      emit({
        guildId: channel.guildId,
        action: 'log.channel.delete',
        title: 'Channel deleted',
        message: `#${name} was deleted`,
        channelId: channel.id,
        level: 'warn',
        meta: { name, type: channel.type },
        fields: [{ name: 'Name', value: name, inline: true }],
      });
    });

    /* --- roles ---------------------------------------------------------- */

    listen(Events.GuildRoleCreate, async (role) => {
      const name = redactName(role.name);
      emit({
        guildId: role.guild.id,
        action: 'log.role.create',
        title: 'Role created',
        message: `\`${name}\` was created`,
        meta: { roleId: role.id, name },
        fields: [
          { name: 'Role', value: `<@&${role.id}>`, inline: true },
          { name: 'Name', value: name, inline: true },
        ],
      });
    });

    listen(Events.GuildRoleDelete, async (role) => {
      const name = redactName(role.name);
      emit({
        guildId: role.guild.id,
        action: 'log.role.delete',
        title: 'Role deleted',
        message: `\`${name}\` was deleted`,
        level: 'warn',
        meta: { roleId: role.id, name },
        fields: [{ name: 'Name', value: name, inline: true }],
      });
    });

    /* --- voice ---------------------------------------------------------- */

    const label = (state: VoiceState): string =>
      state.channel?.name ? `#${redactName(state.channel.name)}` : 'a voice channel';

    listen(Events.VoiceStateUpdate, async (oldState, newState) => {
      const wasIn = Boolean(oldState.channelId);
      const isIn = Boolean(newState.channelId);

      let action: Extract<LogAction, 'log.voice.join' | 'log.voice.leave' | 'log.voice.move'>;
      let message: string;

      if (!wasIn && isIn) {
        action = 'log.voice.join';
        message = `<@${newState.id}> joined ${label(newState)}`;
      } else if (wasIn && !isIn) {
        action = 'log.voice.leave';
        message = `<@${newState.id}> left ${label(oldState)}`;
      } else if (oldState.channelId !== newState.channelId) {
        action = 'log.voice.move';
        message = `<@${newState.id}> moved from ${label(oldState)} to ${label(newState)}`;
      } else {
        // Mute / deafen / stream toggles — deliberately not logged.
        return;
      }

      emit({
        guildId: newState.guild.id,
        action,
        title: 'Voice state changed',
        message,
        userId: newState.id,
        meta: { from: oldState.channelId ?? null, to: newState.channelId ?? null },
        fields: [
          { name: 'Member', value: `<@${newState.id}>`, inline: true },
          { name: 'From', value: label(oldState), inline: true },
          { name: 'To', value: label(newState), inline: true },
        ],
      });
    });

    /* --- moderation (audit log) ----------------------------------------- */

    const MODERATION_ACTIONS: Partial<
      Record<AuditLogEvent, { action: LogAction; title: string; verb: string }>
    > = {
      [AuditLogEvent.MemberKick]: { action: 'log.moderation.kick', title: 'Member kicked', verb: 'kicked' },
      [AuditLogEvent.MemberBanAdd]: { action: 'log.moderation.ban', title: 'Member banned', verb: 'banned' },
      [AuditLogEvent.MemberBanRemove]: {
        action: 'log.moderation.unban',
        title: 'Member unbanned',
        verb: 'unbanned',
      },
    };

    listen(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
      const mapped = MODERATION_ACTIONS[entry.action];
      // The audit log emits every guild change; only moderation is ours to log.
      if (!mapped) return;

      const actorId = entry.executorId;
      const targetId = entry.targetId;
      // Without an executor we cannot attribute the action to anyone.
      if (!actorId || !targetId) return;

      const reason = entry.reason ? sanitizeText(entry.reason, 256) : 'No reason provided';

      emit({
        guildId: guild.id,
        action: mapped.action,
        title: mapped.title,
        message: `<@${actorId}> ${mapped.verb} <@${targetId}>`,
        userId: actorId,
        level: 'warn',
        meta: { targetId, reason, auditEntryId: entry.id },
        fields: [
          { name: 'Target', value: `<@${targetId}>`, inline: true },
          { name: 'Moderator', value: `<@${actorId}>`, inline: true },
          { name: 'Reason', value: reason, inline: false },
        ],
      });
    });

    log.info({ guilds: client.guilds.cache.size }, 'logging bot initialised');
  },
});
