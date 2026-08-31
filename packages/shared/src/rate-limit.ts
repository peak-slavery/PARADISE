import type { Kv } from './redis.js';

export interface RateLimitPolicy {
  limit: number;
  windowSec: number;
}

/** Default per-user, per-command budget. Owners bypass entirely. */
export const DEFAULT_POLICY: RateLimitPolicy = { limit: 5, windowSec: 10 };

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window limiter backed by Redis (or the in-process fallback).
 * Priority order per the load plan: antinuke > rate-limiting > xp > caches.
 */
export async function enforceRateLimit(
  kv: Kv,
  key: string,
  policy: RateLimitPolicy = DEFAULT_POLICY,
  bypass = false,
): Promise<RateLimitVerdict> {
  if (bypass) return { allowed: true, remaining: policy.limit, retryAfterSec: 0 };

  try {
    const res = await kv.allow(key, policy.limit, policy.windowSec);
    return {
      allowed: res.allowed,
      remaining: res.remaining,
      retryAfterSec: res.allowed ? 0 : res.resetSec,
    };
  } catch {
    // A failed distributed limiter must not become an abuse bypass.
    return { allowed: false, remaining: 0, retryAfterSec: policy.windowSec };
  }
}
