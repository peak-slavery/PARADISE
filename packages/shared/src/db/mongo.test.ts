import { describe, expect, it, vi } from 'vitest';

import { ensureIndexes } from './mongo.js';
import { MONGO_INDEXES } from './mongo-indexes.js';
import type { MongoCollections } from './mongo.js';

function collections(createIndex: ReturnType<typeof vi.fn>): MongoCollections {
  return new Proxy({} as MongoCollections, {
    get: (_target, _property: string) => ({ createIndex }),
  }) as MongoCollections;
}

describe('ensureIndexes', () => {
  it('applies every canonical index by name', async () => {
    const createIndex = vi.fn(async () => 'index');
    await ensureIndexes(collections(createIndex));

    expect(createIndex).toHaveBeenCalledTimes(MONGO_INDEXES.length);
    for (const index of MONGO_INDEXES) {
      expect(createIndex).toHaveBeenCalledWith(index.key, {
        name: index.name,
        ...index.options,
      });
    }
  });

  it('propagates index failures so Mongo cannot be marked ready', async () => {
    const createIndex = vi.fn(async () => {
      throw new Error('index unavailable');
    });

    await expect(ensureIndexes(collections(createIndex))).rejects.toThrow('index unavailable');
  });
});
