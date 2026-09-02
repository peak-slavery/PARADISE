import { randomUUID } from 'node:crypto';
import type { Kv } from './redis.js';
import { keys } from './redis.js';

export const INTERLINK_MAX_BYTES = 32 * 1024;

export type InterlinkEvent = {
  id: string;
  type: string;
  sourceBot: string;
  targetBot?: string;
  guildId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type InterlinkHandler = (event: InterlinkEvent) => void | Promise<void>;

function channelName(botId: string): string {
  if (!/^[a-z0-9-]{2,32}$/.test(botId)) throw new Error('Invalid bot id');
  return `bot:${botId}`;
}

function serialize(event: InterlinkEvent): string {
  const value = JSON.stringify(event);
  if (Buffer.byteLength(value, 'utf8') > INTERLINK_MAX_BYTES) {
    throw new Error('Interlink payload exceeds 32 KiB');
  }
  return value;
}

export class BotInterlink {
  constructor(private readonly kv: Kv, private readonly sourceBot: string) {}

  async publish(
    type: string,
    payload: Record<string, unknown>,
    options: { targetBot?: string; guildId?: string } = {},
  ): Promise<InterlinkEvent> {
    if (!/^[a-z][a-z0-9_.:-]{1,63}$/.test(type)) throw new Error('Invalid interlink event type');
    const event: InterlinkEvent = {
      id: randomUUID(),
      type,
      sourceBot: this.sourceBot,
      targetBot: options.targetBot,
      guildId: options.guildId,
      createdAt: new Date().toISOString(),
      payload,
    };
    const serialized = serialize(event);
    const channel = channelName(options.targetBot ?? 'broadcast');
    await this.kv.publish(channel, serialized);
    await this.kv.set(keys.interlink(channel), event, 120);
    return event;
  }

  async heartbeat(guildCount: number): Promise<void> {
    const status = { botId: this.sourceBot, guildCount, at: new Date().toISOString() };
    await this.kv.set(keys.heartbeat(this.sourceBot), status, 90);
    await this.kv.set(keys.status(this.sourceBot), { state: 'online', ...status }, 90);
  }

  /**
   * REST Redis providers do not expose a long-lived subscribe connection. Poll
   * the short-lived latest-event envelope instead; each bot has its own key so
   * this remains bounded and does not fan every event into every process.
   */
  startPolling(handler: InterlinkHandler, intervalMs = 2_000): () => void {
    let stopped = false;
    let lastEventId = '';

    const poll = async (): Promise<void> => {
      if (stopped) return;
      try {
        const event = await this.kv.get<InterlinkEvent>(keys.interlink(channelName(this.sourceBot)));
        if (!event || event.id === lastEventId || event.targetBot !== this.sourceBot) return;
        lastEventId = event.id;
        await handler(event);
      } catch {
        // A transient Redis or handler failure must not take down the gateway.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    timer.unref?.();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
