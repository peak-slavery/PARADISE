import type { BotServices, Logger, SecurityEventRow } from '@eiflow/shared';
import { zoroCollections } from './mongo.js';

/**
 * Per-member trust scoring.
 *
 * A single integer score in [0, 100] is derived from counters we keep in the
 * `member_trust` collection: every recorded incident lowers it; tenure and
 * role standing slowly raise it. We store counters (not the score) so the score
 * can be recomputed with time decay without rewriting history.
 *
 * Every function degrades: if Mongo is unavailable the score falls back to a
 * neutral baseline and never throws. Trust is an input to raid detection, not a
 * hard gate, so a missing value must never block enforcement.
 */

const BASE_SCORE = 50;
const WEIGHT = {
  clean: 0.03,
  low: 6,
  medium: 14,
  high: 30,
  critical: 50,
} as const;

export type TrustTier = 'trusted' | 'neutral' | 'watch' | 'hostile';

export interface TrustBreakdown {
  score: number;
  tier: TrustTier;
  cleanMessages: number;
  incidents: { low: number; medium: number; high: number; critical: number };
  joinedAt: Date | null;
  lastIncidentAt: Date | null;
  daysInGuild: number | null;
}

/** Best-effort credit for a clean, non-incident interaction. */
export async function creditClean(
  services: BotServices,
  log: Logger,
  guildId: string,
  userId: string,
): Promise<void> {
  const cols = await zoroCollections(services, log);
  if (!cols) return;
  try {
    await cols.member_trust.updateOne(
      { guild_id: guildId, user_id: userId },
      { $inc: { clean_messages: 1 }, $set: { updated_at: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    log.warn({ err, guildId, userId }, 'trust credit failed');
  }
}

/** Records one incident against a member and lowers their score. */
export async function recordIncident(
  services: BotServices,
  log: Logger,
  guildId: string,
  userId: string,
  severity: SecurityEventRow['severity'],
): Promise<void> {
  const cols = await zoroCollections(services, log);
  if (!cols) return;
  const field =
    severity === 'low'
      ? 'incidents_low'
      : severity === 'medium'
        ? 'incidents_medium'
        : severity === 'high'
          ? 'incidents_high'
          : 'incidents_critical';
  try {
    await cols.member_trust.updateOne(
      { guild_id: guildId, user_id: userId },
      { $inc: { [field]: 1 }, $set: { last_incident_at: new Date(), updated_at: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    log.warn({ err, guildId, userId }, 'trust incident write failed');
  }
}

function tierFor(score: number): TrustTier {
  if (score >= 70) return 'trusted';
  if (score >= 45) return 'neutral';
  if (score >= 20) return 'watch';
  return 'hostile';
}

/** Computes the live score for a member, or the neutral baseline. */
export async function computeTrust(
  services: BotServices,
  log: Logger,
  guildId: string,
  userId: string,
  joinedAt: Date | null = null,
): Promise<TrustBreakdown> {
  const cols = await zoroCollections(services, log);
  if (!cols) {
    return {
      score: BASE_SCORE,
      tier: 'neutral',
      cleanMessages: 0,
      incidents: { low: 0, medium: 0, high: 0, critical: 0 },
      joinedAt,
      lastIncidentAt: null,
      daysInGuild: null,
    };
  }

  try {
    const doc = await cols.member_trust.findOne({ guild_id: guildId, user_id: userId });
    const clean = doc?.clean_messages ?? 0;
    const inc = {
      low: doc?.incidents_low ?? 0,
      medium: doc?.incidents_medium ?? 0,
      high: doc?.incidents_high ?? 0,
      critical: doc?.incidents_critical ?? 0,
    };

    let score =
      BASE_SCORE +
      clean * WEIGHT.clean -
      (inc.low * WEIGHT.low +
        inc.medium * WEIGHT.medium +
        inc.high * WEIGHT.high +
        inc.critical * WEIGHT.critical);

    // Tenure bonus: long-standing members start from a position of trust.
    if (joinedAt) {
      const days = Math.floor((Date.now() - joinedAt.getTime()) / 86_400_000);
      score += Math.min(15, Math.floor(days / 60)); // +1 per ~2 months, cap +15
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      score,
      tier: tierFor(score),
      cleanMessages: clean,
      incidents: inc,
      joinedAt: doc?.joined_at ?? joinedAt,
      lastIncidentAt: doc?.last_incident_at ?? null,
      daysInGuild: joinedAt ? Math.floor((Date.now() - joinedAt.getTime()) / 86_400_000) : null,
    };
  } catch (err) {
    log.warn({ err, guildId, userId }, 'trust compute failed');
    return {
      score: BASE_SCORE,
      tier: 'neutral',
      cleanMessages: 0,
      incidents: { low: 0, medium: 0, high: 0, critical: 0 },
      joinedAt,
      lastIncidentAt: null,
      daysInGuild: null,
    };
  }
}

/**
 * Trust-aware threshold scaling: hostile actors trip at 60% of the configured
 * threshold, trusted actors at 130%. Returns the effective count needed to trip.
 */
export function scaledThreshold(base: number, tier: TrustTier): number {
  const factor = tier === 'hostile' ? 0.6 : tier === 'watch' ? 0.8 : tier === 'trusted' ? 1.3 : 1;
  return Math.max(2, Math.round(base * factor));
}
