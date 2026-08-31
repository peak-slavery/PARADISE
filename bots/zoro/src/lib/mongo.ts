import type { BotServices, Logger } from '@eiflow/shared';
import type { ZoroCollections } from './model.js';

/**
 * Resolves Zoro's own Mongo collections.
 *
 * Three rules govern this file:
 *   1. Never throw. Mongo being down is a normal degraded state, and a security
 *      bot that crashes because its analytics store is unreachable is worse
 *      than one that keeps protecting the guild without history.
 *   2. Cache only successes, so a later reconnect is picked up automatically.
 *   3. Collapse concurrent callers onto one in-flight promise so a burst of
 *      events does not trigger a burst of connection work.
 */

let cached: ZoroCollections | null = null;
let inflight: Promise<ZoroCollections | null> | null = null;

async function resolve(services: BotServices, log: Logger): Promise<ZoroCollections | null> {
  try {
    const base = await services.mongo();
    if (!base) return null;

    const db = base.logs.db;
    const cols: ZoroCollections = {
      member_trust: db.collection('member_trust'),
      guild_snapshots: db.collection('guild_snapshots'),
    };

    await Promise.all([
      cols.member_trust.createIndex({ guild_id: 1, user_id: 1 }, { unique: true }),
      cols.member_trust.createIndex({ guild_id: 1, score: 1 }),
      cols.guild_snapshots.createIndex({ guild_id: 1, created_at: -1 }),
    ]);

    return cols;
  } catch (err) {
    log.error({ err }, 'zoro: failed to resolve mongo collections — degraded mode');
    return null;
  }
}

/** Returns null when Mongo is unavailable. Callers must degrade, not crash. */
export async function zoroCollections(services: BotServices, log: Logger): Promise<ZoroCollections | null> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = resolve(services, log)
    .then((cols) => {
      if (cols) cached = cols;
      return cols;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
