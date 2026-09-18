import { Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { registerGuildEvent, type EventGateDeps } from './event-gate.js';
import { APPROVED_PRODUCTION_GUILD_ID, type GuildPolicyEnv } from './guild-policy.js';

const env: GuildPolicyEnv = { runtimeEnvironment: 'production' };
const log = { debug: vi.fn(), error: vi.fn() };

function client() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    }),
  };
}

function deps(overrides: Partial<Pick<EventGateDeps, 'isAuthorized' | 'getControlState'>> = {}) {
  return {
    env,
    log,
    isAuthorized: overrides.isAuthorized ?? (async () => true),
    getControlState: overrides.getControlState ?? (async () => ({ enabled: true, paused: false, serverPaused: false })),
  };
}

function emit(target: ReturnType<typeof client>, event: string, ...args: unknown[]) {
  const listener = target.listeners.get(event);
  if (!listener) throw new Error(`missing listener for ${event}`);
  return listener(...args);
}

describe('guild event gate', () => {
  it('rejects an ambiguous guild before authorization or domain handling', async () => {
    const target = client();
    const handler = vi.fn();
    const isAuthorized = vi.fn(async () => true);
    registerGuildEvent(target as never, Events.MessageBulkDelete, handler, deps({ isAuthorized }));
    emit(target, Events.MessageBulkDelete, ['message-1', 'message-2']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isAuthorized).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical guild before authorization or domain handling', async () => {
    const target = client();
    const handler = vi.fn();
    const isAuthorized = vi.fn(async () => true);
    registerGuildEvent(target as never, Events.MessageCreate, handler, deps({ isAuthorized }));
    emit(target, Events.MessageCreate, { guildId: '849213847293847021' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isAuthorized).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized guild before operational state or domain handling', async () => {
    const target = client();
    const handler = vi.fn();
    const isAuthorized = vi.fn(async () => false);
    const getControlState = vi.fn(async () => ({ enabled: true, paused: false, serverPaused: false }));
    registerGuildEvent(target as never, Events.MessageCreate, handler, deps({ isAuthorized, getControlState }));
    emit(target, Events.MessageCreate, { guildId: APPROVED_PRODUCTION_GUILD_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isAuthorized).toHaveBeenCalledOnce();
    expect(getControlState).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a paused guild before domain handling', async () => {
    const target = client();
    const handler = vi.fn();
    const getControlState = vi.fn(async () => ({ enabled: true, paused: true, serverPaused: false }));
    registerGuildEvent(target as never, Events.MessageCreate, handler, deps({ getControlState }));
    emit(target, Events.MessageCreate, { guildId: APPROVED_PRODUCTION_GUILD_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getControlState).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('invokes the domain handler for an authorized, enabled guild', async () => {
    const target = client();
    const message = { guildId: APPROVED_PRODUCTION_GUILD_ID };
    const handler = vi.fn(async () => undefined);
    registerGuildEvent(target as never, Events.MessageCreate, handler, deps());
    emit(target, Events.MessageCreate, message);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledWith(message);
  });
});
