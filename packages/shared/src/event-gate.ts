import {
  Events,
  type Client,
  type ClientEvents,
} from 'discord.js';
import { isApprovedGuild, type GuildPolicyEnv } from './guild-policy.js';
import type { BotServices } from './types.js';

export type EventGateDeps = {
  env: GuildPolicyEnv;
  getControlState: (guildId: string) => Promise<{
    enabled: boolean;
    paused: boolean;
    serverPaused: boolean;
  }>;
  isAuthorized: (guildId: string) => Promise<boolean>;
  log: Pick<BotServices['log'], 'debug' | 'error'>;
};

type AsyncHandler<T extends unknown[]> = (...args: T) => Promise<void>;

/**
 * Extract the guild boundary from every gateway event that can reach a bot
 * domain handler. Events without an unambiguous guild are rejected.
 */
function eventGuildId(event: keyof ClientEvents, args: readonly unknown[]): string | null {
  switch (event) {
    case Events.MessageDelete:
    case Events.MessageCreate:
      return (args[0] as { guildId?: string | null } | undefined)?.guildId ?? null;
    case Events.MessageUpdate: {
      const oldMessage = args[0] as { guildId?: string | null } | undefined;
      const newMessage = args[1] as { guildId?: string | null } | undefined;
      return newMessage?.guildId ?? oldMessage?.guildId ?? null;
    }
    case Events.MessageBulkDelete: {
      const guild = args[2] as { id?: string } | undefined;
      const channel = args[1] as { guildId?: string | null } | undefined;
      return guild?.id ?? channel?.guildId ?? null;
    }
    case Events.ChannelCreate:
    case Events.ChannelDelete:
      return (args[0] as { guildId?: string | null } | undefined)?.guildId ?? null;
    case Events.GuildMemberAdd:
    case Events.GuildMemberRemove:
      return (args[0] as { guild?: { id?: string } } | undefined)?.guild?.id ?? null;
    case Events.GuildRoleCreate:
    case Events.GuildRoleDelete:
      return (args[0] as { guild?: { id?: string } } | undefined)?.guild?.id ?? null;
    case Events.VoiceStateUpdate: {
      const oldState = args[0] as { guild?: { id?: string } } | undefined;
      const newState = args[1] as { guild?: { id?: string } } | undefined;
      return newState?.guild?.id ?? oldState?.guild?.id ?? null;
    }
    case Events.AutoModerationActionExecution:
      return (args[0] as { guildId?: string | null } | undefined)?.guildId ?? null;
    case Events.GuildAuditLogEntryCreate:
      return (args[0] as { guildId?: string | null } | undefined)?.guildId ?? null;
    case Events.GuildCreate:
    case Events.GuildDelete:
      return (args[0] as { id?: string } | undefined)?.id ?? null;
    default:
      return null;
  }
}

/**
 * Register a bot event behind the same fail-closed guild and operational-state
 * gates used by interactions. No handler-local storage, queue, Redis, provider,
 * or domain work runs for an unauthorized or ambiguous guild context.
 */
export function registerGuildEvent<K extends keyof ClientEvents>(
  client: Client,
  event: K,
  handler: AsyncHandler<ClientEvents[K]>,
  deps: EventGateDeps,
): void {
  client.on(event, ((...args: unknown[]) => {
    void (async () => {
      const guildId = eventGuildId(event, args);
      if (!guildId || !isApprovedGuild(guildId, deps.env)) {
        deps.log.debug({ event: String(event), guildId }, 'gateway event rejected by canonical guild policy');
        return;
      }
      if (!(await deps.isAuthorized(guildId))) {
        deps.log.debug({ event: String(event), guildId }, 'gateway event rejected by guild authorization');
        return;
      }
      if (!await deps.getControlState(guildId).then((state) => state.enabled && !state.paused && !state.serverPaused)) {
        deps.log.debug({ event: String(event), guildId }, 'gateway event rejected while bot is paused');
        return;
      }
      await handler(...(args as ClientEvents[K]));
    })().catch((err: unknown) => {
      deps.log.error({ err, event: String(event), guildId: eventGuildId(event, args) }, 'gateway event handler failed');
    });
  }) as (...args: ClientEvents[K]) => void);
}

export function createGuildEventGate(
  client: Client,
  deps: EventGateDeps,
): <K extends keyof ClientEvents>(
  event: K,
  handler: AsyncHandler<ClientEvents[K]>,
) => void {
  return (event, handler) => registerGuildEvent(client, event, handler, deps);
}
