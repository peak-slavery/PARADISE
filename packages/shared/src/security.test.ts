import { describe, expect, it } from 'vitest';

import { signRequest, verifyRequest } from './hmac.js';
import { TaskQueue, QueueTimeoutError } from './queue.js';
import { enforceRateLimit } from './rate-limit.js';
import { isSecureMongoUri } from './db/mongo.js';

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

describe('database transport validation', () => {
  it('requires encrypted Mongo transport', () => {
    expect(isSecureMongoUri('mongodb+srv://user:pass@example.test/db')).toBe(true);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db')).toBe(false);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db?tls=false')).toBe(false);
    expect(isSecureMongoUri('mongodb://user:pass@example.test/db?tls=true')).toBe(true);
  });
});
