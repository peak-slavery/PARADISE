// ---------------------------------------------------------------------------
// Filesystem card registry — scanner, manifest, and adapter tests.
//
// Uses synthetic fixtures under os.tmpdir() (never the real cards/ tree) so
// the tests stay hermetic and can exercise adversarial cases like symlinks,
// duplicate IDs, duplicate content, and prototype-polluting metadata.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  scanCards,
  parseMetadata,
  parseManifest,
  serializeManifest,
  buildManifest,
  normalizeId,
  MAX_ARTWORK_BYTES,
  RARITY_FOLDER_TO_RANK,
} from './scanner.js';
import { loadRegistry, buildIndexes } from './loader.js';

/* -- Fixture helpers ------------------------------------------------------- */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(rgb: [number, number, number]): Buffer {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    // CRC is not validated by our magic-byte check, so a fixed value is fine
    // for the fixtures that only exercise signature detection.
    const crc = Buffer.alloc(4);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const idat = chunk('IDAT', zlib.deflateSync(Buffer.from([0, rgb[0], rgb[1], rgb[2], 0xff])));
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData), idat, chunk('IEND', Buffer.alloc(0))]);
}

const JPG_HEAD = Buffer.from([
  0xff, 0xd8, // SOI
  0xff, 0xe0, // APP0
  0x00, 0x10, // 16-byte segment including length
  0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xd9, // EOI
]);

function makeWebp(seed: number): Buffer {
  const payload = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, seed, 0x01]);
  const chunk = Buffer.concat([Buffer.from('VP8X', 'ascii'), Buffer.from([0x0a, 0x00, 0x00, 0x00]), payload]);
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk]);
  const riffLength = Buffer.alloc(4);
  riffLength.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), riffLength, body]);
}

let tmpRoot: string;
let counter = 0;

function makeCardRoot(): string {
  counter += 1;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `luffy-cards-${counter}-`));
  for (const folder of Object.keys(RARITY_FOLDER_TO_RANK)) {
    fs.mkdirSync(path.join(tmpRoot, folder), { recursive: true });
  }
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function write(folder: string, name: string, data: Buffer | string): string {
  const full = path.join(tmpRoot, folder, name);
  fs.writeFileSync(full, data);
  return full;
}

/* -- normalizeId ----------------------------------------------------------- */

describe('normalizeId', () => {
  it('lowercases and strips unsafe characters', () => {
    expect(normalizeId('Captain Straw Luffy')).toBe('captain-straw-luffy');
    expect(normalizeId('Captain.Straw.Luffy')).toBe('captain.straw.luffy');
    expect(normalizeId('  spaced  ')).toBe('spaced');
    expect(normalizeId('ex!@#id')).toBe('exid');
  });

  it('produces a stable id across invocations', () => {
    const once = normalizeId('Some Card Image 12.png-stem');
    expect(once).toBe(normalizeId('Some Card Image 12.png-stem'));
  });
});

/* -- scanner --------------------------------------------------------------- */

describe('scanCards', () => {
  it('discovers cards in every rarity folder and derives ids from filenames', () => {
    makeCardRoot();
    write('Common', 'buggy.png', makePng([1, 1, 1]));
    write('Rare', 'luffy.png', makePng([2, 2, 2]));
    write('Limited-Arts', 'gold.luffy.png', makePng([3, 3, 3]));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    expect(result.cards.map((c) => c.definition_id)).toEqual(['buggy', 'gold.luffy', 'luffy']);
    expect(result.cards.map((c) => c.rank)).toEqual(['common', 'limited_arts', 'rare']);
  });

  it('supports jpg, jpeg, and webp via magic bytes', () => {
    makeCardRoot();
    // Distinct trailing bytes so the three fixtures don't trip
    // duplicate-content detection (each card must have unique artwork).
    write('Common', 'a.jpg', Buffer.concat([JPG_HEAD, Buffer.from([1])]));
    write('Common', 'b.jpeg', Buffer.concat([JPG_HEAD, Buffer.from([2])]));
    write('Common', 'c.webp', makeWebp(3));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    expect(result.cards.map((c) => c.artwork_format)).toEqual(['jpg', 'jpeg', 'webp']);
  });

  it('rejects structurally corrupt images after signature validation', () => {
    makeCardRoot();
    write('Common', 'truncated.png', PNG_SIG);
    write('Common', 'truncated.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    write('Common', 'truncated.webp', Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]));

    const result = scanCards(tmpRoot);
    expect(result.errors.filter((error) => error.code === 'corrupt_image')).toHaveLength(3);
  });

  it('rejects unsupported extensions', () => {
    makeCardRoot();
    write('Common', 'anim.gif', Buffer.from('GIF89a'));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('unsupported_extension');
  });

  it('ignores dotfiles so gitkeep can track empty rarity folders', () => {
    makeCardRoot();
    write('Gold', '.gitkeep', Buffer.from(''));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(0);
    expect(result.folders).toContain('Gold');
  });

  it('rejects files above the size cap', () => {
    makeCardRoot();
    write('Common', 'huge.png', Buffer.concat([PNG_SIG, Buffer.alloc(MAX_ARTWORK_BYTES)]));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('too_large');
  });

  it('detects duplicate ids across folders', () => {
    makeCardRoot();
    write('Common', 'same.png', makePng([10, 10, 10]));
    write('Rare', 'same.png', makePng([20, 20, 20]));

    const result = scanCards(tmpRoot);
    expect(result.errors.some((e) => e.code === 'duplicate_id')).toBe(true);
  });

  it('detects identical content even with different filenames', () => {
    makeCardRoot();
    const same = makePng([42, 42, 42]);
    write('Common', 'one.png', same);
    write('Rare', 'two.png', same);

    const result = scanCards(tmpRoot);
    expect(result.errors.some((e) => e.code === 'duplicate_content')).toBe(true);
  });

  it('warns on metadata sidecars without artwork', () => {
    makeCardRoot();
    write('Common', 'lonely.json', JSON.stringify({ name: 'no art' }));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'orphan_metadata')).toBe(true);
    expect(result.cards).toHaveLength(0);
  });

  it('flags unknown rarity folders as warnings and skips them', () => {
    makeCardRoot();
    fs.mkdirSync(path.join(tmpRoot, 'Legendary'));
    write('Legendary', 'mystery.png', makePng([7, 7, 7]));
    write('Common', 'known.png', makePng([8, 8, 8]));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'invalid_rarity_folder')).toBe(true);
    expect(result.cards.map((c) => c.definition_id)).toEqual(['known']);
  });

  it('reports a missing root as an error, not a throw', () => {
    const result = scanCards(path.join(os.tmpdir(), `luffy-nonexistent-${Date.now()}`));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('root_missing');
    expect(result.cards).toHaveLength(0);
  });

  it('applies Limited Arts event-only default when metadata omits it', () => {
    makeCardRoot();
    write('Limited-Arts', 'rare.la.png', makePng([11, 11, 11]));
    write('Rare', 'normal.png', makePng([12, 12, 12]));

    const result = scanCards(tmpRoot);
    expect(result.errors).toHaveLength(0);
    const la = result.cards.find((c) => c.rank === 'limited_arts');
    const normal = result.cards.find((c) => c.rank === 'rare');
    expect(la?.is_event_only).toBe(true);
    expect(normal?.is_event_only).toBe(false);
  });
});

/* -- metadata -------------------------------------------------------------- */

describe('parseMetadata', () => {
  it('accepts valid metadata', () => {
    const parsed = parseMetadata(JSON.stringify({ id: 'luffy.g5', character: 'Luffy', power: 1000 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.id).toBe('luffy.g5');
      expect(parsed.data.power).toBe(1000);
    }
  });

  it('rejects prototype-polluting keys', () => {
    const parsed = parseMetadata('{"__proto__": {"isAdmin": true}, "name": "x"}');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('forbidden key');
  });

  it('rejects constructor and prototype keys too', () => {
    expect(parseMetadata('{"constructor": 1}').ok).toBe(false);
    expect(parseMetadata('{"prototype": 1}').ok).toBe(false);
  });

  it('rejects unknown fields (strict schema)', () => {
    const parsed = parseMetadata(JSON.stringify({ name: 'x', bogus: true }));
    expect(parsed.ok).toBe(false);
  });

  it('rejects non-integer or negative power', () => {
    expect(parseMetadata(JSON.stringify({ power: -1 })).ok).toBe(false);
    expect(parseMetadata(JSON.stringify({ power: 1.5 })).ok).toBe(false);
    expect(parseMetadata(JSON.stringify({ power: 2_000_000 })).ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(parseMetadata('{not json').ok).toBe(false);
  });
});

/* -- manifest -------------------------------------------------------------- */

describe('manifest', () => {
  it('is byte-identical across builds for the same input', () => {
    makeCardRoot();
    write('Rare', 'zoro.png', makePng([21, 21, 21]));
    write('Common', 'buggy.png', makePng([22, 22, 22]));

    const first = serializeManifest(buildManifest(scanCards(tmpRoot)));
    const second = serializeManifest(buildManifest(scanCards(tmpRoot)));
    expect(first).toBe(second);
  });

  it('round-trips through parseManifest', () => {
    makeCardRoot();
    write('Rare', 'nami.png', makePng([31, 31, 31]));

    const serialized = serializeManifest(buildManifest(scanCards(tmpRoot)));
    const parsed = parseManifest(serialized);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.cards.map((c) => c.definition_id)).toEqual(['nami']);
    }
  });

  it('rejects an unknown schema_version', () => {
    const raw = JSON.stringify({ schema_version: 999, generated_by: 'x', cards: [] });
    expect(parseManifest(raw).ok).toBe(false);
  });

  it('sorts cards by definition_id regardless of scan order', () => {
    makeCardRoot();
    write('Rare', 'zzz.png', makePng([41, 41, 41]));
    write('Rare', 'aaa.png', makePng([42, 42, 42]));

    const manifest = buildManifest(scanCards(tmpRoot));
    expect(manifest.cards.map((c) => c.definition_id)).toEqual(['aaa', 'zzz']);
  });
});

/* -- loader / adapter ------------------------------------------------------ */

describe('loadRegistry', () => {
  it('maps scanned cards onto CardDefinitionDoc-compatible shapes', () => {
    makeCardRoot();
    write('Rare', 'luffy.png', makePng([51, 51, 51]));
    write('Limited-Arts', 'gold.luffy.png', makePng([52, 52, 52]));
    write('Limited-Arts', 'gold.luffy.json', JSON.stringify({ character: 'Luffy', total_supply: 100 }));

    const result = scanCards(tmpRoot);
    const { definitions } = loadRegistry(buildManifest(result), new Date(0));

    const luffy = definitions.find((d) => d.definition_id === 'luffy');
    const gold = definitions.find((d) => d.definition_id === 'gold.luffy');
    expect(luffy).toBeDefined();
    expect(gold).toBeDefined();
    if (!luffy || !gold) return;

    expect(luffy.rank).toBe('rare');
    expect(luffy.base_value).toBeGreaterThan(0);
    expect(luffy.created_at.getTime()).toBe(0);

    expect(gold.is_event_only).toBe(true);
    expect(gold.total_supply).toBe(100);
    expect(gold.artwork_url).toBe('cards/Limited-Arts/gold.luffy.png');
  });

  it('builds lookup indexes keyed by id and rank', () => {
    makeCardRoot();
    write('Common', 'a.png', makePng([61, 61, 61]));
    write('Rare', 'b.png', makePng([62, 62, 62]));
    write('Rare', 'c.png', makePng([63, 63, 63]));

    const { definitionIndex, byRank } = buildIndexes(loadRegistry(buildManifest(scanCards(tmpRoot))).definitions);
    expect(definitionIndex.get('a')?.rank).toBe('common');
    expect(byRank.get('rare')?.map((d) => d.definition_id)).toEqual(['b', 'c']);
  });

  it('exposes the five default packs with deterministic ids', () => {
    makeCardRoot();
    write('Common', 'a.png', makePng([71, 71, 71]));

    const { packs } = loadRegistry(buildManifest(scanCards(tmpRoot)));
    expect(packs.map((p) => p.pack_id)).toEqual([
      'standard',
      'premium',
      'legendary',
      'event.seasonal',
      'limited.premium',
    ]);
  });
});

/* -- sync ------------------------------------------------------------------ */

// The Mongo sync is exercised through a fake collection harness mirroring the
// one used by store.test.ts (findOne / updateOne / countDocuments / find cursor).

type StoredDoc = Record<string, unknown> & { definition_id: string };

function makeFakeCollection() {
  const docs: StoredDoc[] = [];
  const setOps: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];

  return {
    docs,
    setOps,
    async findOne(filter: { definition_id?: string }) {
      return docs.find((d) => d.definition_id === filter.definition_id) ?? null;
    },
    async updateOne(filter: { definition_id?: string }, update: Record<string, unknown>, options?: { upsert?: boolean }) {
      const id = filter.definition_id;
      const existing = docs.find((d) => d.definition_id === id);
      const $set = (update.$set ?? {}) as Record<string, unknown>;
      if (existing) {
        Object.assign(existing, $set);
        setOps.push({ filter, update });
        return { matchedCount: 1 };
      }
      if (options?.upsert) {
        const $setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
        docs.push({ ...$set, ...$setOnInsert, definition_id: id } as StoredDoc);
        setOps.push({ filter, update });
        return { upsertedCount: 1 };
      }
      return { matchedCount: 0 };
    },
    // Minimal projection-less cursor for the archive scan.
    find(filter: { definition_id?: { $nin?: string[] }; archived_at?: null }) {
      const nin = filter.definition_id?.$nin ?? [];
      const results = docs.filter(
        (d) => !nin.includes(d.definition_id) && filter.archived_at === null && d.archived_at == null,
      );
      return { toArray: async () => results };
    },
    async countDocuments(filter: { definition_id?: { $nin?: string[] }; archived_at?: null }) {
      const nin = filter.definition_id?.$nin ?? [];
      return docs.filter((d) => !nin.includes(d.definition_id) && filter.archived_at === null && d.archived_at == null).length;
    },
  };
}

describe('syncRegistry', () => {
  it('upserts manifest definitions and is idempotent on a second run', async () => {
    const { syncRegistry } = await import('./sync.js');
    makeCardRoot();
    write('Rare', 'luffy.png', makePng([81, 81, 81]));
    const manifest = buildManifest(scanCards(tmpRoot));

    const collection = makeFakeCollection();
    const first = await syncRegistry({ collections: { card_definitions: collection as never }, manifest });
    expect(first.upserted).toBe(1);
    expect(first.archived).toBe(0);

    const second = await syncRegistry({ collections: { card_definitions: collection as never }, manifest });
    expect(second.upserted).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it('archives definitions removed from the manifest without deleting them', async () => {
    const { syncRegistry } = await import('./sync.js');
    makeCardRoot();
    write('Rare', 'luffy.png', makePng([91, 91, 91]));
    const collection = makeFakeCollection();

    await syncRegistry({ collections: { card_definitions: collection as never }, manifest: buildManifest(scanCards(tmpRoot)) });
    expect(collection.docs).toHaveLength(1);

    // Remove the artwork, rescan, resync — definition must be archived, not deleted.
    fs.rmSync(path.join(tmpRoot, 'Rare', 'luffy.png'));
    const manifestAfterRemoval = buildManifest(scanCards(tmpRoot));
    const summary = await syncRegistry({ collections: { card_definitions: collection as never }, manifest: manifestAfterRemoval });

    expect(summary.archived).toBe(1);
    expect(collection.docs).toHaveLength(1);
    expect(collection.docs[0]!.enabled).toBe(false);
    expect(collection.docs[0]!.archived_at).not.toBeNull();
  });

  it('reactivates a previously archived definition when artwork returns', async () => {
    const { syncRegistry } = await import('./sync.js');
    makeCardRoot();
    const pngPath = write('Rare', 'luffy.png', makePng([101, 101, 101]));
    const collection = makeFakeCollection();

    await syncRegistry({ collections: { card_definitions: collection as never }, manifest: buildManifest(scanCards(tmpRoot)) });
    fs.rmSync(pngPath);
    await syncRegistry({ collections: { card_definitions: collection as never }, manifest: buildManifest(scanCards(tmpRoot)) });
    expect(collection.docs[0]!.enabled).toBe(false);

    write('Rare', 'luffy.png', makePng([101, 101, 101]));
    const summary = await syncRegistry({ collections: { card_definitions: collection as never }, manifest: buildManifest(scanCards(tmpRoot)) });
    expect(summary.reactivated).toBe(1);
    expect(collection.docs[0]!.enabled).toBe(true);
    expect(collection.docs[0]!.archived_at).toBeNull();
  });

  it('never writes rows for definitions the manifest does not contain', async () => {
    const { syncRegistry } = await import('./sync.js');
    makeCardRoot();
    write('Rare', 'luffy.png', makePng([111, 111, 111]));

    const manifest = buildManifest(scanCards(tmpRoot));
    manifest.cards = [];

    const collection = makeFakeCollection();
    const summary = await syncRegistry({ collections: { card_definitions: collection as never }, manifest });
    expect(summary.upserted).toBe(0);
    expect(collection.docs).toHaveLength(0);
  });

  it('collects per-definition errors instead of throwing', async () => {
    const { syncRegistry } = await import('./sync.js');
    makeCardRoot();
    write('Rare', 'luffy.png', makePng([121, 121, 121]));

    const manifest = buildManifest(scanCards(tmpRoot));
    const failing = {
      async findOne() { throw new Error('boom'); },
      async updateOne() { throw new Error('boom'); },
      find() { return { toArray: async () => [] }; },
      async countDocuments() { return 0; },
    };
    const summary = await syncRegistry({
      collections: { card_definitions: failing as never },
      manifest,
    });
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.message).toBe('boom');
  });
});
