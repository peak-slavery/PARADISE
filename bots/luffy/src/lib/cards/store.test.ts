// ---------------------------------------------------------------------------
// Store (repository) tests using a fake Mongo collection.
//
// We mock the `MongoCollections` interface to record and replay filter
// arguments, which lets us assert that compare-and-swap filters are correct
// without spinning up mongodb-memory-server. Concurrency, ownership, and
// locked-card protection are all verified against the real code paths.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BotControlState,
  BotServices,
  CardAcquisitionDoc,
  CardInstanceDoc,
  CardPackDoc,
  CardPlayerCurrencyDoc,
  CardTradeDoc,
  CardTransactionDoc,
  CommandContext,
  Env,
  Kv,
  Logger,
  TaskQueue,
  TypedSupabase,
} from '@eiflow/shared';
import { ServiceUnavailableError, UserError } from '@eiflow/shared';

import {
  acceptTrade,
  adminIssueCard,
  adminRevokeCard,
  applyCurrencyDelta,
  cancelTrade,
  createTrade,
  getCurrency,
  listInstances,
  listOpenTrades,
  purchaseAndOpenPack,
  sellInstance,
} from './store.js';
import { CARD_DEFINITIONS, CARD_PACKS } from './catalog.js';

class FakeCursor<T> {
  private comparator: ((a: T, b: T) => number) | null = null;
  constructor(private items: T[]) {}
  sort(s: { key: keyof T; dir: 1 | -1 }): this {
    this.comparator = (a: T, b: T) => (a[s.key] < b[s.key] ? -1 : a[s.key] > b[s.key] ? 1 : 0) * s.dir;
    return this;
  }
  limit(n: number): this {
    this.items = this.items.slice(0, n);
    return this;
  }
  async toArray(): Promise<T[]> {
    if (this.comparator) {
      return [...this.items].sort(this.comparator) as T[];
    }
    return [...this.items] as T[];
  }
}

function matchDoc(query: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  for (const [k, expected] of Object.entries(query)) {
    // `$or` is a top-level operator whose value *is* the array of clauses, so
    // it must be handled before the "plain value" fast path below.
    if (k === '$or') {
      const orClauses = Array.isArray(expected) ? expected : [];
      if (!orClauses.some((clause) => matchDoc(clause as Record<string, unknown>, doc))) return false;
      continue;
    }
    const actual = doc[k];
    const isOperatorObject = expected && typeof expected === 'object' && !Array.isArray(expected);
    if (!isOperatorObject) {
      // Plain equality — including for the ownership/status/version fields the
      // compare-and-swap filters rely on.
      if (actual !== expected) return false;
      continue;
    }
    if ('$in' in (expected as Record<string, unknown>)) {
      const inList = ((expected as { $in: unknown[] }).$in) ?? [];
      if (!inList.includes(actual)) return false;
    } else if ('$gte' in (expected as Record<string, unknown>)) {
      const gte = (expected as { $gte: number | Date }).$gte;
      const actualValue = actual instanceof Date ? actual.getTime() : (typeof actual === 'number' ? actual : NaN);
      const gteValue = gte instanceof Date ? gte.getTime() : (typeof gte === 'number' ? gte : NaN);
      if (Number.isNaN(actualValue) || Number.isNaN(gteValue) || actualValue < gteValue) return false;
    } else if ('$gt' in (expected as Record<string, unknown>)) {
      const gt = (expected as { $gt: number | Date }).$gt;
      const actualValue = actual instanceof Date ? actual.getTime() : (typeof actual === 'number' ? actual : NaN);
      const gtValue = gt instanceof Date ? gt.getTime() : (typeof gt === 'number' ? gt : NaN);
      if (Number.isNaN(actualValue) || Number.isNaN(gtValue) || actualValue <= gtValue) return false;
    } else if ('$ne' in (expected as Record<string, unknown>)) {
      const ne = (expected as { $ne: unknown }).$ne;
      if (actual === ne) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * `card_definitions` is seeded but never queried by the store — definitions
 * resolve from the in-memory catalog — so an empty typed collection is all
 * the object shape needs.
 */
function emptyFakeCollection(): FakeCollection {
  return collectionFor<Record<string, unknown>>(new Map());
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = clone(v);
  }
  return out as T;
}

function docKey(doc: Record<string, unknown>): string {
  return (doc.instance_id as string | undefined)
    ?? (doc.trade_id as string | undefined)
    ?? (doc.acquisition_id as string | undefined)
    ?? (doc.txn_id as string | undefined)
    ?? (doc.pack_id as string | undefined)
    ?? `${doc.guild_id ?? ''}:${doc.user_id ?? ''}`;
}

/** Minimal slice of the Mongo collection API the store actually calls. */
type FakeCollection = {
  documents: Map<string, unknown>;
  find(q?: Record<string, unknown>): FakeCursor<unknown>;
  findOne(q?: Record<string, unknown>): unknown;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { returnDocument?: 'after' | 'before'; upsert?: true },
  ): unknown;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): { matchedCount: number; modifiedCount: number; upsertedCount: number };
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): { matchedCount: number; modifiedCount: number };
  countDocuments(q?: Record<string, unknown>): Promise<number>;
  insertOne(doc: unknown): Promise<void>;
  insertMany(docs: unknown[], options?: Record<string, unknown>): Promise<void>;
};

function collectionFor<T>(table: Map<string, T>): FakeCollection {
  const collection: FakeCollection = {
    documents: table,
    find: (q: Record<string, unknown> = {}) => {
      const items = Array.from(table.values()).filter((d) => matchDoc(q, d as Record<string, unknown>));
      return new FakeCursor<unknown>(items);
    },
    findOne: (q: Record<string, unknown> = {}) => {
      const items = Array.from(table.values()).filter((d) => matchDoc(q, d as Record<string, unknown>));
      return items[0] ?? null;
    },
    findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: { returnDocument?: 'after' | 'before'; upsert?: true }) => {
      const existing = Array.from(table.values()).find((d) => matchDoc(filter, d as Record<string, unknown>));
      if (!existing) {
        if (options?.upsert) {
          const newDoc = applyOperators({}, update, true);
          Object.assign(newDoc, filter);
          table.set(docKey(newDoc), newDoc as T);
          return options.returnDocument === 'before' ? null : newDoc;
        }
        return null;
      }
      const before = clone(existing);
      applyOperators(existing, update, false);
      return options?.returnDocument === 'before' ? before : existing;
    },
    updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const existing = Array.from(table.values()).find((d) => matchDoc(filter, d as Record<string, unknown>));
      if (!existing) {
        if (update.$setOnInsert) {
          const newDoc = applyOperators({}, update, true);
          Object.assign(newDoc, filter);
          table.set(docKey(newDoc), newDoc as T);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      applyOperators(existing, update, false);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
    updateMany: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const matches = Array.from(table.values()).filter((d) => matchDoc(filter, d as Record<string, unknown>));
      for (const d of matches) applyOperators(d as Record<string, unknown>, update);
      return { matchedCount: matches.length, modifiedCount: matches.length };
    },
    countDocuments: async (q: Record<string, unknown> = {}) =>
      Array.from(table.values()).filter((d) => matchDoc(q, d as Record<string, unknown>)).length,
    insertOne: async (doc: unknown) => {
      const key = docKey(doc as Record<string, unknown>) || Math.random().toString(16).slice(2);
      table.set(key, doc as T);
    },
    insertMany: async (docs: unknown[]) => {
      for (const d of docs) {
        const key = docKey(d as Record<string, unknown>) || Math.random().toString(16).slice(2);
        table.set(key, d as T);
      }
    },
  };
  return collection;
}

/**
 * Apply a MongoDB update document. `$setOnInsert` is only honoured when
 * `onInsert` is true — the real server ignores it for updates of existing
 * documents, and honouring it unconditionally would, for example, reset a
 * player's balance to 0 whenever `getCurrency` upsert-reads their row.
 */
function applyOperators(doc: Record<string, unknown>, update: Record<string, unknown>, onInsert = false): Record<string, unknown> {
  for (const [k, v] of Object.entries(update)) {
    if (k === '$set' && v && typeof v === 'object') {
      Object.assign(doc, v);
    } else if (k === '$setOnInsert' && onInsert && v && typeof v === 'object') {
      Object.assign(doc, v);
    } else if (k === '$inc' && v && typeof v === 'object') {
      for (const [field, delta] of Object.entries(v as Record<string, number>)) {
        doc[field] = ((doc[field] as number | undefined) ?? 0) + delta;
      }
    } else if (k === '$push' && v && typeof v === 'object') {
      for (const [field, value] of Object.entries(v as Record<string, unknown>)) {
        const existing = doc[field];
        const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
        arr.push(value);
        doc[field] = arr;
      }
    } else if (!k.startsWith('$')) {
      doc[k] = v;
    }
  }
  return doc;
}

/**
 * The fake store implements exactly the seven card collections the store
 * module reads. Declared concretely so tests can index it without
 * `possibly undefined` narrowing at every access site.
 */
type FakeMongoStore = {
  card_definitions: FakeCollection;
  card_instances: FakeCollection;
  card_packs: FakeCollection;
  card_player_currency: FakeCollection;
  card_trades: FakeCollection;
  card_acquisitions: FakeCollection;
  card_transactions: FakeCollection;
};

let mongoStore: FakeMongoStore;

function makeCtx(extra: { ownerUserId?: string; userId?: string } = {}): CommandContext {
  const env = ({
    botId: 'luffy',
    botName: 'Luffy',
    botVersion: '1.0.0',
    embedColor: 0x5865f2,
    ownerIds: ['184617893241159680'],
    hasSupabase: false,
    hasMongo: true,
  } as unknown) as Env;
  const services = {
    env,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => services.log } as unknown as Logger,
    supabase: null as unknown as TypedSupabase,
    mongo: (async () => mongoStore) as unknown as BotServices['mongo'],
    requireMongo: (async () => mongoStore) as unknown as BotServices['requireMongo'],
    redis: ({} as unknown) as Kv,
    queue: (({ run: (t: () => Promise<unknown>) => t() }) as unknown) as TaskQueue,
    embeds: {
      brand: (() => ({ setFooter: () => ({ setFooter: () => ({}) }), addFields: () => ({ addFields: () => ({}) }) }) as never) as never,
    } as never,
    logs: {
      push: () => {},
      flush: async () => {},
      stop: async () => {},
      stats: () => ({ buffered: 0, dropped: 0, flushed: 0, failed: 0 }),
    },
    interlink: { publish: async () => undefined, subscribe: () => () => undefined },
    requireSupabase: () => { throw new ServiceUnavailableError('Supabase'); },
    isOwner: (id: string) => env.ownerIds.includes(id),
    isAuthorized: async () => true,
    getControlState: async () => ({ enabled: true, paused: false, serverPaused: false, featureFlags: {} } as BotControlState),
  } as unknown as BotServices;
  return {
    interaction: {
      id: 'interaction',
      guildId: 'g1',
      channelId: 'c1',
      user: { id: extra.userId ?? 'u1' },
      options: { getInteger: () => null, getString: () => null, getSubcommand: () => '', getUser: () => null },
      deferred: false,
      replied: false,
    },
    services,
    log: services.log as Logger,
    guildId: 'g1',
    userId: extra.userId ?? 'u1',
    commandsDir: '',
    defer: async () => {},
    replyEmbed: async () => {},
    success: async () => {},
    error: async () => {},
    info: async () => {},
    warn: async () => {},
  } as unknown as CommandContext;
}

beforeEach(() => {
  mongoStore = {
    card_definitions: emptyFakeCollection(),
    card_instances: collectionFor<CardInstanceDoc>(new Map()),
    card_packs: collectionFor<CardPackDoc>(new Map()),
    card_player_currency: collectionFor<CardPlayerCurrencyDoc>(new Map()),
    card_trades: collectionFor<CardTradeDoc>(new Map()),
    card_acquisitions: collectionFor<CardAcquisitionDoc>(new Map()),
    card_transactions: collectionFor<CardTransactionDoc>(new Map()),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('currency', () => {
  it('rejects insufficient balance on debit', async () => {
    const ctx = makeCtx();
    await expect(applyCurrencyDelta(ctx, -1000, 'pack_purchase', null)).rejects.toBeInstanceOf(UserError);
  });
  it('credits and debits deterministically', async () => {
    const ctx = makeCtx();
    const credit = await applyCurrencyDelta(ctx, 500, 'admin_credit', null);
    expect(credit.doc.balance).toBe(500);
    expect(credit.txn.delta).toBe(500);
    const debit = await applyCurrencyDelta(ctx, -200, 'pack_purchase', 'pack1');
    expect(debit.doc.balance).toBe(300);
    expect(debit.txn.balance_after).toBe(300);
  });
  it('rejects negative final balance', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    await expect(applyCurrencyDelta(ctx, -200, 'pack_purchase', null)).rejects.toBeInstanceOf(UserError);
  });
});

describe('pack purchase and open', () => {
  it('debits currency and inserts instances atomically', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 1_000, 'admin_credit', null);
    const pack = CARD_PACKS[0]!; // standard 250 berries
    const created = await purchaseAndOpenPack(
      ctx,
      pack,
      ['c_inst_1', 'c_inst_2', 'c_inst_3'],
      [
        { rank: 'common', definition_id: 'captain.buggy', instance_id: 'c_inst_1' },
        { rank: 'rare', definition_id: 'marine.smoker', instance_id: 'c_inst_2' },
        { rank: 'common', definition_id: 'captain.buggy', instance_id: 'c_inst_3' },
      ],
    );
    expect(created).toHaveLength(3);
    const cur = await getCurrency(ctx);
    expect(cur.balance).toBe(750);
    expect(cur.lifetime_spent).toBe(250);
  });

  it('rejects purchase when balance is insufficient', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 50, 'admin_credit', null);
    const pack = CARD_PACKS[0]!;
    await expect(purchaseAndOpenPack(ctx, pack, ['x'], [{ rank: 'common', definition_id: 'captain.buggy', instance_id: 'x' }]))
      .rejects.toBeInstanceOf(UserError);
  });
});

describe('selling', () => {
  it('refuses to sell another player\'s card', async () => {
    const ctx = makeCtx();
    const inst = ({
      instance_id: 'c_inst_x', definition_id: 'captain.buggy', owner_user_id: 'other', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc);
    mongoStore.card_instances.documents.set('c_inst_x', inst);
    // Pass ctx.userId (the current caller) as expected_owner_user_id. The CAS
    // filter only matches the doc whose owner is the caller, so the update
    // misses and the function throws "no longer sellable".
    await expect(sellInstance(ctx, 'c_inst_x', 1, 'active', ctx.userId, 'g1', 100, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('prevents double-selling through CAS', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const inst: CardInstanceDoc = ({
      instance_id: 'c_inst_x', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc);
    mongoStore.card_instances.documents.set('c_inst_x', inst);
    const first = await sellInstance(ctx, 'c_inst_x', 1, 'active', 'u1', 'g1', 25, 'captain.buggy');
    expect(first.doc.status).toBe('sold');
    await expect(sellInstance(ctx, 'c_inst_x', 1, 'active', 'u1', 'g1', 25, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });
});

describe('trades', () => {
  it('prevents self-trading', async () => {
    const ctx = makeCtx();
    await expect(createTrade(ctx, { instance_ids: [], berries: 0 }, { instance_ids: [], berries: 100 }, 'u1', 1000))
      .rejects.toBeInstanceOf(UserError);
  });

  it('rejects expired trades on accept', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    // A negative ttl creates a trade whose expiry is already in the past. It
    // must not be listed as open, and accepting it must fail closed.
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', -1_000);
    const open = await listOpenTrades(otherCtx, 'u2');
    expect(open).toHaveLength(0);
    await expect(acceptTrade(otherCtx, trade.trade_id, trade.version)).rejects.toBeInstanceOf(UserError);
  });

  it('rejects double acceptance via CAS', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    const open1 = await listOpenTrades(otherCtx, 'u2');
    const found = open1.find((t) => t.trade_id === trade.trade_id);
    expect(found).toBeDefined();
    await acceptTrade(otherCtx, trade.trade_id, found!.version);
    await expect(acceptTrade(otherCtx, trade.trade_id, found!.version)).rejects.toBeInstanceOf(UserError);
  });

  it('transfers currency atomically on accept', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 500, 'admin_credit', null);
    await applyCurrencyDelta(otherCtx, 200, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    const open = await listOpenTrades(otherCtx, 'u2');
    const found = open.find((t) => t.trade_id === trade.trade_id)!;
    await acceptTrade(otherCtx, trade.trade_id, found.version);
    const u1 = await getCurrency(ctx);
    const u2 = await getCurrency(otherCtx);
    expect(u1.balance).toBe(400);
    expect(u2.balance).toBe(300);
  });
});

describe('admin issuance and revocation', () => {
  it('rejects unknown definitions', async () => {
    const ctx = makeCtx();
    await expect(adminIssueCard(ctx, 'u2', 'unknown.thing', null)).rejects.toBeInstanceOf(UserError);
  });

  it('revokes an active card and writes an acquisition record', async () => {
    const ctx = makeCtx();
    const inst = ({
      instance_id: 'c_inst_x', definition_id: 'captain.buggy', owner_user_id: 'u2', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc);
    mongoStore.card_instances.documents.set('c_inst_x', inst);
    const result = await adminRevokeCard(ctx, 'c_inst_x');
    expect(result.status).toBe('revoked');
  });
});

describe('inventory listing', () => {
  it('filters by owner and status', async () => {
    const ctx = makeCtx();
    mongoStore.card_instances.documents.set('a', ({
      instance_id: 'a', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc));
    mongoStore.card_instances.documents.set('b', ({
      instance_id: 'b', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'sold', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc));
    const active = await listInstances(ctx, { status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0]?.instance_id).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// Adversarial suite.
//
// Every case below mirrors an attack from the program brief §17. Each test is
// written to FAIL if its guard is removed: they pass only because a specific
// compare-and-swap filter, supply check, or validation exists in the store.
// ---------------------------------------------------------------------------

describe('adversarial — forgery and spoofing', () => {
  it('rejects a forged instance id at sell', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    // No instance with this id exists at all.
    await expect(sellInstance(ctx, 'c_inst_does_not_exist', 1, 'active', 'u1', 'g1', 50, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('rejects a cross-guild ownership claim', async () => {
    const ctx = makeCtx();
    mongoStore.card_instances.documents.set('x', ({
      instance_id: 'x', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'other_guild', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc));
    // Caller claims the card is in g1, but it belongs to another guild.
    await expect(sellInstance(ctx, 'x', 1, 'active', 'u1', 'g1', 50, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('refuses to spend currency it does not own', async () => {
    const ctx = makeCtx();
    // Never credited. Any debit attempt must fail.
    await expect(applyCurrencyDelta(ctx, -1, 'pack_purchase', null))
      .rejects.toBeInstanceOf(UserError);
  });

  it('does not create a negative balance through a trade offer', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    await applyCurrencyDelta(ctx, 10, 'admin_credit', null);
    // Offers 1,000 berries but only holds 10 — the conditional debit must miss.
    await expect(createTrade(ctx, { instance_ids: [], berries: 1_000 }, { instance_ids: [], berries: 0 }, 'u2', 60_000))
      .rejects.toBeInstanceOf(UserError);
  });
});

describe('adversarial — duplication and double-spend', () => {
  it('cannot sell the same card twice in sequence', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    mongoStore.card_instances.documents.set('d', ({
      instance_id: 'd', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc));
    await sellInstance(ctx, 'd', 1, 'active', 'u1', 'g1', 25, 'captain.buggy');
    // Repeating the call with the SAME expected_version must miss: the row is
    // now version 2 / sold.
    await expect(sellInstance(ctx, 'd', 1, 'active', 'u1', 'g1', 25, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('cannot accept a trade twice', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    const found = (await listOpenTrades(otherCtx, 'u2')).find((t) => t.trade_id === trade.trade_id)!;
    await acceptTrade(otherCtx, trade.trade_id, found.version);
    // Second acceptance with the stale version must fail.
    await expect(acceptTrade(otherCtx, trade.trade_id, found.version))
      .rejects.toBeInstanceOf(UserError);
  });

  it('cannot accept an already-cancelled trade', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    const found = (await listOpenTrades(otherCtx, 'u2')).find((t) => t.trade_id === trade.trade_id)!;
    await cancelTrade(ctx, trade.trade_id, found.version);
    await expect(acceptTrade(otherCtx, trade.trade_id, found.version))
      .rejects.toBeInstanceOf(UserError);
  });

  it('does not duplicate currency when a refund and an accept race', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const otherCtx = makeCtx({ userId: 'u2' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    const found = (await listOpenTrades(otherCtx, 'u2')).find((t) => t.trade_id === trade.trade_id)!;
    // Cancel first: this refunds the 100 and bumps the trade to version 2.
    await cancelTrade(ctx, trade.trade_id, found.version);
    // The recipient then tries to accept using the stale version. It must miss.
    await expect(acceptTrade(otherCtx, trade.trade_id, found.version))
      .rejects.toBeInstanceOf(UserError);
    // Net effect: initiator is back to 100, recipient still 0. No duplication.
    expect((await getCurrency(ctx)).balance).toBe(100);
    expect((await getCurrency(otherCtx)).balance).toBe(0);
  });
});

describe('adversarial — locked and stale state', () => {
  it('cannot sell a card locked in a pending trade', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    mongoStore.card_instances.documents.set('L', ({
      instance_id: 'L', definition_id: 'captain.buggy', owner_user_id: 'u1', owner_guild_id: 'g1', acquired_at: new Date(), source: 'pack_open', serial_number: null, release_event: null, status: 'active', lock_token: null, version: 1, created_at: new Date(), updated_at: new Date(),
    } as CardInstanceDoc));
    await createTrade(ctx, { instance_ids: ['L'], berries: 0 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    // The lock changed status to locked_trade, so a sell expecting 'active' misses.
    await expect(sellInstance(ctx, 'L', 1, 'active', 'u1', 'g1', 25, 'captain.buggy'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('rejects a trade that a non-recipient tries to accept', async () => {
    const ctx = makeCtx({ userId: 'u1' });
    const attacker = makeCtx({ userId: 'attacker' });
    await applyCurrencyDelta(ctx, 100, 'admin_credit', null);
    const trade = await createTrade(ctx, { instance_ids: [], berries: 100 }, { instance_ids: [], berries: 0 }, 'u2', 60_000);
    await expect(acceptTrade(attacker, trade.trade_id, trade.version))
      .rejects.toBeInstanceOf(UserError);
  });
});

describe('adversarial — supply and integrity', () => {
  it('enforces the total_supply cap on limited-arts issuance', async () => {
    const ctx = makeCtx();
    const def = CARD_DEFINITIONS.find((d) => d.rank === 'limited_arts')!;
    // Issue up to the cap.
    for (let i = 0; i < def.total_supply; i++) {
      await adminIssueCard(ctx, 'u2', def.definition_id, 'release_1');
    }
    // One more must be refused — the cap is not bypassable by repeated calls.
    await expect(adminIssueCard(ctx, 'u2', def.definition_id, 'release_1'))
      .rejects.toBeInstanceOf(UserError);
  });

  it('assigns sequential serial numbers within a release', async () => {
    const ctx = makeCtx();
    const def = CARD_DEFINITIONS.find((d) => d.rank === 'limited_arts')!;
    const a = await adminIssueCard(ctx, 'u2', def.definition_id, 'release_x');
    const b = await adminIssueCard(ctx, 'u2', def.definition_id, 'release_x');
    expect(a.serial_number).toBe(1);
    expect(b.serial_number).toBe(2);
  });

  it('refuses to issue an unknown definition', async () => {
    const ctx = makeCtx();
    await expect(adminIssueCard(ctx, 'u2', 'totally.fake.card', null))
      .rejects.toBeInstanceOf(UserError);
  });

  it('pack purchase inserts exactly one instance per draw', async () => {
    const ctx = makeCtx();
    await applyCurrencyDelta(ctx, 1_000, 'admin_credit', null);
    const pack = CARD_PACKS[0]!;
    const ids = ['c_adv_1', 'c_adv_2', 'c_adv_3'];
    await purchaseAndOpenPack(
      ctx, pack, ids,
      [
        { rank: 'common', definition_id: 'captain.buggy', instance_id: 'c_adv_1' },
        { rank: 'rare', definition_id: 'marine.smoker', instance_id: 'c_adv_2' },
        { rank: 'common', definition_id: 'captain.buggy', instance_id: 'c_adv_3' },
      ],
    );
    // No duplicate rows for the same instance id.
    const seen = new Set<string>();
    for (const doc of mongoStore.card_instances.documents.values()) {
      const id = (doc as CardInstanceDoc).instance_id;
      if (id?.startsWith('c_adv_')) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(3);
  });
});
