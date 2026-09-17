import { describe, expect, it } from 'vitest';
import type { CardInstanceDoc } from '@eiflow/shared';

import { CARD_DEFINITIONS, CARD_PACKS, getDefinition, getPack } from './catalog.js';
import { computeSellValue, openPack, safeAdd, safeSub, totalCollectionValue } from './engine.js';
import { RARITY_TABLE, rarityFor } from './rarity.js';

describe('openPack', () => {
  it('returns the requested number of draws for every active pack', () => {
    for (const pack of CARD_PACKS) {
      const result = openPack(pack, () => 0.5);
      expect(result.pack).toBe(pack);
      expect(result.draws).toHaveLength(pack.card_count);
      for (const d of result.draws) {
        expect(getDefinition(d.definition.definition_id)).not.toBeNull();
        expect(rarityFor(d.rank)).toBeDefined();
      }
    }
  });

  it('never returns Limited Arts when the pack excludes it', () => {
    for (const pack of CARD_PACKS) {
      if (pack.allow_limited_arts) continue;
      // Only iterate packs whose allowed ranks all have at least one definition
      // to avoid the engine's own "no definitions" guard.
      const definedRanks = pack.allowed_ranks.filter(
        (r) => CARD_DEFINITIONS.some((d) => d.rank === r),
      );
      if (definedRanks.length !== pack.allowed_ranks.length) continue;
      for (let i = 0; i < 200; i += 1) {
        const { draws } = openPack(pack, Math.random);
        for (const d of draws) {
          expect(d.rank).not.toBe('limited_arts');
        }
      }
    }
  });

  it('rejects inactive packs', () => {
    const p = { ...CARD_PACKS[0]!, active: false };
    expect(() => openPack(p)).toThrow();
  });
});

describe('computeSellValue', () => {
  it('returns the rank base value when the rank range is fixed', () => {
    const limited = CARD_DEFINITIONS.find((d) => d.rank === 'limited_arts');
    if (!limited) throw new Error('Limited Arts definition missing');
    const v = computeSellValue(limited, () => 0.5);
    expect(v).toBe(rarityFor('limited_arts').baseValue);
  });

  it('stays within the rank min/max range for variable ranks', () => {
    for (const entry of RARITY_TABLE) {
      const def = CARD_DEFINITIONS.find((d) => d.rank === entry.rank);
      if (!def) continue;
      for (let i = 0; i < 500; i += 1) {
        const v = computeSellValue(def, Math.random);
        expect(v).toBeGreaterThanOrEqual(entry.minValue);
        expect(v).toBeLessThanOrEqual(entry.maxValue);
      }
    }
  });

  it('is deterministic for a given rng seed', () => {
    const def = CARD_DEFINITIONS.find((d) => d.rank === 'rare');
    if (!def) throw new Error('No rare definition');
    const rng = () => 0.5;
    expect(computeSellValue(def, rng)).toBe(computeSellValue(def, rng));
  });
});

describe('totalCollectionValue', () => {
  it('sums active instances and ignores sold/revoked', () => {
    const rare = CARD_DEFINITIONS.find((d) => d.rank === 'rare')!;
    const elite = CARD_DEFINITIONS.find((d) => d.rank === 'elite')!;
    const now = new Date();
    const instances: CardInstanceDoc[] = [
      { instance_id: 'c_inst_1', definition_id: rare.definition_id, owner_user_id: 'u', owner_guild_id: 'g', acquired_at: now, source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: now, updated_at: now },
      { instance_id: 'c_inst_2', definition_id: elite.definition_id, owner_user_id: 'u', owner_guild_id: 'g', acquired_at: now, source: 'pack_open', serial_number: null, release_event: null, status: 'sold', lock_token: null, version: 1, created_at: now, updated_at: now },
      { instance_id: 'c_inst_3', definition_id: elite.definition_id, owner_user_id: 'u', owner_guild_id: 'g', acquired_at: now, source: 'pack_open', serial_number: null, release_event: null, status: 'revoked', lock_token: null, version: 1, created_at: now, updated_at: now },
    ];
    const defs = new Map(CARD_DEFINITIONS.map((d) => [d.definition_id, d]));
    // With rng=0.5, the jitter formula lands at min + Math.floor(0.5*(span))
    // = min + floor(span/2). rare: 60 + floor(61/2)=90. The active rare card
    // is the only one that counts, so the expected total is 90.
    const total = totalCollectionValue(instances, defs, () => 0.5);
    expect(total).toBe(90);
  });
});

describe('safeAdd / safeSub', () => {
  it('safeAdd rejects overflow', () => {
    expect(() => safeAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
  it('safeSub rejects negatives', () => {
    expect(() => safeSub(0, 1)).toThrow();
  });
});

describe('getDefinition / getPack', () => {
  it('returns null for unknown ids', () => {
    expect(getDefinition('unknown.thing')).toBeNull();
    expect(getPack('unknown')).toBeNull();
  });
  it('returns the same id for known entries', () => {
    expect(getDefinition('captain.straw.luffy')?.definition_id).toBe('captain.straw.luffy');
    expect(getPack('standard')?.pack_id).toBe('standard');
  });
});
