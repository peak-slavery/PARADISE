import { Redis } from '@upstash/redis';
import type { Env } from './env.js';

/**
 * Minimal key/value + counter surface used by every bot.
 *
 * Two implementations:
 *  - UpstashKv   : real Upstash REST client (production)
 *  - MemoryKv    : per-process fallback so a missing Redis config degrades
 *                  gracefully instead of crashing the bot
 *
 * Callers never null-check. Every method is budget-aware: we count commands
 * issued and emit a warning at 80% of the free-tier daily allowance.
 */
export interface Kv {
  /** Increment a counter, creating it with `ttlSec` if absent. Returns new value. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Sliding-window count used by antinuke. Returns count within `windowSec`. */
  slidingCount(key: string, windowSec: number, member?: string): Promise<number>;
  /** Read the current value of a counter without mutating it. */
  count(key: string): Promise<number>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Publish a bounded message to a Redis pub/sub channel. */
  publish(channel: string, message: string): Promise<number>;
  /** Fixed-window allowance: returns { allowed, remaining, resetSec }. */
  allow(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }>;
  ping(): Promise<boolean>;
  /** Approximate commands issued since process start (quota guardrail). */
  commandsUsed(): number;
  /** True once usage crosses 80% of the daily budget. */
  nearBudget(): boolean;
}

const DAY_MS = 86_400_000;

abstract class BaseKv implements Kv {
  protected commands = 0;
  private readonly budget: number;
  private windowStart = Date.now();
  private warned = false;

  constructor(budget: number) {
    this.budget = budget;
  }

  protected track(n: number): void {
    // Free-tier Upstash resets daily; roll our own accounting window too.
    if (Date.now() - this.windowStart > DAY_MS) {
      this.windowStart = Date.now();
      this.commands = 0;
      this.warned = false;
    }
    this.commands += n;
  }

  commandsUsed(): number {
    return this.commands;
  }

  nearBudget(): boolean {
    const near = this.commands >= this.budget * 0.8;
    if (near && !this.warned) {
      this.warned = true;
      console.error(`[kv] ${Math.round((this.commands / this.budget) * 100)}% of Redis command budget used`);
    }
    return near;
  }

  abstract incr(key: string, ttlSec: number): Promise<number>;
  abstract slidingCount(key: string, windowSec: number, member?: string): Promise<number>;
  abstract count(key: string): Promise<number>;
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract publish(channel: string, message: string): Promise<number>;
  abstract ping(): Promise<boolean>;

  async allow(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }> {
    const used = await this.incr(key, windowSec);
    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      resetSec: windowSec,
    };
  }
}

class UpstashKv extends BaseKv {
  constructor(private readonly r: Redis, budget: number) {
    super(budget);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    this.track(2);
    const res = await this.r.pipeline().incr(key).expire(key, ttlSec).exec();
    return Number(Array.isArray(res) ? res[0] : 0);
  }

  async slidingCount(key: string, windowSec: number, member?: string): Promise<number> {
    const now = Date.now();
    const minScore = now - windowSec * 1000;
    const m = member ?? `${now}-${Math.random().toString(36).slice(2, 10)}`;
    this.track(4);
    const res = await this.r
      .pipeline()
      .zremrangebyscore(key, 0, minScore)
      .zadd(key, { score: now, member: m })
      .zcard(key)
      .pexpire(key, windowSec * 1000)
      .exec();
    return Number(Array.isArray(res) ? res[2] : 0);
  }

  async count(key: string): Promise<number> {
    this.track(1);
    return Number((await this.r.zcard(key)) ?? 0);
  }

  async get<T>(key: string): Promise<T | null> {
    this.track(1);
    return (await this.r.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    this.track(1);
    await this.r.set(key, value, { ex: ttlSec });
  }

  async del(key: string): Promise<void> {
    this.track(1);
    await this.r.del(key);
  }

  async publish(channel: string, message: string): Promise<number> {
    this.track(1);
    return Number(await this.r.publish(channel, message));
  }

  async ping(): Promise<boolean> {
    try {
      await this.r.ping();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Non-distributed fallback. Counters are per-process, so on a multi-instance
 * deployment limits would be looser — acceptable, because a bot with no Redis
 * configured is already a degraded-mode deployment.
 */
class MemoryKv extends BaseKv {
  private readonly counters = new Map<string, number>();
  private readonly values = new Map<string, unknown>();
  private readonly windows = new Map<string, number[]>();
  private readonly expireAt = new Map<string, number>();

  private sweep(key: string): void {
    const exp = this.expireAt.get(key);
    if (exp !== undefined && Date.now() > exp) {
      this.counters.delete(key);
      this.values.delete(key);
      this.windows.delete(key);
      this.expireAt.delete(key);
    }
  }

  private ttl(key: string, ttlSec: number): void {
    if (ttlSec > 0) this.expireAt.set(key, Date.now() + ttlSec * 1000);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    this.track(2);
    this.sweep(key);
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    this.ttl(key, ttlSec);
    return next;
  }

  async slidingCount(key: string, windowSec: number, member?: string): Promise<number> {
    this.track(4);
    this.sweep(key);
    const now = Date.now();
    const list = (this.windows.get(key) ?? []).filter((t) => t >= now - windowSec * 1000);
    list.push(now);
    void member;
    this.windows.set(key, list);
    this.ttl(key, windowSec);
    return list.length;
  }

  async count(key: string): Promise<number> {
    this.track(1);
    this.sweep(key);
    return this.windows.get(key)?.length ?? this.counters.get(key) ?? 0;
  }

  async get<T>(key: string): Promise<T | null> {
    this.track(1);
    this.sweep(key);
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    this.track(1);
    this.values.set(key, value);
    this.ttl(key, ttlSec);
  }

  async del(key: string): Promise<void> {
    this.track(1);
    this.counters.delete(key);
    this.values.delete(key);
    this.windows.delete(key);
    this.expireAt.delete(key);
  }

  async publish(channel: string, message: string): Promise<number> {
    this.track(1);
    // Memory mode has no subscribers; retain the latest envelope briefly so
    // local diagnostics can still inspect that publication occurred.
    await this.set(`pubsub:last:${channel}`, message, 60);
    return 0;
  }

  async ping(): Promise<boolean> {
    return false;
  }
}

export function createKv(env: Env): Kv {
  if (env.hasRedis && env.upstashUrl && env.upstashToken) {
    return new UpstashKv(
      new Redis({ url: env.upstashUrl, token: env.upstashToken, automaticDeserialization: true }),
      env.redisDailyCommandBudget,
    );
  }
  return new MemoryKv(env.redisDailyCommandBudget);
}

/* ------------------------------------------------------------------ */
/* Key naming — centralised so bots never collide in the same Redis    */
/* ------------------------------------------------------------------ */

export const keys = {
  rateLimit: (botId: string, guildId: string, userId: string, command: string) =>
    `rl:${botId}:${guildId}:${userId}:${command}`,
  antinuke: (guildId: string, userId: string, action: string) => `an:${guildId}:${userId}:${action}`,
  antinukeGlobal: (guildId: string, userId: string) => `an:${guildId}:${userId}:*`,
  /** Cached whitelist read — audit-log events fire per action, so this is a hot path. */
  whitelist: (guildId: string) => `an:wl:${guildId}`,
  /** Caps repeat punishments so a missing permission cannot turn into a loop. */
  punishLock: (guildId: string, userId: string) => `an:punish:${guildId}:${userId}`,
  xpDebounce: (guildId: string, userId: string) => `xp:${guildId}:${userId}`,
  aiCooldown: (guildId: string, userId: string) => `ai:cd:${guildId}:${userId}`,
  searchCache: (query: string) => `search:${query.toLowerCase().slice(0, 200)}`,
  aiCache: (scope: string, hash: string) => `ai:${scope}:${hash}`,
  searchCooldown: (userId: string) => `search:cd:${userId}`,
  interlink: (channel: string) => `bot:interlink:${channel}`,
  heartbeat: (botId: string) => `bot:heartbeat:${botId}`,
  status: (botId: string) => `bot:status:${botId}`,
} as const;
