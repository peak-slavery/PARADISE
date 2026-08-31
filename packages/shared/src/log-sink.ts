import type { Collection, Document, OptionalUnlessRequiredId } from 'mongodb';
import type { LogDoc } from './db/mongo.js';

/** Batched writer for the `logs` collection. */
export type LogSink = BatchWriter<LogDoc>;

export interface BatchWriterOptions<T extends Document> {
  /** Resolved lazily so the writer survives a Mongo reconnect. */
  getCollection: () => Collection<T> | null;
  /** Flush cadence. 30–60s keeps us far below free-tier write limits. */
  intervalMs?: number;
  /** Force a flush once the buffer reaches this size. */
  maxBatch?: number;
  /**
   * Custom flush strategy. Defaults to `insertMany`.
   *
   * Supply this when documents must be *merged* rather than appended — e.g. XP
   * accumulation, where the target collection has a unique index on
   * (guild_id, user_id) and a plain insert would collide. Implement it with
   * `bulkWrite` of `updateOne` upserts so the whole batch still costs one round
   * trip.
   */
  write?: (collection: Collection<T>, batch: T[]) => Promise<void>;
  onError?: (err: unknown, dropped: number) => void;
}

export interface BatchWriter<T extends Document> {
  push(doc: T): void;
  flush(): Promise<void>;
  stop(): void;
  stats(): { buffered: number; flushed: number; failed: number };
}

/**
 * Buffers documents in memory and writes them in batches.
 *
 * This is the single biggest free-tier lever: batching turns per-event writes
 * into one write per interval, cutting write volume by 10–50x on hot paths
 * (voice XP ticks, message logs, antinuke events).
 */
export function createBatchWriter<T extends Document>(opts: BatchWriterOptions<T>): BatchWriter<T> {
  const intervalMs = opts.intervalMs ?? 30_000;
  const maxBatch = opts.maxBatch ?? 200;

  let buffer: T[] = [];
  let timer: NodeJS.Timeout | null = null;
  let flushing = false;
  let flushed = 0;
  let failed = 0;

  const flush = async (): Promise<void> => {
    if (flushing || buffer.length === 0) return;
    const collection = opts.getCollection();
    if (!collection) {
      // Drop rather than grow unbounded when the store is unavailable.
      buffer = [];
      return;
    }

    flushing = true;
    const batch = buffer;
    buffer = [];
    try {
      if (opts.write) {
        await opts.write(collection, batch);
      } else {
        await collection.insertMany(batch as OptionalUnlessRequiredId<T>[], { ordered: false });
      }
      flushed += batch.length;
    } catch (err) {
      failed += batch.length;
      opts.onError?.(err, batch.length);
    } finally {
      flushing = false;
    }
  };

  timer = setInterval(() => {
    void flush();
  }, intervalMs);
  timer.unref?.();

  return {
    push(doc) {
      buffer.push(doc);
      if (buffer.length >= maxBatch) void flush();
    },
    flush,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      void flush();
    },
    stats: () => ({ buffered: buffer.length, flushed, failed }),
  };
}
