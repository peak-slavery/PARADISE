import { describe, expect, it } from 'vitest';

import { signRequest, verifyRequest } from './hmac.js';
import { TaskQueue, QueueTimeoutError } from './queue.js';
import { enforceRateLimit } from './rate-limit.js';
import { isSecureMongoUri } from './db/mongo.js';
import { isGuildAuthorized } from './server-lock.js';
import { BotInterlink, INTERLINK_MAX_BYTES, type InterlinkEvent } from './interlink.js';
import { isGuildWhitelisted, isPermanentGuild } from './whitelist.js';
import { buildClientOptions, parseGuildAuthorizationButton } from './bot.js';

describe('Discord client options', () => {
  it('omits partials when they are not configured', () => {
    expect(buildClientOptions({ intents: [] })).toEqual({ intents: [] });
  });

  it('preserves configured partials', () => {
    const partials = [0, 1];
    expect(buildClientOptions({ intents: [], partials })).toEqual({ intents: [], partials });
  });
});

describe('guild authorization controls', () => {
  it('accepts only canonical review button identifiers', () => {
    expect(parseGuildAuthorizationButton('guild-auth:temp:123456789012345678')).toEqual({
      decision: 'temp',
      guildId: '123456789012345678',
    });
  });

  it('rejects forged or malformed review button identifiers', () => {
    expect(parseGuildAuthorizationButton('guild-auth:full:123')).toBeNull();
    expect(parseGuildAuthorizationButton('guild-auth:full:123456789012345678:extra')).toBeNull();
    expect(parseGuildAuthorizationButton('guild-auth:approve:123456789012345678')).toBeNull();
  });
});

describe('HMAC transport', () => {
  it('accepts a valid current signature and rejects tampering', () => {
    const body = JSON.stringify({ request_id: 'request-12345678' });
    const signed = signRequest('a'.repeat(32), body, Math.floor(Date.now() / 1000));

    expect(verifyRequest('a'.repeat(32), body, signed.timestamp, signed.signature).ok).toBe(true);
    expect(verifyRequest('a'.repeat(32), `${body}x`, signed.timestamp, signed.signature).ok).toBe(false);
  });

  it('rejects stale signatures', () => {
    const signed = signRequest('a'.repeat(32), '{}', Math.floor(Date.now() / 1000) - 301);
    expect(verifyRequest('a'.repeat(32), '{}', signed.timestamp, signed.signature)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });
});

describe('guild whitelist', () => {
  it('fails closed without Supabase and recognizes configured fixed guilds', async () => {
    await expect(isGuildWhitelisted(null, '123456789012345678')).resolves.toBe(false);
    expect(isPermanentGuild({ devGuildId: '123456789012345678', mainGuildId: undefined }, '123456789012345678')).toBe(true);
  });

  it('accepts active full and future temporary rows, but rejects expired rows', async () => {
    const row = { whitelist_type: 'full', expires_at: null };
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
      }),
    } as never;
    await expect(isGuildWhitelisted(supabase, '123456789012345678')).resolves.toBe(true);
  });
});

describe('abuse controls', () => {
  it('fails closed when the distributed limiter errors', async () => {
    const kv = { allow: async () => { throw new Error('redis unavailable'); } } as never;
    await expect(enforceRateLimit(kv, 'key')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('retains a queue slot until a timed-out task settles', async () => {
    let settle!: () => void;
    const running = new Promise<void>((resolve) => { settle = resolve; });
    const queue = new TaskQueue({ concurrency: 1, timeoutMs: 5 });
    const first = queue.run(() => running);

    await expect(first).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(queue.stats.active).toBe(1);

    const second = queue.run(async () => 'second', { maxPending: 1 });
    expect(queue.stats.pending).toBe(1);
    settle();
    await expect(second).resolves.toBe('second');
    expect(queue.stats.active).toBe(0);
  });
});

describe('HMAC timestamp canonicalization', () => {
  it('requires a canonical, digit-only timestamp header', () => {
    const secret = 'a'.repeat(32);
    const body = '{}';
    const now = Math.floor(Date.now() / 1000);

    // A canonical timestamp still verifies.
    const valid = signRequest(secret, body, now);
    expect(verifyRequest(secret, body, valid.timestamp, valid.signature).ok).toBe(true);

    // Each of these denotes a valid instant under a permissive Number(), which
    // would let one signed instant be presented under several header strings.
    // Only the canonical form may verify.
    for (const malformed of ['1e3', ' 1000 ', '1000.0', '1000junk', '', '+1000']) {
      const signed = signRequest(secret, body, 1000);
      expect(verifyRequest(secret, body, malformed, signed.signature).ok).toBe(false);
    }
  });
});

describe('database transport validation', () => {
  it('requires encrypted Mongo transport', () => {
    expect(isSecureMongoUri('mongodb+srv://user:pass@example.test/db')).toBe(true);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db')).toBe(false);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db?tls=false')).toBe(false);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db?tls=true')).toBe(true);
  });
});

describe('guild authorization', () => {
  it('fails closed when the authorization source is unavailable', async () => {
    // A missing client or a query error must never be treated as "authorized":
    // an outage would otherwise let any guild drive the bot's moderation and
    // antinuke features.
    await expect(isGuildAuthorized(null, '849213847293847021')).resolves.toBe(false);

    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { code: '500', message: 'boom' } }),
          }),
        }),
      }),
    } as never;

    await expect(isGuildAuthorized(failing, '849213847293847021')).resolves.toBe(false);
  });

  it('authorizes only an explicit positive row', async () => {
    const build = (row: unknown, error: unknown = null) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
          }),
        }),
      }) as never;

    await expect(isGuildAuthorized(build({ authorized: true }), '849213847293847021')).resolves.toBe(true);
    await expect(isGuildAuthorized(build({ authorized: false }), '849213847293847021')).resolves.toBe(false);
    await expect(isGuildAuthorized(build(null), '849213847293847021')).resolves.toBe(false);
  });
});

describe('bot interlink', () => {
  it('rejects envelopes larger than the shared transport cap', async () => {
    const kv = {
      publish: async () => 1,
      set: async () => undefined,
    } as never;
    const interlink = new BotInterlink(kv, 'shanks');

    await expect(
      interlink.publish('dashboard.send_embed', { content: 'x'.repeat(INTERLINK_MAX_BYTES) }, { targetBot: 'shanks' }),
    ).rejects.toThrow('32 KiB');
  });

  it('polls only events targeted to the source bot once', async () => {
    let current: InterlinkEvent | null = {
      id: 'event-1',
      type: 'dashboard.send_embed',
      sourceBot: 'dashboard',
      targetBot: 'shanks',
      guildId: '849213847293847021',
      createdAt: new Date().toISOString(),
      payload: { channelId: '123456789012345678' },
    };
    const kv = {
      get: async () => current,
    } as never;
    const interlink = new BotInterlink(kv, 'shanks');
    const received: string[] = [];
    const stop = interlink.startPolling((event) => {
      received.push(event.id);
    }, 5);

    await new Promise((resolve) => setTimeout(resolve, 15));
    current = { ...current, id: 'event-2', targetBot: 'zoro' };
    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();

    expect(received).toEqual(['event-1']);
  });
});
