/**
 * @eiflow/shared — the runtime every Ei Flow bot is built on.
 *
 * Layers, in dependency order:
 *   env        — zod-validated config, fails fast with a readable message
 *   logger     — structured JSON (pino), no console.log anywhere
 *   errors     — Sentry + typed failure classes + process crash nets
 *   redis      — Upstash KV with an in-process fallback (degrade, never crash)
 *   db         — Supabase (truth) + MongoDB (activity)
 *   log-sink   — batched writes, the main free-tier write lever
 *   embed      — every reply is an embed, never raw text
 *   server-lock— guild authorization gate
 *   commands   — lazy command loader (keeps RAM under 512MB)
 *   health     — UptimeRobot endpoint reporting real DB connectivity
 */

export * from './env.js';
export * from './logger.js';
export * from './errors.js';
export * from './redis.js';
export * from './db/supabase.js';
export * from './db/mongo.js';
export * from './log-sink.js';
export * from './embed.js';
export * from './sanitize.js';
export * from './server-lock.js';
export * from './commands.js';
export * from './rate-limit.js';
export * from './queue.js';
export * from './responses.js';
export * from './health.js';
export * from './hmac.js';
export * from './types.js';
export * from './authorization.js';
export * from './bot.js';
export * from './deploy.js';
