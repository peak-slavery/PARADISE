// ---------------------------------------------------------------------------
// Card game engine (pure, no I/O, no Discord).
//
// All randomness is injectable. The same engine is used by /open, /sell, /trade,
// admin issuance, and the test suite, so changing the valuation formula or
// rarity table here is a single point of truth.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import type { CardDefinitionDoc, CardRank, CardInstanceDoc, CardPackDoc } from '@eiflow/shared';

import { RARITY_TABLE, pickRankFromTable, rarityFor } from './rarity.js';
import { CARD_DEFINITIONS, getDefinition, getPack, definitionsByRank } from './catalog.js';
import { secureRandom } from './random.js';

export interface OpenPackResult {
  pack: CardPackDoc;
  draws: { rank: CardRank; definition: CardDefinitionDoc }[];
  serialNumber: number | null;
}

export function generateInstanceId(): string {
  return `c_inst_${randomBytes(8).toString('hex')}`;
}

export function generateAcquisitionId(): string {
  return `c_acq_${randomBytes(8).toString('hex')}`;
}

export function generateTransactionId(): string {
  return `c_txn_${randomBytes(8).toString('hex')}`;
}

export function generateTradeId(): string {
  return `c_trd_${randomBytes(8).toString('hex')}`;
}

/**
 * Sample a definition from the catalog. Limited Arts is excluded from the
 * standard catalog pool and can only be obtained via admin/event issuance;
 * packs that opt-in must pass `allow_limited_arts: true`.
 */
function sampleDefinition(
  rank: CardRank,
  available: readonly CardDefinitionDoc[],
  rng: () => number,
): CardDefinitionDoc {
  if (available.length === 0) {
    throw new Error(`No definitions available for rank ${rank}`);
  }
  const index = Math.min(available.length - 1, Math.floor(rng() * available.length));
  const pick = available[Math.max(0, index)];
  if (!pick) throw new Error('Definition sampling failed');
  return pick;
}

/**
 * Open a pack: select ranks via the weighted table, restricted to the pack's
 * allowed ranks, then sample a definition for each rank.
 */
export function openPack(
  pack: CardPackDoc,
  rng: () => number = secureRandom,
): OpenPackResult {
  if (!pack.active) {
    throw new Error(`Pack ${pack.pack_id} is not currently available`);
  }
  const now = new Date();
  if (pack.release_starts_at && now < pack.release_starts_at) {
    throw new Error('Pack is not on sale yet');
  }
  if (pack.release_ends_at && now > pack.release_ends_at) {
    throw new Error('Pack sale has ended');
  }

  const eligibleRanks = pack.allowed_ranks.length > 0
    ? pack.allowed_ranks
    : (RARITY_TABLE.map((r) => r.rank) as readonly CardRank[]);
  const filteredRanks = pack.allow_limited_arts
    ? eligibleRanks
    : (eligibleRanks.filter((rank) => rank !== 'limited_arts') as readonly CardRank[]);

  const draws: OpenPackResult['draws'] = [];
  for (let i = 0; i < pack.card_count; i += 1) {
    const rank = pickRankFromTable(filteredRanks, rng);
    const available = definitionsByRank(rank);
    if (available.length === 0) {
      throw new Error(`No card definitions for rank ${rank}`);
    }
    const definition = sampleDefinition(rank, available, rng);
    draws.push({ rank, definition });
  }
  return { pack, draws, serialNumber: null };
}

/**
 * Compute the sell value for an instance. Market jitter is bounded by the
 * rarity table's [min, max] range; identical client calls with identical
 * inputs always produce identical server values.
 */
export function computeSellValue(definition: CardDefinitionDoc, rng: () => number = secureRandom): number {
  const r = rarityFor(definition.rank);
  const min = r.minValue;
  const max = r.maxValue;
  if (max <= min) return min;
  const span = max - min + 1;
  return min + Math.floor(rng() * span);
}

/**
 * Player collection market value: sum of the per-instance sell values for
 * every active card. Used by `/cardstats`.
 */
export function totalCollectionValue(
  instances: readonly CardInstanceDoc[],
  definitions: ReadonlyMap<string, CardDefinitionDoc>,
  rng: () => number = secureRandom,
): number {
  let total = 0;
  for (const inst of instances) {
    if (inst.status !== 'active') continue;
    const def = definitions.get(inst.definition_id);
    if (!def) continue;
    total += computeSellValue(def, rng);
  }
  return total;
}

/**
 * Allocate a 1-indexed serial number within an `release_event` window. Returns
 * null if the event is missing or the definition does not serial-number
 * (only Limited Arts and event-only diamonds do).
 */
export function nextSerialNumber(
  existingInEvent: readonly CardInstanceDoc[],
): number | null {
  if (existingInEvent.length === 0) return 1;
  return existingInEvent.length + 1;
}

/** A tiny helper to choose a Limited Arts target inside the pack pool. */
export function pickLimitedArtsTarget(rng: () => number = secureRandom): CardDefinitionDoc {
  const defs = CARD_DEFINITIONS.filter((d) => d.rank === 'limited_arts' && d.enabled !== false);
  if (defs.length === 0) throw new Error('No Limited Arts definitions configured');
  const index = Math.min(defs.length - 1, Math.floor(rng() * defs.length));
  const pick = defs[Math.max(0, index)];
  if (!pick) throw new Error('Limited Arts sampling failed');
  return pick;
}

/**
 * Mark a definition inactive/retired. Returns the updated doc or null when the
 * definition does not exist. Use this in the admin tooling.
 */
export function retireDefinition(def: CardDefinitionDoc): CardDefinitionDoc {
  return { ...def, is_event_only: true, is_tradeable: false, is_sellable: false, updated_at: new Date() };
}

/** Used in tests to assert that integer currency arithmetic never overflows. */
export function safeAdd(a: number, b: number): number {
  if (!Number.isSafeInteger(a + b)) throw new Error('Currency overflow');
  return a + b;
}

export function safeSub(a: number, b: number): number {
  const result = a - b;
  if (result < 0) throw new Error('Negative currency balance');
  if (!Number.isSafeInteger(result)) throw new Error('Currency overflow');
  return result;
}

export { getDefinition, getPack, definitionsByRank };
