import { describe, expect, it, vi } from 'vitest';

import { signRequest, verifyRequest } from './hmac.js';
import { TaskQueue, QueueTimeoutError } from './queue.js';
import { enforceRateLimit } from './rate-limit.js';
import { isSecureMongoUri } from './db/mongo.js';
import { isGuildAuthorized, attachServerLock } from './server-lock.js';
import { BotInterlink, INTERLINK_MAX_BYTES, type InterlinkEvent } from './interlink.js';
import {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  isApprovedGuild,
} from './guild-policy.js';
import { isGuildWhitelisted, resolveGuildAuthorization } from './whitelist.js';
import { buildClientOptions, buildDashboardEmbed, handleDashboardEmbed, redactAuditMeta } from './bot.js';

const schema = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../../../infra/supabase/schema.sql', import.meta.url), 'utf8'),
);

describe('security schema and audit boundaries', () => {
  it('provisions a dashboard profile when a Supabase Auth user is created', () => {
    expect(schema).toContain('on_auth_user_created');
    expect(schema).toContain('insert into public.users');
    expect(schema).toContain('raw_user_meta_data');
  });

  it('redacts credential-shaped audit metadata before storage', () => {
    expect(redactAuditMeta({
      token: 'secret-token',
      nested: { dashboard: 'https://example.invalid/token', discord: 'MTA5NzgxNDUyOTg3MTA5Mzc3OA.Gxxxxx.rest' },
    })).toEqual({
      token: '[redacted]',
      nested: { dashboard: 'https://example.invalid/token', discord: '[redacted]' },
    });
  });
});

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
  it('allows only the canonical guild for the matching runtime environment', () => {
    expect(isApprovedGuild(APPROVED_PRODUCTION_GUILD_ID, { runtimeEnvironment: 'production' })).toBe(true);
    expect(isApprovedGuild(APPROVED_DEVELOPMENT_GUILD_ID, { runtimeEnvironment: 'development' })).toBe(true);
    expect(isApprovedGuild(APPROVED_PRODUCTION_GUILD_ID, { runtimeEnvironment: 'development' })).toBe(false);
    expect(isApprovedGuild(APPROVED_DEVELOPMENT_GUILD_ID, { runtimeEnvironment: 'production' })).toBe(false);
  });

  it('rejects missing, malformed, and non-canonical guilds before storage', () => {
    expect(isApprovedGuild('', { runtimeEnvironment: 'production' })).toBe(false);
    expect(isApprovedGuild('123', { runtimeEnvironment: 'production' })).toBe(false);
    expect(isApprovedGuild('849213847293847021', { runtimeEnvironment: 'production' })).toBe(false);
  });
});

describe('server lock lifecycle', () => {
  it('returns a control that reconciles the server directory', async () => {
    const client = {
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      guilds: { cache: new Map() },
    } as never;
    const control = attachServerLock(client, {
      env: { runtimeEnvironment: 'production', botId: 'test-bot' },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      supabase: null,
      record: () => undefined,
    });

    expect(control.isReady()).toBe(false);
    await expect(control.reconcile()).resolves.toBe(false);
    control.stop();
  });

  it('becomes ready only after a successful canonical reconciliation', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: { whitelist_type: 'full' }, error: null }) }),
          }),
        }),
      }),
    } as never;
    const client = {
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      guilds: { cache: new Map() },
    } as never;
    const control = attachServerLock(client, {
      env: { runtimeEnvironment: 'production', botId: 'test-bot' },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      supabase,
      record: () => undefined,
    });

    await expect(control.reconcile()).resolves.toBe(true);
    expect(control.isReady()).toBe(true);
    control.stop();
  });

  it('leaves current guilds when Supabase authorization is unavailable', async () => {
    const leave = vi.fn().mockResolvedValue(undefined);
    const client = {
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      guilds: {
        cache: new Map([['848841415940898827', {
          id: '848841415940898827',
          name: 'test-guild',
          memberCount: 1,
          leave,
        }]]),
      },
    } as never;
    const control = attachServerLock(client, {
      env: { runtimeEnvironment: 'production', botId: 'test-bot' },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      supabase: null,
      record: () => undefined,
    });

    await expect(control.reconcile()).resolves.toBe(false);
    expect(leave).toHaveBeenCalledOnce();
    expect(control.isReady()).toBe(false);
    control.stop();
  });

  it('marks readiness unavailable when authorization fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST205' } }) }),
          }),
        }),
      }),
    } as never;
    const client = {
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      guilds: {
        cache: new Map([['848841415940898827', {
          id: '848841415940898827',
          name: 'test-guild',
          memberCount: 1,
          leave: vi.fn().mockResolvedValue(undefined),
        }]]),
      },
    } as never;
    const control = attachServerLock(client, {
      env: { runtimeEnvironment: 'production', botId: 'test-bot' },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      supabase,
      record: () => undefined,
    });

    await expect(control.reconcile()).resolves.toBe(false);
    expect(control.isReady()).toBe(false);
    control.stop();
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
  it('fails closed without Supabase and never authorizes a non-canonical guild', async () => {
    await expect(isGuildWhitelisted(null, APPROVED_PRODUCTION_GUILD_ID, { runtimeEnvironment: 'production' })).resolves.toBe(false);
    await expect(isGuildWhitelisted(null, '849213847293847021', { runtimeEnvironment: 'production' })).resolves.toBe(false);
  });

  it('accepts only an active row for the canonical guild in the matching environment', async () => {
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
    await expect(isGuildWhitelisted(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
    )).resolves.toBe(true);
    await expect(isGuildWhitelisted(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'development' },
    )).resolves.toBe(false);
  });

  it('does not trust a cached grant after its expiry', async () => {
    const expiry = new Date(Date.now() - 1_000).toISOString();
    const calls: string[] = [];
    const kv = {
      get: async () => ({ allowed: true }),
      set: async () => undefined,
    } as never;
    const supabase = {
      from: (table: string) => {
        calls.push(table);
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: table === 'guild_whitelists'
                    ? { whitelist_type: 'temp', expires_at: expiry, removed_at: null }
                    : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    } as never;

    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
      kv,
    )).resolves.toBe('denied');
    expect(calls).toEqual(['guild_whitelists']);
  });

  it('preserves authorization unavailability only for the canonical guild', async () => {
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST205' } }) }),
          }),
        }),
      }),
    } as never;

    await expect(resolveGuildAuthorization(
      failing,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
    )).resolves.toBe('unavailable');
    await expect(resolveGuildAuthorization(
      failing,
      '849213847293847021',
      { runtimeEnvironment: 'production' },
    )).resolves.toBe('denied');
  });

  it('does not write cache entries for unauthorized guilds', async () => {
    const writes: unknown[] = [];
    const kv = { set: async (...args: unknown[]) => { writes.push(args); } } as never;
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    } as never;

    await resolveGuildAuthorization(supabase, '849213847293847021', { runtimeEnvironment: 'production' }, kv);
    expect(writes).toEqual([]);
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

  it('releases a queue slot at the timeout boundary', async () => {
    let settle!: () => void;
    const running = new Promise<void>((resolve) => { settle = resolve; });
    const queue = new TaskQueue({ concurrency: 1, timeoutMs: 5 });
    const first = queue.run(() => running);

    await expect(first).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(queue.stats.active).toBe(0);

    const second = queue.run(async () => 'second', { maxPending: 1 });
    await expect(second).resolves.toBe('second');

    settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queue.stats.active).toBe(0);
    expect(queue.stats.pending).toBe(0);
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
  const productionPolicy = { runtimeEnvironment: 'production' as const };
  const developmentPolicy = { runtimeEnvironment: 'development' as const };

  it('fails closed when the authorization source is unavailable', async () => {
    await expect(isGuildAuthorized(null, APPROVED_PRODUCTION_GUILD_ID, productionPolicy)).resolves.toBe(false);

    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: { code: '500', message: 'boom' } }),
            }),
          }),
        }),
      }),
    } as never;

    await expect(isGuildAuthorized(failing, APPROVED_PRODUCTION_GUILD_ID, productionPolicy)).resolves.toBe(false);
  });

  it('authorizes an active row only for the matching canonical guild', async () => {
    const row = { whitelist_type: 'full', expires_at: null, removed_at: null };
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
      }),
    } as never;

    await expect(isGuildAuthorized(supabase, APPROVED_PRODUCTION_GUILD_ID, productionPolicy)).resolves.toBe(true);
    await expect(isGuildAuthorized(supabase, APPROVED_PRODUCTION_GUILD_ID, developmentPolicy)).resolves.toBe(false);
    await expect(isGuildAuthorized(supabase, APPROVED_DEVELOPMENT_GUILD_ID, developmentPolicy)).resolves.toBe(true);
  });

  it('does not fall back to stale or legacy authorization rows', async () => {
    const legacy = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => ({ data: { authorized: true }, error: null }),
          }),
        }),
      }),
    } as never;

    await expect(isGuildAuthorized(legacy, APPROVED_PRODUCTION_GUILD_ID, productionPolicy)).resolves.toBe(false);

    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => ({ data: null, error: { code: '500', message: 'temporary failure' } }),
          }),
        }),
      }),
    } as never;

    await expect(isGuildAuthorized(failing, APPROVED_PRODUCTION_GUILD_ID, productionPolicy)).resolves.toBe(false);
  });
});

describe('bot interlink', () => {
  it('rejects a dashboard embed with no visible content', () => {
    expect(buildDashboardEmbed({ channelId: '123456789012345678' })).toBeNull();
    expect(buildDashboardEmbed({ channelId: '123456789012345678', title: 'Visible' })).not.toBeNull();
  });

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

  it('does not deliver queued embeds while the bot is paused', async () => {
    let fetched = false;
    const client = {
      channels: {
        fetch: async () => {
          fetched = true;
          throw new Error('channel fetch should not run');
        },
      },
    } as never;
    const event: InterlinkEvent = {
      id: 'paused-event',
      type: 'dashboard.send_embed',
      sourceBot: 'dashboard',
      targetBot: 'shanks',
      guildId: '849213847293847021',
      createdAt: new Date().toISOString(),
      payload: { channelId: '123456789012345678' },
    };

    await handleDashboardEmbed(
      client,
      event,
      { warn: () => undefined } as never,
      async () => true,
      async () => false,
    );

    expect(fetched).toBe(false);
  });

  it('retries an event when the handler fails before acknowledging it', async () => {
    const event: InterlinkEvent = {
      id: 'retry-event',
      type: 'dashboard.send_embed',
      sourceBot: 'dashboard',
      targetBot: 'shanks',
      guildId: '849213847293847021',
      createdAt: new Date().toISOString(),
      payload: { channelId: '123456789012345678' },
    };
    let attempts = 0;
    const kv = { get: async () => event } as never;
    const interlink = new BotInterlink(kv, 'shanks');
    const stop = interlink.startPolling(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient handler failure');
    }, 5);

    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();

    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('delivers untargeted broadcast events to the source bot', async () => {
    const event: InterlinkEvent = {
      id: 'broadcast-event',
      type: 'dashboard.refresh',
      sourceBot: 'dashboard',
      createdAt: new Date().toISOString(),
      payload: {},
    };
    const kv = {
      get: async (key: string) => key === 'bot:interlink:bot:broadcast' ? event : null,
    } as never;
    const interlink = new BotInterlink(kv, 'shanks');
    const received: string[] = [];
    const stop = interlink.startPolling((current) => {
      received.push(current.id);
    }, 5);

    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();

    expect(received).toEqual(['broadcast-event']);
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
