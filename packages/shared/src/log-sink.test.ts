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
