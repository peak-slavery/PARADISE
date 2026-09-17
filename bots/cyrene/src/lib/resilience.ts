// ---------------------------------------------------------------------------
// AI provider resilience.
//
// The router previously made exactly ONE attempt per provider: a single
// transient 500 advanced to the next provider, and a provider that was
// persistently broken was retried in full on every request. This module adds
// the operational capabilities the routing contract requires — bounded retries
// with backoff, a circuit breaker, provider cooldown, and health tracking —
// as pure state transitions so they are testable without network or real
// delays.
//
// Security note: this module only ever sees an error *classification*. Upstream
// response bodies are never retained here (they can echo prompts, request
// metadata, or credentials), matching the existing router policy.
// ---------------------------------------------------------------------------

import {
  capacitySnapshot,
  decideCapacity,
  type CapacityDecision,
  type CapacitySnapshot,
  type WorkloadPriority,
} from '@eiflow/shared';

export type CircuitState = 'closed' | 'open' | 'half-open';

/** How an upstream failure should be treated by the breaker and retry loop. */
export type FailureKind =
  /** 429/403 — provider is throttling us. Park it immediately; do not retry. */
  | 'rate_limited'
  /** 5xx, network, timeout — worth a bounded retry, then advance. */
  | 'transient'
  /** 4xx (bad model, auth) — retrying is pointless; open the circuit quickly. */
  | 'permanent';

export interface ProviderHealth {
  id: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  /** When the circuit last opened; null while closed. */
  openedAt: number | null;
  /** Absolute epoch ms before which no request may be made. */
  cooldownUntil: number | null;
  lastErrorAt: number | null;
  lastErrorKind: FailureKind | null;
  lastSuccessAt: number | null;
}

export interface ResiliencePolicy {
  /** Consecutive failures that trip the breaker closed → open. */
  failureThreshold: number;
  /** How long the circuit stays open before a half-open probe is allowed. */
  cooldownMs: number;
  /** Attempts per provider per request (1 = no retry). */
  maxAttempts: number;
  /** Exponential backoff base for transient retries. */
  baseBackoffMs: number;
  /** Backoff ceiling so a retry never outlives the request timeout. */
  maxBackoffMs: number;
}

/** Bounded by default: retries are cheap but must not outlive REQUEST_TIMEOUT_MS. */
export const DEFAULT_RESILIENCE_POLICY: ResiliencePolicy = Object.freeze({
  failureThreshold: 3,
  cooldownMs: 60_000,
  maxAttempts: 2,
  baseBackoffMs: 250,
  maxBackoffMs: 2_000,
});

export function newProviderHealth(id: string): ProviderHealth {
  return {
    id,
    state: 'closed',
    consecutiveFailures: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    openedAt: null,
    cooldownUntil: null,
    lastErrorAt: null,
    lastErrorKind: null,
    lastSuccessAt: null,
  };
}

export interface AdmissionDecision {
  allowed: boolean;
  state: CircuitState;
  reason: string;
}

/**
 * Whether a provider may be attempted right now.
 *
 * An open circuit whose cooldown has elapsed transitions to half-open, which
 * admits a single probe so a recovered provider is discovered without a
 * thundering herd. Admitting that probe re-arms the cooldown, so concurrent
 * callers cannot all probe at once: exactly one request gets through per
 * cooldown window until a success closes the circuit or a failure re-opens it.
 */
export function admit(health: ProviderHealth, now: number, policy = DEFAULT_RESILIENCE_POLICY): AdmissionDecision {
  if (health.cooldownUntil !== null && now < health.cooldownUntil) {
    return {
      allowed: false,
      state: health.state,
      reason: health.state === 'open' ? 'circuit open; cooldown active' : 'half-open probe window active',
    };
  }

  if (health.state === 'open') {
    // Cooldown elapsed — admit one probe and re-arm the window.
    health.state = 'half-open';
    health.cooldownUntil = now + policy.cooldownMs;
    return { allowed: true, state: health.state, reason: 'cooldown elapsed; probing provider' };
  }

  if (health.state === 'half-open') {
    // Probe window elapsed without a verdict; allow the next single probe.
    health.cooldownUntil = now + policy.cooldownMs;
    return { allowed: true, state: health.state, reason: 'probing provider (half-open)' };
  }

  return { allowed: true, state: health.state, reason: 'circuit closed' };
}

/** A success closes the circuit and clears the failure streak. */
export function recordSuccess(health: ProviderHealth, now: number): void {
  health.state = 'closed';
  health.consecutiveFailures = 0;
  health.totalSuccesses += 1;
  health.openedAt = null;
  health.cooldownUntil = null;
  health.lastSuccessAt = now;
}

/**
 * A failure updates health and may open the circuit.
 *
 * Rate limiting parks the provider immediately regardless of the threshold: the
 * provider has told us to stop, so continuing to hammer it wastes the request
 * budget and can escalate the throttle. A permanent failure (bad model id,
 * auth) is treated the same way for the same reason.
 */
export function recordFailure(
  health: ProviderHealth,
  kind: FailureKind,
  now: number,
  policy = DEFAULT_RESILIENCE_POLICY,
): void {
  health.consecutiveFailures += 1;
  health.totalFailures += 1;
  health.lastErrorAt = now;
  health.lastErrorKind = kind;

  const shouldOpen = kind === 'rate_limited'
    || kind === 'permanent'
    || health.consecutiveFailures >= policy.failureThreshold;

  if (shouldOpen) {
    health.state = 'open';
    health.openedAt = now;
    health.cooldownUntil = now + policy.cooldownMs;
  }
}

/**
 * Maps a thrown error to a failure kind using only the status code the router
 * already extracts, plus abort/timeout detection. Never inspects the body.
 */
export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof Error) {
    const status = /HTTP (\d{3})/.exec(error.message)?.[1];
    if (status) {
      const code = Number(status);
      if (code === 429 || code === 403) return 'rate_limited';
      if (code >= 500) return 'transient';
      if (code >= 400) return 'permanent';
    }
    if (/abort|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(error.message)) {
      return 'transient';
    }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'transient';
  }
  // Unknown failures are treated as transient: one bounded retry is cheap and
  // the breaker still opens if the provider keeps failing.
  return 'transient';
}

/** True when a failed attempt is worth retrying against the same provider. */
export function shouldRetry(kind: FailureKind, attempt: number, policy = DEFAULT_RESILIENCE_POLICY): boolean {
  return kind === 'transient' && attempt < policy.maxAttempts;
}

/**
 * Exponential backoff for retries, capped so a retry sequence cannot outlive
 * the request timeout. `random` is injectable to keep tests deterministic;
 * full jitter avoids synchronized retries across concurrent requests.
 */
export function retryDelayMs(
  attempt: number,
  policy = DEFAULT_RESILIENCE_POLICY,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(policy.maxBackoffMs, exponential);
  return Math.round(capped * (0.5 + random() * 0.5));
}

export interface ProviderHealthReport {
  id: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  cooldownRemainingMs: number;
  lastErrorKind: FailureKind | null;
}

/**
 * Tracks health for every provider id seen. Deliberately in-process: a single
 * bot instance owns its own upstream keys, so there is no cross-instance state
 * worth the Redis round-trip, and Redis may be unavailable (bounded fallback).
 */
export class ProviderHealthRegistry {
  private readonly providers = new Map<string, ProviderHealth>();

  constructor(private readonly policy: ResiliencePolicy = DEFAULT_RESILIENCE_POLICY) {}

  get(id: string): ProviderHealth {
    const existing = this.providers.get(id);
    if (existing) return existing;
    const created = newProviderHealth(id);
    this.providers.set(id, created);
    return created;
  }

  admit(id: string, now: number = Date.now()): AdmissionDecision {
    return admit(this.get(id), now, this.policy);
  }

  success(id: string, now: number = Date.now()): void {
    recordSuccess(this.get(id), now);
  }

  failure(id: string, kind: FailureKind, now: number = Date.now()): void {
    recordFailure(this.get(id), kind, now, this.policy);
  }

  /** Diagnostic snapshot for /model and health reporting. No secrets. */
  report(now: number = Date.now()): ProviderHealthReport[] {
    return [...this.providers.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((health) => ({
        id: health.id,
        state: health.state,
        consecutiveFailures: health.consecutiveFailures,
        totalSuccesses: health.totalSuccesses,
        totalFailures: health.totalFailures,
        cooldownRemainingMs: health.cooldownUntil === null ? 0 : Math.max(0, health.cooldownUntil - now),
        lastErrorKind: health.lastErrorKind,
      }));
  }

  /** Test/reset helper — also used when config changes invalidate health. */
  reset(id?: string): void {
    if (id === undefined) this.providers.clear();
    else this.providers.delete(id);
  }
}

/** Sleep that respects the caller's abort signal so a retry cannot outlive a request. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* -------------------------------------------------------------------------- */
/* Daily request budget                                                       */
/* -------------------------------------------------------------------------- */

/**
 * In-process daily request counter for paid AI providers.
 *
 * This exists because provider quota is the one capacity dimension the bot can
 * actually measure without a vendor billing API: we know how many requests we
 * issued. It feeds the shared capacity policy (`capacityBand`/`decideCapacity`)
 * so AI work sheds at the same thresholds as every other workload, rather than
 * inventing its own notion of "near quota".
 *
 * Deliberately local rather than Redis-backed: Redis may be unavailable
 * (bounded fallback) and each instance owns its own provider keys, so a shared
 * counter would over-count across instances anyway.
 */
export class DailyRequestBudget {
  private windowStart: number;
  private used = 0;

  constructor(
    private readonly quota: number,
    private readonly now: () => number = Date.now,
  ) {
    this.windowStart = this.now();
  }

  /** Rolls the window over at the 24h boundary, matching Upstash's daily reset. */
  private roll(): void {
    if (this.now() - this.windowStart >= 86_400_000) {
      this.windowStart = this.now();
      this.used = 0;
    }
  }

  record(count = 1): void {
    this.roll();
    this.used += count;
  }

  usage(): number {
    this.roll();
    return this.used;
  }

  /** Remaining requests, floored at zero. */
  remaining(): number {
    return Math.max(0, this.quota - this.usage());
  }

  /** Reset epoch ms for diagnostics. */
  resetAt(): number {
    this.roll();
    return this.windowStart + 86_400_000;
  }

  snapshot(service: string, provider: string): CapacitySnapshot {
    return capacitySnapshot({
      service,
      provider,
      resource: 'ai-requests',
      quota: this.quota,
      usage: this.usage(),
      healthy: true,
      cooldownUntil: null,
      resetAt: this.resetAt(),
    });
  }

  /**
   * Admission decision for AI work. The shared capacity policy decides which
   * priority passes at the current band; AI requests are treated as optional
   * work, so they shed at 80% and stop at 95%+ like every other non-critical
   * workload. `decideCapacity` fails closed on invalid quota.
   */
  decide(service: string, provider: string, priority: WorkloadPriority = 'optional'): CapacityDecision {
    return decideCapacity(this.snapshot(service, provider), priority);
  }
}