import type { InventoryItem } from '@eiflow/shared';

/**
 * Pure card-game rules. No I/O, no Discord types, no randomness that cannot be
 * injected — every function here is deterministic given its arguments, so the
 * rules can be unit-tested without a bot, a database or a gateway.
 *
 * Cards are 2-character strings: rank (`23456789TJQKA`) + suit (`shdc`),
 * e.g. `As` = ace of spades. That keeps `CardGameDoc.deck` a plain `string[]`.
 */

export const SUITS = ['s', 'h', 'd', 'c'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export const HAND_SIZE = 5;
/** A round deals two hands, so this is the smallest deck we can play from. */
export const MIN_DECK = HAND_SIZE * 2;

export const SUIT_GLYPH: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const HAND_NAMES = [
  'High card',
  'One pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const;

/** Base value of each made hand. Payouts are multiples of this. */
export const HAND_POINTS = [1, 3, 6, 10, 15, 20, 25, 50, 100] as const;

/** Points added to a winning payout on top of the doubled hand value. */
export const WIN_BONUS = 5;

export interface HandValue {
  /** Index into HAND_NAMES / HAND_POINTS. */
  rank: number;
  name: string;
  points: number;
}

export type RoundOutcome = 'win' | 'loss' | 'push';

export interface RoundResult {
  player: HandValue;
  house: HandValue;
  outcome: RoundOutcome;
  points: number;
}

export interface DealResult {
  player: string[];
  house: string[];
  rest: string[];
}

/* ------------------------------------------------------------------ */
/* Cards                                                              */
/* ------------------------------------------------------------------ */

export function createDeck(): string[] {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

/** Fisher–Yates. `rng` is injectable so tests can pin the shuffle. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function cardRank(card: string): string {
  return card.slice(0, 1);
}

export function cardSuit(card: string): Suit {
  const suit = card.slice(1, 2);
  return (SUITS as readonly string[]).includes(suit) ? (suit as Suit) : 's';
}

/** Numeric rank: 2 → 2 … A → 14. Unknown ranks degrade to the lowest card. */
export function rankValue(card: string): number {
  const index = (RANKS as readonly string[]).indexOf(cardRank(card));
  return index < 0 ? 2 : index + 2;
}

export function cardLabel(card: string): string {
  return `${cardRank(card)}${SUIT_GLYPH[cardSuit(card)]}`;
}

export function formatHand(cards: readonly string[]): string {
  return cards.length > 0 ? cards.map(cardLabel).join(' ') : '—';
}

export function handName(rank: number): string {
  return HAND_NAMES[rank] ?? HAND_NAMES[0];
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Counts per rank, ordered by group size then rank — the same ordering poker
 * uses to break ties (a pair of aces beats a pair of kings, and within two
 * pairs the bigger pair is compared first).
 */
function orderedValues(cards: readonly string[]): number[] {
  const values = cards.map(rankValue);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const unique = [...new Set(values)];
  // A-2-3-4-5 is the wheel; 2-3-4-5-6 is the only other run containing a 2 and a 5.
  const isWheel = unique.includes(14) && unique.includes(5) && unique.includes(2) && !unique.includes(6);

  return unique
    // The wheel (A-2-3-4-5) plays as a 5-high straight, not ace-high.
    .map((value) => (isWheel && value === 14 ? 1 : value))
    .sort((a, b) => counts.get(b)! - counts.get(a)! || b - a);
}

function isStraightRun(values: number[]): boolean {
  if (values.length !== HAND_SIZE) return false;
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length !== HAND_SIZE) return false;
  if (sorted[HAND_SIZE - 1]! - sorted[0]! === HAND_SIZE - 1) return true;
  // A-2-3-4-5: treat the ace as a 1 by checking the remaining run directly.
  return sorted[0] === 2 && sorted[3] === 5 && sorted[4] === 14;
}

export function evaluateHand(cards: readonly string[]): HandValue {
  const values = cards.map(rankValue);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const top = groups[0]?.[1] ?? 0;
  const second = groups[1]?.[1] ?? 0;

  const flush = new Set(cards.map(cardSuit)).size === 1 && cards.length === HAND_SIZE;
  const straight = isStraightRun(values);

  let rank = 0;
  if (straight && flush) rank = 8;
  else if (top === 4) rank = 7;
  else if (top === 3 && second === 2) rank = 6;
  else if (flush) rank = 5;
  else if (straight) rank = 4;
  else if (top === 3) rank = 3;
  else if (top === 2 && second === 2) rank = 2;
  else if (top === 2) rank = 1;

  return { rank, name: handName(rank), points: HAND_POINTS[rank] ?? HAND_POINTS[0] };
}

/** Positive when hand `a` wins, negative when `b` wins, 0 on an exact tie. */
export function compareHands(a: readonly string[], b: readonly string[]): number {
  const left = evaluateHand(a);
  const right = evaluateHand(b);
  if (left.rank !== right.rank) return left.rank - right.rank;

  const leftValues = orderedValues(a);
  const rightValues = orderedValues(b);
  for (let i = 0; i < Math.min(leftValues.length, rightValues.length); i += 1) {
    const diff = leftValues[i]! - rightValues[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Rounds                                                             */
/* ------------------------------------------------------------------ */

/** Deals two hands off the top of the deck. Returns null when it cannot. */
export function dealRound(deck: readonly string[], size = HAND_SIZE): DealResult | null {
  if (deck.length < size * 2) return null;

  const pile = [...deck];
  const player = pile.splice(0, size);
  const house = pile.splice(0, size);
  return { player, house, rest: pile };
}

/**
 * Payout: win = 2x hand value + bonus, push = hand value, loss = nothing.
 * The house edge comes from ties paying only the flat hand value.
 */
export function resolveRound(playerCards: readonly string[], houseCards: readonly string[]): RoundResult {
  const player = evaluateHand(playerCards);
  const house = evaluateHand(houseCards);
  const cmp = compareHands(playerCards, houseCards);

  const outcome: RoundOutcome = cmp > 0 ? 'win' : cmp < 0 ? 'loss' : 'push';
  const points = outcome === 'win' ? player.points * 2 + WIN_BONUS : outcome === 'push' ? player.points : 0;

  return { player, house, outcome, points };
}

/* ------------------------------------------------------------------ */
/* Loot                                                               */
/* ------------------------------------------------------------------ */

export interface LootEntry {
  item_id: string;
  name: string;
  weight: number;
}

export const LOOT_TABLE: readonly LootEntry[] = [
  { item_id: 'chip', name: 'Casino Chip', weight: 6 },
  { item_id: 'coin', name: 'Gold Coin', weight: 4 },
  { item_id: 'ticket', name: 'Raffle Ticket', weight: 2 },
  { item_id: 'joker', name: 'Lucky Joker', weight: 1 },
];

/** Chance of a drop after a win — frequent enough to feel rewarding, rare enough to stay a bonus. */
export const LOOT_CHANCE = 0.35;

export function rollLoot(rng: () => number = Math.random): InventoryItem | null {
  if (rng() >= LOOT_CHANCE) return null;

  const total = LOOT_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of LOOT_TABLE) {
    roll -= entry.weight;
    if (roll < 0) return { item_id: entry.item_id, name: entry.name, quantity: 1 };
  }

  const fallback = LOOT_TABLE[0] as LootEntry;
  return { item_id: fallback.item_id, name: fallback.name, quantity: 1 };
}
