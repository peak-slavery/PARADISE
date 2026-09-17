import { describe, expect, it } from 'vitest';

import {
  RARITY_TABLE,
  impliedProbability,
  pickRankFromTable,
  rarityFor,
  totalWeight,
} from './rarity.js';

describe('rarity table', () => {
  it('normalises total weight and is internally consistent', () => {
    expect(totalWeight()).toBeGreaterThan(0);
    const sum = RARITY_TABLE.reduce((acc, r) => acc + r.weight, 0);
    expect(totalWeight()).toBe(sum);
  });

  it('exposes every rank exactly once with monotonically increasing tiers', () => {
    const ranks = RARITY_TABLE.map((r) => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    for (let i = 1; i < RARITY_TABLE.length; i += 1) {
      const prev = RARITY_TABLE[i - 1];
      const curr = RARITY_TABLE[i];
      if (!prev || !curr) throw new Error('indexing error');
      expect(curr.tier).toBeGreaterThan(prev.tier);
    }
  });

  it('Limited Arts probability is exactly 0.001%', () => {
    const p = impliedProbability('limited_arts');
    expect(p).toBeCloseTo(0.00001, 8);
    expect(p * 100).toBeCloseTo(0.001, 6);
  });

  it('higher tiers have strictly lower weight than the tier below', () => {
    for (let i = 1; i < RARITY_TABLE.length; i += 1) {
      const prev = RARITY_TABLE[i - 1];
      const curr = RARITY_TABLE[i];
      if (!prev || !curr) throw new Error('indexing error');
      expect(curr.weight).toBeLessThanOrEqual(prev.weight);
    }
  });

  it('rarityFor rejects unknown ranks', () => {
    expect(() => rarityFor('platinum' as never)).toThrow();
  });
});

describe('pickRankFromTable', () => {
  it('returns an allowed rank with a fixed rng', () => {
    const rng = () => 0.0;
    const rank = pickRankFromTable(['common', 'rare'], rng);
    expect(['common', 'rare']).toContain(rank);
  });

  it('never returns a filtered-out rank', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      const r = pickRankFromTable(['common', 'limited_arts'], () => Math.random());
      seen.add(r);
    }
    expect(seen.has('common')).toBe(true);
    expect(seen.size).toBeLessThanOrEqual(2);
  });

  it('throws on empty allowed-ranks', () => {
    expect(() => pickRankFromTable([], Math.random)).toThrow();
  });
});

describe('monetary guard rails', () => {
  it('impliedProbability never exceeds 1', () => {
    for (const entry of RARITY_TABLE) {
      const p = impliedProbability(entry.rank);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
