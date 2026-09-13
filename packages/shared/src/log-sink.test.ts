import { describe, expect, it } from 'vitest';
import { createBatchWriter } from './log-sink.js';

describe('batch writer shutdown', () => {
  it('waits for an in-flight batch write before stopping', async () => {
    let release!: () => void;
    let started!: () => void;
    const writeStarted = new Promise<void>((resolve) => { started = resolve; });
    const writeRelease = new Promise<void>((resolve) => { release = resolve; });
    const collection = {
      insertMany: async () => {
        started();
        await writeRelease;
      },
    } as never;
    const writer = createBatchWriter({
      getCollection: () => collection,
      intervalMs: 60_000,
      maxBatch: 1,
    });

    writer.push({ action: 'test' });
    await writeStarted;

    let stopped = false;
    const stopping = writer.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(writer.stats().flushed).toBe(1);
  });

  it('caps retained documents when writes keep failing', async () => {
    const collection = {
      insertMany: async () => { throw new Error('mongo unavailable'); },
    } as never;
    const errors: number[] = [];
    const writer = createBatchWriter({
      getCollection: () => collection,
      intervalMs: 60_000,
      maxBatch: 1,
      maxBuffered: 2,
      onDrop: (count) => errors.push(count),
    });

    for (let i = 0; i < 5; i += 1) writer.push({ action: `event-${i}` });
    await writer.flush();

    expect(writer.stats().buffered).toBeLessThanOrEqual(2);
    expect(writer.stats().failed).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
    await writer.stop();
  });

  it('retains the newest documents when the retention cap is exceeded', async () => {
    let available = false;
    const collection = {
      insertMany: async () => {
        if (!available) throw new Error('mongo unavailable');
      },
    } as never;
    const writer = createBatchWriter({
      getCollection: () => collection,
      intervalMs: 60_000,
      maxBatch: 2,
      maxBuffered: 2,
    });

    for (let index = 0; index < 5; index += 1) writer.push({ action: `event-${index}` });
    await writer.flush();
    expect(writer.stats().buffered).toBe(2);

    available = true;
    await writer.stop();

    expect(writer.stats().flushed).toBe(2);
    expect(writer.stats().dropped).toBe(3);
  });

  it('drains documents added while a batch is in flight', async () => {
    let release!: () => void;
    let writes = 0;
    const writeRelease = new Promise<void>((resolve) => { release = resolve; });
    const collection = {
      insertMany: async () => {
        writes += 1;
        if (writes === 1) await writeRelease;
      },
    } as never;
    const writer = createBatchWriter({
      getCollection: () => collection,
      intervalMs: 60_000,
      maxBatch: 1,
    });

    writer.push({ action: 'first' });
    await Promise.resolve();
    writer.push({ action: 'second' });

    const stopping = writer.stop();
    release();
    await stopping;

    expect(writes).toBe(2);
    expect(writer.stats().buffered).toBe(0);
    expect(writer.stats().flushed).toBe(2);
  });
});
