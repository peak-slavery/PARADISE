import type { Logger, MongoCollections } from '@eiflow/shared';
import { levelForXp } from './levels.js';

/**
 * Buffers XP deltas in memory and flushes them to MongoDB on a timer.
 *
 * This bot would otherwise be the heaviest writer in the ecosystem: one write
 * per message is unshippable on a free Atlas cluster. Instead every event only
 * touches a Map, and once per interval a single `bulkWrite` of upserts applies
 * every pending delta in one round trip.
 *
 * Deliberately NOT built on `createBatchWriter`: that helper is insert-only
 * (`insertMany`), and XP needs an upsert that merges into an existing document.
 * See the note in the hand-off report — adding a `write(batch)` hook to
 * `BatchWriterOptions` would let this class disappear.
 */

type XpCollection = MongoCollections['xp'];
type XpBulkOp = NonNullable<Parameters<XpCollection['bulkWrite']>[0][number]>;

export interface XpDelta {
  xp: number;
  messages: number;
  voiceSeconds: number;
}

export interface LevelUpEvent {
  guildId: string;
  userId: string;
  level: number;
  xp: number;
}

export interface XpTrackerOptions {
  /** Resolved lazily so the tracker survives a MongoDB reconnect. */
  getCollection: () => XpCollection | null;
  log: Logger;
  /** Flush cadence. */
  intervalMs?: number;
  /** Max members written per flush. */
  maxBatch?: number;
  /** Hard cap on buffered members, so a long outage cannot exhaust RAM. */
  maxBuffered?: number;
  onLevelUp?: (event: LevelUpEvent) => void;
}

const SEP = ':';
const EMPTY_DELTA: XpDelta = { xp: 0, messages: 0, voiceSeconds: 0 };

function keyOf(guildId: string, userId: string): string {
  return `${guildId}${SEP}${userId}`;
}

function splitKey(key: string): { guildId: string; userId: string } {
  const at = key.indexOf(SEP);
  return { guildId: key.slice(0, at), userId: key.slice(at + 1) };
}

function clamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export class XpTracker {
  private readonly buffer = new Map<string, XpDelta>();
  private readonly intervalMs: number;
  private readonly maxBatch: number;
  private readonly maxBuffered: number;

  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stopped = false;

  constructor(private readonly opts: XpTrackerOptions) {
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.maxBatch = opts.maxBatch ?? 500;
    this.maxBuffered = opts.maxBuffered ?? 20_000;
  }

  /** Adds a delta to the pending buffer. Never touches the network. */
  add(guildId: string, userId: string, delta: Partial<XpDelta>): void {
    if (this.stopped) return;

    const xp = clamp(delta.xp ?? 0);
    const messages = clamp(delta.messages ?? 0);
    const voiceSeconds = clamp(delta.voiceSeconds ?? 0);
    if (xp === 0 && messages === 0 && voiceSeconds === 0) return;

    const key = keyOf(guildId, userId);
    const current = this.buffer.get(key);
    if (current) {
      current.xp += xp;
      current.messages += messages;
      current.voiceSeconds += voiceSeconds;
      return;
    }

    // Deltas are dropped rather than allowed to grow the map without bound
    // while MongoDB is unreachable.
    if (this.buffer.size >= this.maxBuffered) return;
    this.buffer.set(key, { xp, messages, voiceSeconds });
  }

  /** Buffered-but-not-yet-written delta, so /rank feels live. */
  peek(guildId: string, userId: string): XpDelta {
    return this.buffer.get(keyOf(guildId, userId)) ?? EMPTY_DELTA;
  }

  get pending(): number {
    return this.buffer.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Writes at most `maxBatch` pending deltas. Whatever was successfully
   * written is subtracted from the buffer, so a failed flush keeps the deltas
   * queued and concurrent `add()` calls can never be lost or double-counted.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.stopped || this.buffer.size === 0) return;

    const collection = this.opts.getCollection();
    // No collection yet (degraded mode): keep the buffer and retry next tick.
    if (!collection) return;

    this.flushing = true;
    try {
      const batch: Array<[string, XpDelta]> = [];
      for (const [key, delta] of this.buffer) {
        if (batch.length >= this.maxBatch) break;
        batch.push([key, { ...delta }]);
      }
      if (batch.length === 0) return;

      await this.writeBatch(collection, batch);

      for (const [key, written] of batch) {
        const current = this.buffer.get(key);
        if (!current) continue;
        current.xp -= written.xp;
        current.messages -= written.messages;
        current.voiceSeconds -= written.voiceSeconds;
        if (current.xp <= 0 && current.messages <= 0 && current.voiceSeconds <= 0) {
          this.buffer.delete(key);
        }
      }
    } catch (err) {
      this.opts.log.error({ err, pending: this.buffer.size }, 'xp flush failed — deltas retained');
    } finally {
      this.flushing = false;
    }
  }

  private async writeBatch(collection: XpCollection, batch: Array<[string, XpDelta]>): Promise<void> {
    const filters = batch.map(([key]) => {
      const { guildId, userId } = splitKey(key);
      return { guild_id: guildId, user_id: userId };
    });

    // One read tells us the previous XP total and level, which is what makes
    // level-ups detectable without a second write.
    const current = new Map<string, { xp: number; level: number }>();
    const cursor = collection.find(
      { $or: filters },
      { projection: { _id: 0, guild_id: 1, user_id: 1, xp: 1, level: 1 } },
    );
    for await (const doc of cursor) {
      current.set(keyOf(doc.guild_id, doc.user_id), { xp: doc.xp, level: doc.level });
    }

    const updatedAt = new Date();
    const ops: XpBulkOp[] = [];
    const levelUps: LevelUpEvent[] = [];

    for (const [key, delta] of batch) {
      const { guildId, userId } = splitKey(key);
      const base = current.get(key) ?? { xp: 0, level: 0 };
      const xp = Math.max(0, base.xp + delta.xp);
      const level = levelForXp(xp);
      if (level > base.level) levelUps.push({ guildId, userId, level, xp });

      ops.push({
        updateOne: {
          filter: { guild_id: guildId, user_id: userId },
          update: {
            $set: { xp, level, updated_at: updatedAt },
            // On upsert $inc initialises these, so every field of XpDoc is set.
            $inc: { messages: delta.messages, voice_seconds: delta.voiceSeconds },
          },
          upsert: true,
        },
      });
    }

    if (ops.length === 0) return;
    await collection.bulkWrite(ops, { ordered: false });

    for (const event of levelUps) {
      try {
        this.opts.onLevelUp?.(event);
      } catch (err) {
        this.opts.log.error({ err, guildId: event.guildId, userId: event.userId }, 'level-up handler failed');
      }
    }
  }
}

/* ------------------------------------------------------------------ */

/**
 * Process-wide handle so lazily-loaded command modules can read the pending
 * buffer without the bot having to thread the tracker through every `ctx`.
 */
let instance: XpTracker | null = null;

export function setXpTracker(tracker: XpTracker): void {
  instance = tracker;
}

export function getXpTracker(): XpTracker | null {
  return instance;
}
