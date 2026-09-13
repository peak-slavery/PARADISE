import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalXpForLevel } from './levels.js';
import { chatContentLength, XpTracker } from './xp.js';

type Doc = { guild_id: string; user_id: string; xp: number; level: number; messages: number; voice_seconds: number; updated_at: Date };

/** Minimal Collection<xp> stand-in — XpTracker only uses find + bulkWrite. */
function fakeCollection(store: Map<string, Doc>) {
  return {
    find: (filter: { $or: Array<{ guild_id: string; user_id: string }> }, _opts: unknown) => ({
      async *[Symbol.asyncIterator]() {
        for (const doc of store.values()) {
          if (filter.$or.some((f) => f.guild_id === doc.guild_id && f.user_id === doc.user_id)) yield doc;
        }
      },
    }),
    bulkWrite: vi.fn(async (ops: Array<{ updateOne: { filter: { guild_id: string; user_id: string }; update: { $set: Partial<Doc>; $inc: Partial<Doc> } } }>) => {
      for (const op of ops) {
        const key = `${op.updateOne.filter.guild_id}:${op.updateOne.filter.user_id}`;
        const existing = store.get(key);
        if (existing) {
          Object.assign(existing, op.updateOne.update.$set, {
            messages: existing.messages + (op.updateOne.update.$inc.messages ?? 0),
            voice_seconds: existing.voice_seconds + (op.updateOne.update.$inc.voice_seconds ?? 0),
          });
        } else {
          store.set(key, {
            guild_id: op.updateOne.filter.guild_id,
            user_id: op.updateOne.filter.user_id,
            xp: op.updateOne.update.$set.xp ?? 0,
            level: op.updateOne.update.$set.level ?? 0,
            messages: op.updateOne.update.$inc.messages ?? 0,
            voice_seconds: op.updateOne.update.$inc.voice_seconds ?? 0,
            updated_at: new Date(),
          } as Doc);
        }
      }
    }),
  } as unknown as import('@eiflow/shared').MongoCollections['xp'];
}

afterEach(() => vi.restoreAllMocks());

describe('chat content scoring', () => {
  it('treats partial messages with null content as empty', () => {
    expect(chatContentLength(null)).toBe(0);
    expect(chatContentLength('hello')).toBe(5);
  });
});

describe('XpTracker stop()', () => {
  it('drains the full buffer across maxBatch-sized chunks', async () => {
    const store = new Map<string, Doc>();
    const collection = fakeCollection(store);
    const tracker = new XpTracker({
      getCollection: () => collection,
      log: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }), info: () => {}, warn: () => {}, error: () => {} } as never,
      maxBatch: 2,
    });

    tracker.add('100', '200', { xp: 10, messages: 1 });
    tracker.add('100', '201', { xp: 10, messages: 1 });
    tracker.add('100', '202', { xp: 10, messages: 1 });
    expect(tracker.pending).toBe(3);

    await tracker.stop();

    expect(tracker.pending).toBe(0);
    expect(store.size).toBe(3);
    for (const doc of store.values()) expect(doc.xp).toBe(10);
  });

  it('waits for an in-flight flush before draining, never double-counting', async () => {
    const store = new Map<string, Doc>();
    const collection = fakeCollection(store);
    const tracker = new XpTracker({
      getCollection: () => collection,
      log: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }), info: () => {}, warn: () => {}, error: () => {} } as never,
      maxBatch: 10,
    });

    // Gate only the FIRST bulkWrite so a flush is provably in flight when
    // stop() is called; the drain flush must pass through unhindered.
    const gate: { release: (() => void) | null } = { release: null };
    let writeStarted = false;
    const originalBulkWrite = collection.bulkWrite;
    (collection as unknown as { bulkWrite: unknown }).bulkWrite = vi.fn(async (...args: Parameters<typeof originalBulkWrite>) => {
      if (!writeStarted) {
        writeStarted = true;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return originalBulkWrite(...args);
    });

    tracker.add('100', '200', { xp: 5, messages: 1 });
    const inFlight = tracker.flush();
    await vi.waitFor(() => expect(writeStarted).toBe(true));

    // Delta added while the flush is in flight — must not be lost by stop().
    tracker.add('100', '201', { xp: 7, messages: 1 });
    const stopping = tracker.stop();

    gate.release?.();
    await Promise.all([inFlight, stopping]);

    expect(store.get('100:200')?.xp).toBe(5);
    expect(store.get('100:201')?.xp).toBe(7);
    expect(tracker.pending).toBe(0);
  });

  it('keeps deltas queued when a flush fails, so stop() does not drop them silently', async () => {
    const store = new Map<string, Doc>();
    const collection = fakeCollection(store);
    const tracker = new XpTracker({
      getCollection: () => collection,
      log: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }), info: () => {}, warn: () => {}, error: () => {} } as never,
    });

    tracker.add('100', '200', { xp: 3, messages: 1 });
    (collection as unknown as { bulkWrite: unknown }).bulkWrite = vi.fn(async () => {
      throw new Error('mongo down');
    });

    await tracker.stop();

    expect(tracker.pending).toBe(1);
  });

  it('emits one level-up event for every crossed level', async () => {
    const store = new Map<string, Doc>([
      ['100:200', { guild_id: '100', user_id: '200', xp: 0, level: 0, messages: 0, voice_seconds: 0, updated_at: new Date() }],
    ]);
    const collection = fakeCollection(store);
    const events: Array<{ level: number }> = [];
    const tracker = new XpTracker({
      getCollection: () => collection,
      log: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }), info: () => {}, warn: () => {}, error: () => {} } as never,
      onLevelUp: (event) => events.push({ level: event.level }),
    });

    tracker.add('100', '200', { xp: totalXpForLevel(3), messages: 1 });
    await tracker.flush();

    expect(events.map((event) => event.level)).toEqual([1, 2, 3]);
  });
});
