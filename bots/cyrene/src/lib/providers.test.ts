import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AllProvidersFailedError,
  completeWithFallback,
  providerHealth,
  type ChatMessage,
  type Provider,
  type RouteDescriptor,
} from './providers.js';
import { DEFAULT_RESILIENCE_POLICY } from './resilience.js';

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hello' }];
const SIGNAL = new AbortController().signal;

/** Minimal logger double: the router only calls .warn with a context object. */
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function provider(id: string, behavior: () => Promise<string>): Provider {
  return {
    id,
    name: id,
    model: `${id}-model`,
    available: true,
    complete: behavior,
  };
}

function route(primary: Provider, fallbacks: Provider[] = []): RouteDescriptor {
  return { route: 'cyrene', label: 'test', primary, fallbacks };
}

afterEach(() => {
  providerHealth.reset();
});

describe('completeWithFallback resilience', () => {
  it('returns the first successful provider without touching fallbacks', async () => {
    const fallback = vi.fn(async () => 'fallback');
    const result = await completeWithFallback(
      route(provider('primary', async () => 'primary'), [provider('secondary', fallback)]),
      MESSAGES,
      { signal: SIGNAL, log },
    );
    expect(result.text).toBe('primary');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('retries a transient failure before falling through', async () => {
    let attempts = 0;
    const primary = provider('primary', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('primary returned HTTP 500');
      return 'recovered';
    });

    const result = await completeWithFallback(route(primary), MESSAGES, { signal: SIGNAL, log });
    expect(attempts).toBe(2);
    expect(result.text).toBe('recovered');
    // A successful retry must leave the breaker closed.
    expect(providerHealth.get('primary').state).toBe('closed');
  });

  it('does not retry a rate-limited provider and fails over immediately', async () => {
    const throttled = vi.fn(async () => {
      throw new Error('primary returned HTTP 429');
    });
    const result = await completeWithFallback(
      route(provider('primary', throttled), [provider('secondary', async () => 'ok')]),
      MESSAGES,
      { signal: SIGNAL, log },
    );

    expect(result.text).toBe('ok');
    // Exactly one attempt was made against the throttled provider.
    expect(throttled).toHaveBeenCalledTimes(1);
    // And it was parked, not merely skipped for this call.
    expect(providerHealth.get('primary').state).toBe('open');
  });

  it('skips a provider whose circuit is already open', async () => {
    const dead = vi.fn(async () => {
      throw new Error('primary returned HTTP 429');
    });
    const first = route(provider('primary', dead), [provider('secondary', async () => 'ok')]);
    await completeWithFallback(first, MESSAGES, { signal: SIGNAL, log });
    expect(dead).toHaveBeenCalledTimes(1);

    // Second request: the breaker should prevent any further attempts.
    await completeWithFallback(first, MESSAGES, { signal: SIGNAL, log });
    expect(dead).toHaveBeenCalledTimes(1);
  });

  it('throws AllProvidersFailedError only when every provider is exhausted', async () => {
    const failing = () => provider('p', async () => {
      throw new Error('p returned HTTP 429');
    });
    await expect(
      completeWithFallback(route(failing(), [failing()]), MESSAGES, { signal: SIGNAL, log }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('reports no usable provider when every key is absent', async () => {
    const unavailable: Provider = {
      id: 'none',
      name: 'none',
      model: 'none',
      available: false,
      complete: async () => 'never',
    };
    await expect(completeWithFallback(route(unavailable), MESSAGES, { signal: SIGNAL, log }))
      .rejects.toThrow(/no provider API key configured/);
  });

  it('stops retrying when the caller aborts mid-backoff', async () => {
    const controller = new AbortController();
    const attempt = vi.fn(async () => {
      throw new Error('primary returned HTTP 500');
    });

    const pending = completeWithFallback(
      route(provider('primary', attempt)),
      MESSAGES,
      { signal: controller.signal, log },
    );
    setTimeout(() => controller.abort(new Error('request cancelled')), 10);

    await expect(pending).rejects.toThrow();
    // One attempt, then the abort cancelled the backoff rather than falling over.
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('honours the configured attempt budget', async () => {
    expect(DEFAULT_RESILIENCE_POLICY.maxAttempts).toBe(2);
    const attempt = vi.fn(async () => {
      throw new Error('primary returned HTTP 503');
    });
    await expect(completeWithFallback(route(provider('primary', attempt)), MESSAGES, { signal: SIGNAL, log }))
      .rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(DEFAULT_RESILIENCE_POLICY.maxAttempts);
  });
});