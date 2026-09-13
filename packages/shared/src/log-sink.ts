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
  /** Maximum number of documents retained during a prolonged outage. */
  maxBuffered?: number;
  /** Called when documents are discarded because the retention cap is full. */
  onDrop?: (dropped: number) => void;
  onError?: (err: unknown, dropped: number) => void;
}

export interface BatchWriter<T extends Document> {
  push(doc: T): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
  stats(): { buffered: number; dropped: number; flushed: number; failed: number };
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
  const maxBuffered = Math.max(maxBatch, opts.maxBuffered ?? 5_000);

  let buffer: T[] = [];
  let timer: NodeJS.Timeout | null = null;
  let flushing: Promise<void> | null = null;
  let stopping = false;
  let flushed = 0;
  let failed = 0;
  let droppedTotal = 0;

  const retain = (docs: T[]): void => {
    const dropped = Math.max(0, docs.length - maxBuffered);
    buffer = dropped === 0 ? docs : docs.slice(dropped);
    if (dropped > 0) {
      droppedTotal += dropped;
      opts.onDrop?.(dropped);
    }
  };

  const flush = async (): Promise<void> => {
    if (flushing) return flushing;
    if (buffer.length === 0) return;
    const collection = opts.getCollection();
    if (!collection) return;

    const batch = buffer;
    buffer = [];
    flushing = (async () => {
      try {
        if (opts.write) {
          await opts.write(collection, batch);
        } else {
          await collection.insertMany(batch as OptionalUnlessRequiredId<T>[], { ordered: false });
        }
        flushed += batch.length;
      } catch (err) {
        retain([...batch, ...buffer]);
        failed += batch.length;
        opts.onError?.(err, batch.length);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  timer = setInterval(() => {
    void flush();
  }, intervalMs);
  timer.unref?.();

  return {
    push(doc) {
      if (stopping) return;
      retain([...buffer, doc]);
      if (buffer.length >= maxBatch) void flush();
    },
    flush,
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      await flush();
      if (buffer.length > 0) await flush();
    },
    stats: () => ({ buffered: buffer.length, dropped: droppedTotal, flushed, failed }),
  };
}
