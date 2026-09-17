// ---------------------------------------------------------------------------
// Card rarity / rank / pack configuration
//
// The drop table is centralised here so probabilities can be re-tuned or
// expanded without touching commands. The published 0.001% Limited Arts
// probability is fixed here as the authoritative target — every consumer
// (packs, admin issuance, sell valuation) reads from this table.
// ---------------------------------------------------------------------------

import type { CardRank } from '@eiflow/shared';

import { secureRandom } from './random.js';

export interface RarityEntry {
  rank: CardRank;
  /** Display label rendered in embeds. */
  displayName: string;
  /** Ordered 1..11 tier. */
  tier: number;
  /** Weighted draw bucket. Higher weight = more common. */
  weight: number;
  /** Base sell value in berries. */
  baseValue: number;
  /** Lower bound (inclusive) for random market jitter. */
  minValue: number;
  /** Upper bound (inclusive) for random market jitter. */
  maxValue: number;
  /** Ranks that cannot be obtained through the standard pack system. */
  eventOnly: boolean;
  /** Ranks that cannot be sent through player trades. */
  tradeable: boolean;
  /** Ranks that cannot be sold. */
  sellable: boolean;
  /** Hex colour used in card embeds. */
  color: number;
}

/**
 * Rarity table. Drop weights are intentionally highly skewed so the implied
 * per-card probability lands at the targets below. The total weight is
 * 100,000,000 which makes the Limited Arts weight (1,000) exactly 0.001%.
 */
export const RARITY_TABLE: readonly RarityEntry[] = Object.freeze([
  Object.freeze({
    rank: 'common',
    displayName: 'Common',
    tier: 1,
    weight: 60_000_000,
    baseValue: 25,
    minValue: 20,
    maxValue: 40,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x9aa1a8,
  }),
  Object.freeze({
    rank: 'rare',
    displayName: 'Rare',
    tier: 2,
    weight: 25_000_000,
    baseValue: 80,
    minValue: 60,
    maxValue: 120,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x3498db,
  }),
  Object.freeze({
    rank: 'elite',
    displayName: 'Elite',
    tier: 3,
    weight: 9_000_000,
    baseValue: 220,
    minValue: 180,
    maxValue: 320,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x8e44ad,
  }),
  Object.freeze({
    rank: 'gold',
    displayName: 'Gold',
    tier: 4,
    weight: 3_500_000,
    baseValue: 600,
    minValue: 480,
    maxValue: 800,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0xf1c40f,
  }),
  Object.freeze({
    rank: 'ex',
    displayName: 'EX',
    tier: 5,
    weight: 1_500_000,
    baseValue: 1_400,
    minValue: 1_100,
    maxValue: 1_900,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0xe67e22,
  }),
  Object.freeze({
    rank: 'exx',
    displayName: 'EXX',
    tier: 6,
    weight: 700_000,
    baseValue: 3_500,
    minValue: 2_800,
    maxValue: 4_500,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0xe74c3c,
  }),
  Object.freeze({
    rank: 's',
    displayName: 'S',
    tier: 7,
    weight: 200_000,
    baseValue: 8_000,
    minValue: 6_500,
    maxValue: 10_000,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0xc0392b,
  }),
  Object.freeze({
    rank: 'ss',
    displayName: 'SS',
    tier: 8,
    weight: 70_000,
    baseValue: 20_000,
    minValue: 16_000,
    maxValue: 26_000,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x2c3e50,
  }),
  Object.freeze({
    rank: 'sss_plus',
    displayName: 'SSS+',
    tier: 9,
    weight: 28_000,
    baseValue: 50_000,
    minValue: 40_000,
    maxValue: 65_000,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x111111,
  }),
  Object.freeze({
    rank: 'diamond',
    displayName: 'Diamond',
    tier: 10,
    weight: 1_000,
    baseValue: 150_000,
    minValue: 120_000,
    maxValue: 200_000,
    eventOnly: false,
    tradeable: true,
    sellable: true,
    color: 0x00bcd4,
  }),
  Object.freeze({
    rank: 'limited_arts',
    displayName: 'Limited Arts',
    tier: 11,
    weight: 1_000,
    baseValue: 1_000_000,
    minValue: 1_000_000,
    maxValue: 1_000_000,
    /** Limited Arts is event-only by definition: never offered in standard packs. */
    eventOnly: true,
    /** Even tradeable by spec, but the rank is opt-in. We keep it tradeable. */
    tradeable: true,
    sellable: true,
    color: 0xffd700,
  }),
]);

const RANK_INDEX: ReadonlyMap<CardRank, RarityEntry> = new Map(
  RARITY_TABLE.map((entry) => [entry.rank, entry]),
);

export function rarityFor(rank: CardRank): RarityEntry {
  const entry = RANK_INDEX.get(rank);
  if (!entry) throw new Error(`Unknown card rank: ${rank as string}`);
  return entry;
}

export function totalWeight(): number {
  return RARITY_TABLE.reduce((acc, entry) => acc + entry.weight, 0);
}

/**
 * Sample a single rank from the weighted table. The RNG is injectable so
 * tests can pin the result. Caller filters by allowed ranks *after* sampling
 * to keep the weighted pool unbiased.
 */
export function pickRankFromTable(
  ranks: readonly CardRank[],
  rng: () => number = secureRandom,
): CardRank {
  const filtered = ranks
    .map((rank) => ({ rank, weight: RANK_INDEX.get(rank)?.weight ?? 0 }))
    .filter((entry) => entry.weight > 0);
  if (filtered.length === 0) {
    throw new Error('pickRankFromTable: no eligible ranks');
  }
  const total = filtered.reduce((acc, entry) => acc + entry.weight, 0);
  const roll = rng() * total;
  let acc = 0;
  for (const entry of filtered) {
    acc += entry.weight;
    if (roll < acc) return entry.rank;
  }
  const last = filtered[filtered.length - 1];
  if (!last) throw new Error('pickRankFromTable: filtered pool is empty');
  return last.rank;
}

/**
 * Compute the implied probability (0..1) of a given rank within the full table.
 * Used to assert the 0.001% Limited Arts contract in tests.
 */
export function impliedProbability(rank: CardRank): number {
  const entry = rarityFor(rank);
  return entry.weight / totalWeight();
}
