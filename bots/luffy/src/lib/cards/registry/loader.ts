// ---------------------------------------------------------------------------
// Card registry loader.
//
// Converts a scanned registry into the runtime data structures the rest of
// Luffy already consumes (`CARD_DEFINITIONS`, `CARD_PACKS`, `getDefinition`,
// `getPack`, `definitionsByRank`, `assertPublishedProbabilities`).
//
// The shape of `CardDefinitionDoc` is unchanged so commands, engine, store,
// rendering, and tests stay source-compatible. Limited Arts is excluded
// from the standard catalog pool and can only be obtained via admin/event
// issuance — packs that opt-in pass `allow_limited_arts: true`.
// ---------------------------------------------------------------------------

import type { CardDefinitionDoc, CardPackDoc, CardRank } from '@eiflow/shared';

import { RARITY_TABLE, rarityFor } from '../rarity.js';
import type { ManifestDocument, ScannedCard } from './scanner.js';

const CATEGORY_DEFAULT: CardDefinitionDoc['category'] = 'event';

export interface LoadedRegistry {
  definitions: readonly CardDefinitionDoc[];
  packs: readonly CardPackDoc[];
}

/**
 * Resolve the runtime category from the scanned metadata. The filesystem
 * metadata is optional, so we fall back to `event` for Limited Arts and a
 * rarity-best-guess for other ranks.
 */
function inferCategory(card: ScannedCard): CardDefinitionDoc['category'] {
  if (card.category) return card.category;
  switch (card.rank) {
    case 'limited_arts':
      return 'event';
    case 'common':
    case 'rare':
      return 'captain';
    case 'elite':
    case 'gold':
      return 'pirate';
    case 'ex':
    case 'exx':
      return 'legend';
    case 's':
    case 'ss':
      return 'marine';
    case 'sss_plus':
      return 'yonko';
    case 'diamond':
      return 'legend';
    default:
      return CATEGORY_DEFAULT;
  }
}

function toDefinitionDoc(card: ScannedCard, now: Date): CardDefinitionDoc {
  const r = rarityFor(card.rank);
  return {
    definition_id: card.definition_id,
    character: card.character ?? card.title ?? card.definition_id,
    title: card.title ?? card.character ?? '',
    series: card.series ?? '',
    category: inferCategory(card),
    rank: card.rank,
    // Artwork references remain filesystem paths/CDN handles; the actual
    // bytes stay in the repo (or wherever the deployment mounts them).
    artwork_url: card.artwork_ref,
    description: card.description,
    base_value: r.baseValue,
    min_value: r.minValue,
    max_value: r.maxValue,
    is_event_only: card.is_event_only,
    is_tradeable: card.is_tradeable,
    is_sellable: card.is_sellable,
    total_supply: card.total_supply,
    enabled: card.enabled,
    created_at: now,
    updated_at: now,
  };
}

const RANK_ORDER: readonly CardRank[] = [
  'common',
  'rare',
  'elite',
  'gold',
  'ex',
  'exx',
  's',
  'ss',
  'sss_plus',
  'diamond',
  'limited_arts',
];

function rankIndex(rank: CardRank): number {
  const i = RANK_ORDER.indexOf(rank);
  return i === -1 ? RANK_ORDER.length : i;
}

const COMMON_RANKS: readonly CardRank[] = RANK_ORDER.filter((r) => r === 'common' || r === 'rare');
const ELITE_RANKS: readonly CardRank[] = RANK_ORDER.filter((r) => ['common', 'rare', 'elite', 'gold', 'ex'].includes(r));
const PREMIUM_RANKS: readonly CardRank[] = RANK_ORDER.filter((r) => r !== 'limited_arts');
const EVENT_RANKS: readonly CardRank[] = RANK_ORDER.slice();
const LIMITED_RANKS: readonly CardRank[] = RANK_ORDER.filter((r) => ['diamond', 'sss_plus', 'limited_arts'].includes(r));

function defaultPacks(now: Date): readonly CardPackDoc[] {
  function pack(
    pack_id: string,
    display_name: string,
    description: string,
    price: number,
    card_count: number,
    allowed_ranks: readonly CardRank[],
    allow_limited_arts: boolean,
  ): CardPackDoc {
    return {
      pack_id,
      display_name,
      description,
      price,
      card_count,
      allowed_ranks,
      allow_limited_arts,
      active: true,
      release_starts_at: null,
      release_ends_at: null,
      artwork_url: null,
      created_at: now,
      updated_at: now,
    };
  }
  return Object.freeze([
    pack('standard', 'Standard Pack', 'A reasonable starting pack for any pirate.', 250, 3, COMMON_RANKS, false),
    pack('premium', 'Premium Pack', 'A larger pack with a wider rarity pool.', 1_000, 5, ELITE_RANKS, false),
    pack('legendary', 'Legendary Pack', 'For captains who have proven themselves.', 5_000, 5, PREMIUM_RANKS, false),
    pack('event.seasonal', 'Seasonal Event Pack', 'Limited event pack with full rarity pool.', 10_000, 5, EVENT_RANKS, true),
    pack('limited.premium', 'Premium Limited Pack', 'Admin-issued pack that can grant Limited Arts.', 0, 1, LIMITED_RANKS, true),
  ]);
}

/**
 * Build the runtime catalog from a manifest document. Definitions are
 * sorted by `(rank tier, definition_id)` so pack draws and Discord choice
 * lists are deterministic across builds.
 */
export function loadRegistry(manifest: ManifestDocument, now: Date = new Date(0)): LoadedRegistry {
  const definitions = manifest.cards
    .map((card) => toDefinitionDoc(card, now))
    .sort((a, b) => {
      const ri = rankIndex(a.rank) - rankIndex(b.rank);
      return ri !== 0 ? ri : a.definition_id.localeCompare(b.definition_id);
    });

  return {
    definitions: Object.freeze(definitions),
    packs: defaultPacks(now),
  };
}

/** Convenience: index helpers that operate on a loaded registry snapshot. */
export function buildIndexes(definitions: readonly CardDefinitionDoc[]) {
  const definitionIndex = new Map<string, CardDefinitionDoc>();
  const byRank = new Map<CardRank, CardDefinitionDoc[]>();
  for (const def of definitions) {
    definitionIndex.set(def.definition_id, def);
    const list = byRank.get(def.rank) ?? [];
    list.push(def);
    byRank.set(def.rank, list);
  }
  for (const list of byRank.values()) {
    list.sort((a, b) => a.definition_id.localeCompare(b.definition_id));
  }
  return { definitionIndex, byRank };
}

/**
 * Sanity check the rarity probability table is still exactly what the
 * published numbers promise. Limited Arts must remain 0.001%.
 */
export function assertPublishedProbabilities(): void {
  const totalWeight = RARITY_TABLE.reduce((acc, entry) => acc + entry.weight, 0);
  if (totalWeight !== 100_000_000) {
    throw new Error(`rarity weight sum drifted: ${totalWeight}`);
  }
  const limited = RARITY_TABLE.find((r) => r.rank === 'limited_arts');
  if (!limited || limited.weight !== 1_000) {
    throw new Error(`Limited Arts weight drifted: ${limited?.weight}`);
  }
}