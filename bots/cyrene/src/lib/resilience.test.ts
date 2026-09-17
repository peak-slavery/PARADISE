import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESILIENCE_POLICY,
  DailyRequestBudget,
  ProviderHealthRegistry,
  admit,
  classifyFailure,
  delay,
  newProviderHealth,
  recordFailure,
  recordSuccess,
  retryDelayMs,
  shouldRetry,
} from './resilience.js';

const POLICY = { ...DEFAULT_RESILIENCE_POLICY, cooldownMs: 1_000, failureThreshold: 3, maxAttempts: 2 };

describe('provider circuit breaker', () => {
  it('starts closed and admits work', () => {
    const health = newProviderHealth('groq');
    expect(health.state).toBe('closed');
    expect(admit(health, 0, POLICY).allowed).toBe(true);
    expect(health.state).toBe('closed');
  });

  it('opens only after the failure threshold is reached', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'transient', 0, POLICY);
    recordFailure(health, 'transient', 1, POLICY);
    expect(health.state).toBe('closed');
    expect(admit(health, 2, POLICY).allowed).toBe(true);

    recordFailure(health, 'transient', 2, POLICY);
    expect(health.state).toBe('open');
    expect(admit(health, 3, POLICY).allowed).toBe(false);
    expect(admit(health, 3, POLICY).reason).toMatch(/circuit open/);
  });

  it('opens immediately on rate limiting without waiting for the threshold', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'rate_limited', 0, POLICY);
    expect(health.state).toBe('open');
    expect(admit(health, 1, POLICY).allowed).toBe(false);
  });

  it('opens immediately on a permanent failure (bad model or auth)', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'permanent', 0, POLICY);
    expect(health.state).toBe('open');
  });

  it('allows exactly one probe per cooldown window once the cooldown elapses', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'rate_limited', 0, POLICY);
    expect(admit(health, 500, POLICY).allowed).toBe(false);

    // Cooldown elapsed: exactly one probe is admitted.
    const probe = admit(health, 1_100, POLICY);
    expect(probe.allowed).toBe(true);
    expect(probe.state).toBe('half-open');

    // A concurrent caller in the same window is blocked — no thundering herd.
    expect(admit(health, 1_150, POLICY).allowed).toBe(false);
  });

  it('closes the circuit and clears the streak after a success', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'rate_limited', 0, POLICY);
    expect(health.state).toBe('open');

    recordSuccess(health, 1_100);
    expect(health.state).toBe('closed');
    expect(health.consecutiveFailures).toBe(0);
    expect(health.cooldownUntil).toBeNull();
    expect(health.totalSuccesses).toBe(1);
    // A later single failure must not immediately re-open.
    recordFailure(health, 'transient', 2_000, POLICY);
    expect(health.state).toBe('closed');
  });

  it('re-opens when the half-open probe fails', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'transient', 0, POLICY);
    recordFailure(health, 'transient', 1, POLICY);
    recordFailure(health, 'transient', 2, POLICY);
    expect(admit(health, 1_100, POLICY).allowed).toBe(true);

    recordFailure(health, 'transient', 1_150, POLICY);
    expect(health.state).toBe('open');
    expect(admit(health, 1_200, POLICY).allowed).toBe(false);
  });

  it('tracks totals independently of the streak', () => {
    const health = newProviderHealth('groq');
    recordFailure(health, 'transient', 0, POLICY);
    recordSuccess(health, 1);
    recordFailure(health, 'transient', 2, POLICY);
    expect(health.totalFailures).toBe(2);
    expect(health.totalSuccesses).toBe(1);
    expect(health.consecutiveFailures).toBe(1);
  });
});

describe('failure classification', () => {
  it('classifies throttling responses as rate limited', () => {
    expect(classifyFailure(new Error('groq returned HTTP 429'))).toBe('rate_limited');
    expect(classifyFailure(new Error('openrouter returned HTTP 403'))).toBe('rate_limited');
  });

  it('classifies server and transport errors as transient', () => {
    expect(classifyFailure(new Error('groq returned HTTP 500'))).toBe('transient');
    expect(classifyFailure(new Error('groq returned HTTP 503'))).toBe('transient');
    expect(classifyFailure(new Error('fetch failed'))).toBe('transient');
    expect(classifyFailure(new Error('The operation was aborted due to timeout'))).toBe('transient');
    expect(classifyFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('transient');
  });

  it('classifies client errors as permanent', () => {
    expect(classifyFailure(new Error('mistral returned HTTP 400'))).toBe('permanent');
    expect(classifyFailure(new Error('groq returned HTTP 404'))).toBe('permanent');
  });

  it('treats an unknown error as transient rather than permanent', () => {
    // Unknown must not open the circuit permanently on first sight.
    expect(classifyFailure(new Error('something odd'))).toBe('transient');
    expect(classifyFailure('a string')).toBe('transient');
    expect(classifyFailure(undefined)).toBe('transient');
  });
});

describe('retry policy', () => {
  it('retries transient failures only, within the attempt budget', () => {
    expect(shouldRetry('transient', 1, POLICY)).toBe(true);
    expect(shouldRetry('transient', 2, POLICY)).toBe(false);
    expect(shouldRetry('rate_limited', 1, POLICY)).toBe(false);
    expect(shouldRetry('permanent', 1, POLICY)).toBe(false);
  });

  it('backs off exponentially and never exceeds the cap', () => {
    const noJitter = () => 1;
    expect(retryDelayMs(1, POLICY, noJitter)).toBe(250);
    expect(retryDelayMs(2, POLICY, noJitter)).toBe(500);
    expect(retryDelayMs(3, POLICY, noJitter)).toBe(1_000);
    expect(retryDelayMs(4, POLICY, noJitter)).toBe(2_000);
    // Capped even for absurd attempt numbers.
    expect(retryDelayMs(20, POLICY, noJitter)).toBe(POLICY.maxBackoffMs);
  });

  it('applies jitter so concurrent retries do not synchronize', () => {
    const low = retryDelayMs(3, POLICY, () => 0);
    const high = retryDelayMs(3, POLICY, () => 1);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(POLICY.baseBackoffMs);
    expect(high).toBeLessThanOrEqual(POLICY.maxBackoffMs);
  });
});

describe('health registry', () => {
  it('reports per-provider state without leaking secrets', () => {
    const registry = new ProviderHealthRegistry(POLICY);
    registry.failure('groq', 'rate_limited', 0);
    registry.success('mistral', 0);

    const report = registry.report(500);
    expect(report.map((entry) => entry.id)).toEqual(['groq', 'mistral']);

    const groq = report.find((entry) => entry.id === 'groq');
    expect(groq?.state).toBe('open');
    expect(groq?.lastErrorKind).toBe('rate_limited');
    expect(groq?.cooldownRemainingMs).toBe(500);
    expect(JSON.stringify(report)).not.toMatch(/key|secret|token|bearer/i);
  });

  it('isolates providers from each other', () => {
    const registry = new ProviderHealthRegistry(POLICY);
    registry.failure('groq', 'rate_limited', 0);
    expect(registry.admit('groq', 100).allowed).toBe(false);
    // A failing provider must not block a healthy one.
    expect(registry.admit('mistral', 100).allowed).toBe(true);
  });

  it('cooldown remaining never goes negative', () => {
    const registry = new ProviderHealthRegistry(POLICY);
    registry.failure('groq', 'rate_limited', 0);
    const entry = registry.report(99_999)[0];
    expect(entry?.cooldownRemainingMs).toBe(0);
  });

  it('creates health lazily and resets on demand', () => {
    const registry = new ProviderHealthRegistry(POLICY);
    expect(registry.report()).toHaveLength(0);
    registry.failure('groq', 'transient', 0);
    expect(registry.report()).toHaveLength(1);
    registry.reset('groq');
    expect(registry.report()).toHaveLength(0);
  });
});

describe('abortable delay', () => {
  it('resolves after the delay', async () => {
    await expect(delay(1)).resolves.toBeUndefined();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(delay(1_000, controller.signal)).rejects.toThrow('cancelled');
  });

  it('rejects when aborted mid-wait, so a retry cannot outlive the request', async () => {
    const controller = new AbortController();
    const pending = delay(5_000, controller.signal);
    setTimeout(() => controller.abort(new Error('timed out')), 5);
    await expect(pending).rejects.toThrow('timed out');
  });
});

describe('daily request budget', () => {
  it('counts usage and reports remaining headroom', () => {
    const budget = new DailyRequestBudget(100, () => 0);
    expect(budget.usage()).toBe(0);
    expect(budget.remaining()).toBe(100);

    budget.record(10);
    expect(budget.usage()).toBe(10);
    expect(budget.remaining()).toBe(90);
  });

  it('never reports negative remaining headroom', () => {
    const budget = new DailyRequestBudget(5, () => 0);
    budget.record(50);
    expect(budget.remaining()).toBe(0);
  });

  it('feeds the shared capacity bands so AI sheds like other workloads', () => {
    const budget = new DailyRequestBudget(100, () => 0);
    budget.record(50);
    expect(budget.snapshot('cyrene', 'groq').band).toBe('normal');

    budget.record(25); // 75%
    expect(budget.snapshot('cyrene', 'groq').band).toBe('cache-batch');

    budget.record(10); // 85%
    expect(budget.snapshot('cyrene', 'groq').band).toBe('aggressive-optimization');

    budget.record(8); // 93%
    expect(budget.snapshot('cyrene', 'groq').band).toBe('shed-noncritical');

    budget.record(5); // 98%
    expect(budget.snapshot('cyrene', 'groq').band).toBe('emergency-protection');
  });

  it('rolls over at the 24h boundary', () => {
    let now = 0;
    const budget = new DailyRequestBudget(100, () => now);
    budget.record(90);
    expect(budget.usage()).toBe(90);

    now = 86_400_001;
    expect(budget.usage()).toBe(0);
    expect(budget.remaining()).toBe(100);
  });

  it('exposes a reset timestamp for diagnostics', () => {
    const budget = new DailyRequestBudget(10, () => 0);
    expect(budget.resetAt()).toBe(86_400_000);
  });

  it('sheds AI work through the shared priority policy', () => {
    const budget = new DailyRequestBudget(100, () => 0);
    budget.record(30);
    expect(budget.decide('cyrene', 'groq').allowed).toBe(true);

    budget.record(50); // 80% — optional work is deferred, core retained
    expect(budget.decide('cyrene', 'groq').allowed).toBe(false);
    expect(budget.decide('cyrene', 'groq', 'core').allowed).toBe(true);

    budget.record(16); // 96% — even core is blocked at emergency protection
    expect(budget.decide('cyrene', 'groq', 'core').allowed).toBe(false);
    expect(budget.decide('cyrene', 'groq', 'security').allowed).toBe(true);
  });

  it('fails closed on an invalid (zero) quota', () => {
    const budget = new DailyRequestBudget(0, () => 0);
    expect(budget.decide('cyrene', 'groq').allowed).toBe(false);
  });
});