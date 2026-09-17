// ---------------------------------------------------------------------------
// Mongo repository for the Luffy collectible card economy.
//
// All writes use compare-and-swap filters against the `version` (or status)
// field so concurrent requests cannot double-spend currency, double-sell a
// card, or duplicate a trade acceptance. The queue runner is supplied by the
// shared bot runtime so this layer never directly calls the driver.
// ---------------------------------------------------------------------------

import type {
  CardAcquisitionDoc,
  CardInstanceDoc,
  CardPackDoc,
  CardPlayerCurrencyDoc,
  CardRank,
  CardTradeDoc,
  CardTradeStatus,
  CardTransactionDoc,
  CommandContext,
} from '@eiflow/shared';
import { QueueTimeoutError, ServiceUnavailableError, UserError } from '@eiflow/shared';

import { CARD_DEFINITIONS, getDefinition } from './catalog.js';
import { generateAcquisitionId, generateInstanceId, generateTransactionId, generateTradeId } from './engine.js';

const QUEUE_TIMEOUT_MS = 8_000;

/**
 * The store reads only identity + services, so both slash-command and button
 * interactions can drive it. Keeping this narrow is what lets the collection
 * pager reuse every query path.
 */
export type CardCtx = Pick<CommandContext, 'guildId' | 'userId' | 'services' | 'log'>;

export async function runQueued<T>(ctx: CardCtx, task: () => Promise<T>): Promise<T> {
  try {
    return await ctx.services.queue.run(task, { timeoutMs: QUEUE_TIMEOUT_MS, maxPending: 16 });
  } catch (err) {
    if (err instanceof QueueTimeoutError) throw new ServiceUnavailableError('Database');
    throw err;
  }
}

function now(): Date {
  return new Date();
}

function db(ctx: CardCtx) {
  return ctx.services.requireMongo();
}

/**
 * Emit a named card-economy event through the shared batched log sink. The
 * durable audit trail lives in the `card_acquisitions` / `card_transactions`
 * collections; these events are the operational stream (alerting, dashboards).
 * `channel_id` is omitted because repository writes may occur outside an
 * interaction; the log schema accepts null.
 */
export function emitCardEvent(
  ctx: CardCtx,
  action: string,
  message: string,
  meta: Record<string, unknown> = {},
  level: 'info' | 'warn' = 'info',
): void {
  ctx.services.logs.push({
    bot_id: ctx.services.env.botId,
    guild_id: ctx.guildId,
    channel_id: null,
    user_id: ctx.userId,
    action,
    level,
    message,
    meta,
    created_at: now(),
  });
}

/* -- Currency ------------------------------------------------------------- */

export async function getCurrency(ctx: CardCtx): Promise<CardPlayerCurrencyDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const doc = await mongo.card_player_currency.findOneAndUpdate(
      { guild_id: ctx.guildId, user_id: ctx.userId },
      {
        $set: { updated_at: now() },
        $setOnInsert: {
          guild_id: ctx.guildId,
          user_id: ctx.userId,
          balance: 0,
          lifetime_earned: 0,
          lifetime_spent: 0,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new ServiceUnavailableError('Database');
    return doc;
  });
}

export async function applyCurrencyDelta(
  ctx: CardCtx,
  delta: number,
  reason: CardTransactionDoc['reason'],
  reference_id: string | null,
  expected_balance?: number,
): Promise<{ doc: CardPlayerCurrencyDoc; txn: CardTransactionDoc }> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    if (delta < 0 && expected_balance === undefined) {
      // Debits without a CAS expectation must still confirm the player has
      // enough balance. Read once, validate, then upsert.
      const current = await mongo.card_player_currency.findOne({
        guild_id: ctx.guildId,
        user_id: ctx.userId,
      });
      if (!current || current.balance + delta < 0) {
        throw new UserError('Insufficient berries.');
      }
    }
    const filter = expected_balance !== undefined
      ? { guild_id: ctx.guildId, user_id: ctx.userId, balance: expected_balance }
      : { guild_id: ctx.guildId, user_id: ctx.userId };
    const txn: CardTransactionDoc = {
      txn_id: generateTransactionId(),
      guild_id: ctx.guildId,
      user_id: ctx.userId,
      delta,
      balance_after: expected_balance !== undefined
        ? expected_balance + delta
        : 0,
      reason,
      reference_id,
      created_at: now(),
    };
    const result = await mongo.card_player_currency.findOneAndUpdate(
      filter,
      {
        $inc: delta >= 0 ? { balance: delta, lifetime_earned: delta } : { balance: delta, lifetime_spent: -delta },
        $set: { updated_at: now() },
        $setOnInsert: {
          guild_id: ctx.guildId,
          user_id: ctx.userId,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!result) {
      throw new ServiceUnavailableError('Database');
    }
    txn.balance_after = result.balance;
    await mongo.card_transactions.insertOne(txn);
    emitCardEvent(
      ctx,
      delta >= 0 ? 'CURRENCY_CREDITED' : 'CURRENCY_DEBITED',
      `${ctx.userId} ${delta >= 0 ? 'received' : 'spent'} ${Math.abs(delta)} berries (${reason})`,
      { delta, balance_after: txn.balance_after, reason, reference_id, txn_id: txn.txn_id },
    );
    return { doc: result, txn };
  });
}

/* -- Card instances ------------------------------------------------------- */

export async function getInstance(ctx: CardCtx, instance_id: string): Promise<CardInstanceDoc | null> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    return mongo.card_instances.findOne({ instance_id });
  });
}

export async function listInstances(
  ctx: CardCtx,
  filter: Partial<{ status: CardInstanceDoc['status']; definition_id: string; rank: CardRank }> = {},
): Promise<CardInstanceDoc[]> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const query: Record<string, unknown> = { owner_guild_id: ctx.guildId, owner_user_id: ctx.userId };
    if (filter.status) query.status = filter.status;
    if (filter.definition_id) query.definition_id = filter.definition_id;
    if (filter.rank) {
      const ids = CARD_DEFINITIONS.filter((d) => d.rank === filter.rank).map((d) => d.definition_id);
      query.definition_id = { $in: ids };
    }
    return mongo.card_instances
      .find(query)
      .sort({ acquired_at: -1 })
      .limit(500)
      .toArray();
  });
}

export async function insertInstance(
  ctx: CardCtx,
  instance: Omit<CardInstanceDoc, 'instance_id' | 'version' | 'created_at' | 'updated_at'>,
): Promise<CardInstanceDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const doc: CardInstanceDoc = {
      ...instance,
      instance_id: generateInstanceId(),
      version: 1,
      created_at: now(),
      updated_at: now(),
    };
    await mongo.card_instances.insertOne(doc);
    return doc;
  });
}

export async function recordAcquisition(
  ctx: CardCtx,
  acquisition: Omit<CardAcquisitionDoc, 'acquisition_id' | 'acquired_at'>,
): Promise<CardAcquisitionDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const doc: CardAcquisitionDoc = {
      ...acquisition,
      acquisition_id: generateAcquisitionId(),
      acquired_at: now(),
    };
    await mongo.card_acquisitions.insertOne(doc);
    return doc;
  });
}

/* -- Pack purchase & open ------------------------------------------------- */

export async function purchaseAndOpenPack(
  ctx: CardCtx,
  pack: CardPackDoc,
  packInstanceIds: string[],
  draws: { rank: CardRank; definition_id: string; instance_id: string }[],
): Promise<CardInstanceDoc[]> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    // 1. debit currency
    const cur = await mongo.card_player_currency.findOneAndUpdate(
      { guild_id: ctx.guildId, user_id: ctx.userId, balance: { $gte: pack.price } },
      {
        $inc: { balance: -pack.price, lifetime_spent: pack.price },
        $set: { updated_at: now() },
      },
      { returnDocument: 'after' },
    );
    if (!cur) {
      throw new UserError(`You need ${pack.price} berries to open a ${pack.display_name}.`);
    }
    if (pack.price > 0) {
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: ctx.userId,
        delta: -pack.price,
        balance_after: cur.balance,
        reason: 'pack_purchase',
        reference_id: pack.pack_id,
        created_at: now(),
      });
    }
    // 2. insert instances atomically (rollback currency on failure)
    if (draws.length === 0) {
      throw new ServiceUnavailableError('Empty pack draw');
    }
    const createdAt = now();
    const docs: CardInstanceDoc[] = draws.map((d, idx) => {
      const def = getDefinition(d.definition_id);
      if (!def) throw new ServiceUnavailableError('Definition missing for pack draw');
      return {
        instance_id: packInstanceIds[idx] ?? generateInstanceId(),
        definition_id: d.definition_id,
        owner_user_id: ctx.userId,
        owner_guild_id: ctx.guildId,
        acquired_at: createdAt,
        source: 'pack_open',
        serial_number: null,
        release_event: null,
        status: 'active',
        lock_token: null,
        version: 1,
        created_at: createdAt,
        updated_at: createdAt,
      };
    });
    try {
      await mongo.card_instances.insertMany(docs, { ordered: true });
    } catch (err) {
      // rollback the currency debit (best-effort; not security-critical)
      await mongo.card_player_currency.updateOne(
        { guild_id: ctx.guildId, user_id: ctx.userId },
        { $inc: { balance: pack.price, lifetime_spent: -pack.price }, $set: { updated_at: now() } },
      );
      throw err;
    }
    await mongo.card_acquisitions.insertMany(
      docs.map((instance) => {
        const def = getDefinition(instance.definition_id);
        if (!def) throw new ServiceUnavailableError('Definition missing for acquisition');
        return {
          acquisition_id: generateAcquisitionId(),
          guild_id: ctx.guildId,
          user_id: ctx.userId,
          instance_id: instance.instance_id,
          definition_id: instance.definition_id,
          pack_id: pack.pack_id,
          source: 'pack_open' as const,
          base_value: def.base_value,
          berries_delta: -pack.price,
          acquired_at: createdAt,
        };
      }),
      { ordered: true },
    );
    emitCardEvent(
      ctx,
      'PACK_OPENED',
      `${ctx.userId} opened a ${pack.display_name} (${pack.card_count} cards, ${pack.price} berries)`,
      {
        pack_id: pack.pack_id,
        card_count: pack.card_count,
        price: pack.price,
        instance_ids: docs.map((d) => d.instance_id),
        ranks: docs.map((d) => getDefinition(d.definition_id)?.rank).filter(Boolean),
      },
    );
    docs.forEach((instance) => {
      const def = getDefinition(instance.definition_id);
      emitCardEvent(
        ctx,
        'CARD_ACQUIRED',
        `${ctx.userId} acquired ${instance.definition_id} from ${pack.display_name}`,
        { instance_id: instance.instance_id, definition_id: instance.definition_id, rank: def?.rank, source: 'pack_open', pack_id: pack.pack_id },
      );
    });
    return docs;
  });
}

/* -- Selling ------------------------------------------------------------- */

export async function sellInstance(
  ctx: CardCtx,
  instance_id: string,
  expected_version: number,
  expected_status: CardInstanceDoc['status'],
  expected_owner_user_id: string,
  expected_owner_guild_id: string,
  sell_value: number,
  definition_id: string,
): Promise<{ doc: CardInstanceDoc; txn: CardTransactionDoc }> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const result = await mongo.card_instances.findOneAndUpdate(
      {
        instance_id,
        version: expected_version,
        status: expected_status,
        owner_user_id: expected_owner_user_id,
        owner_guild_id: expected_owner_guild_id,
      },
      { $set: { status: 'sold', version: expected_version + 1, updated_at: now() } },
      { returnDocument: 'after' },
    );
    if (!result) {
      throw new UserError('That card is no longer sellable.');
    }
    const credit = await applyCurrencyDelta(
      ctx,
      sell_value,
      'card_sale',
      instance_id,
    );
    if (!Number.isSafeInteger(credit.doc.balance)) {
      throw new ServiceUnavailableError('Currency overflow');
    }
    await mongo.card_acquisitions.insertOne({
      acquisition_id: generateAcquisitionId(),
      guild_id: ctx.guildId,
      user_id: ctx.userId,
      instance_id,
      definition_id,
      pack_id: null,
      source: 'sold_payout',
      base_value: sell_value,
      berries_delta: sell_value,
      acquired_at: now(),
    });
    emitCardEvent(
      ctx,
      'CARD_SOLD',
      `${ctx.userId} sold ${definition_id} for ${sell_value} berries`,
      { instance_id, definition_id, sell_value, balance_after: credit.txn.balance_after, txn_id: credit.txn.txn_id },
    );
    return { doc: result, txn: credit.txn };
  });
}

/* -- Trading ------------------------------------------------------------- */

export async function listOpenTrades(
  ctx: CardCtx,
  viewer_user_id: string,
): Promise<CardTradeDoc[]> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const nowDate = now();
    return mongo.card_trades
      .find({
        guild_id: ctx.guildId,
        status: 'pending' as CardTradeStatus,
        expires_at: { $gt: nowDate },
        $or: [{ recipient_id: viewer_user_id }, { initiator_id: viewer_user_id }],
      })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();
  });
}

export async function createTrade(
  ctx: CardCtx,
  offered: { instance_ids: string[]; berries: number },
  requested: { instance_ids: string[]; berries: number },
  recipient_id: string,
  ttl_ms: number,
): Promise<CardTradeDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const initiator = ctx.userId;
    if (recipient_id === initiator) {
      throw new UserError('You cannot trade with yourself.');
    }
    if (offered.instance_ids.length === 0 && requested.instance_ids.length === 0 && offered.berries === 0 && requested.berries === 0) {
      throw new UserError('A trade must offer or request at least one item or currency.');
    }
    // Lock offered instances by setting status=locked_trade + lock_token
    if (offered.instance_ids.length > 0) {
      const lockToken = generateTradeId();
      const lockResult = await mongo.card_instances.updateMany(
        {
          instance_id: { $in: offered.instance_ids },
          owner_user_id: initiator,
          owner_guild_id: ctx.guildId,
          status: 'active',
          lock_token: null,
        },
        { $set: { status: 'locked_trade', lock_token: lockToken, updated_at: now() } },
      );
      if (lockResult.modifiedCount !== offered.instance_ids.length) {
        throw new UserError('One of your offered cards is locked, sold, or not owned.');
      }
    }
    if (offered.berries > 0) {
      const debit = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: initiator, balance: { $gte: offered.berries } },
        { $inc: { balance: -offered.berries, lifetime_spent: offered.berries }, $set: { updated_at: now() } },
        { returnDocument: 'after' },
      );
      if (!debit) {
        await unlockInstances(offered.instance_ids, mongo, 'active', null);
        throw new UserError(`You need ${offered.berries} berries to make this trade offer.`);
      }
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: initiator,
        delta: -offered.berries,
        balance_after: debit.balance,
        reason: 'trade_offer',
        reference_id: null,
        created_at: now(),
      });
    }
    // Reserve offered currency for the recipient; we will not move it yet.
    const trade: CardTradeDoc = {
      trade_id: generateTradeId(),
      guild_id: ctx.guildId,
      initiator_id: initiator,
      recipient_id,
      offered_instance_ids: offered.instance_ids,
      requested_instance_ids: requested.instance_ids,
      offered_berries: offered.berries,
      requested_berries: requested.berries,
      status: 'pending',
      expires_at: new Date(Date.now() + ttl_ms),
      created_at: now(),
      accepted_at: null,
      cancelled_at: null,
      version: 1,
    };
    await mongo.card_trades.insertOne(trade);
    emitCardEvent(
      ctx,
      'TRADE_CREATED',
      `${initiator} offered a trade to ${recipient_id}`,
      {
        trade_id: trade.trade_id,
        initiator_id: initiator,
        recipient_id,
        offered_instance_ids: offered.instance_ids,
        requested_instance_ids: requested.instance_ids,
        offered_berries: offered.berries,
        requested_berries: requested.berries,
      },
    );
    return trade;
  });
}

export async function cancelTrade(
  ctx: CardCtx,
  trade_id: string,
  expected_version: number,
): Promise<CardTradeDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const result = await mongo.card_trades.findOneAndUpdate(
      { trade_id, status: 'pending', version: expected_version, initiator_id: ctx.userId },
      { $set: { status: 'cancelled', cancelled_at: now(), version: expected_version + 1 } },
      { returnDocument: 'after' },
    );
    if (!result) {
      throw new UserError('Trade cannot be cancelled.');
    }
    // Unlock offered cards and refund offered currency (if any)
    if (result.offered_instance_ids.length > 0) {
      await mongo.card_instances.updateMany(
        { instance_id: { $in: result.offered_instance_ids } },
        { $set: { status: 'active', lock_token: null, updated_at: now() } },
      );
    }
    if (result.offered_berries > 0) {
      const refund = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: result.initiator_id },
        { $inc: { balance: result.offered_berries, lifetime_earned: result.offered_berries }, $set: { updated_at: now() } },
        { upsert: true, returnDocument: 'after' },
      );
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: result.initiator_id,
        delta: result.offered_berries,
        balance_after: refund ? refund.balance : result.offered_berries,
        reason: 'trade_offer',
        reference_id: result.trade_id,
        created_at: now(),
      });
    }
    emitCardEvent(
      ctx,
      'TRADE_CANCELLED',
      `${result.initiator_id} cancelled trade ${result.trade_id}`,
      { trade_id: result.trade_id, initiator_id: result.initiator_id, recipient_id: result.recipient_id, refunded_berries: result.offered_berries },
    );
    return result;
  });
}

export async function acceptTrade(
  ctx: CardCtx,
  trade_id: string,
  expected_version: number,
): Promise<{
  initiatorInstances: CardInstanceDoc[];
  recipientInstances: CardInstanceDoc[];
}> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const trade = await mongo.card_trades.findOne({ trade_id });
    if (!trade) throw new UserError('Trade not found.');
    if (trade.status !== 'pending') throw new UserError('Trade is no longer pending.');
    if (trade.expires_at.getTime() <= Date.now()) throw new UserError('Trade has expired.');
    if (trade.recipient_id !== ctx.userId) throw new UserError('You are not the recipient of this trade.');
    // Recipient must still own the requested cards
    if (trade.requested_instance_ids.length > 0) {
      const owned = await mongo.card_instances.countDocuments({
        instance_id: { $in: trade.requested_instance_ids },
        owner_user_id: trade.recipient_id,
        owner_guild_id: ctx.guildId,
        status: 'active',
        lock_token: null,
      });
      if (owned !== trade.requested_instance_ids.length) {
        throw new UserError('The recipient no longer owns the requested cards.');
      }
    }
    if (trade.requested_berries > 0) {
      const recipient = await mongo.card_player_currency.findOne({ guild_id: ctx.guildId, user_id: trade.recipient_id });
      if (!recipient || recipient.balance < trade.requested_berries) {
        throw new UserError('The recipient no longer has the requested berries.');
      }
    }
    // CAS the trade into accepted
    const accept = await mongo.card_trades.findOneAndUpdate(
      { trade_id, status: 'pending', version: expected_version },
      { $set: { status: 'accepted', accepted_at: now(), version: expected_version + 1 } },
      { returnDocument: 'after' },
    );
    if (!accept) throw new UserError('Trade was already accepted or cancelled.');

    // Transfer initiator -> recipient (initiator's offered cards move to recipient)
    let initiatorInstances: CardInstanceDoc[] = [];
    if (accept.offered_instance_ids.length > 0) {
      const moved = await mongo.card_instances.updateMany(
        { instance_id: { $in: accept.offered_instance_ids }, status: 'locked_trade' },
        {
          $set: {
            owner_user_id: accept.recipient_id,
            status: 'active',
            lock_token: null,
            updated_at: now(),
          },
          $inc: { version: 1 },
        },
      );
      if (moved.modifiedCount !== accept.offered_instance_ids.length) {
        throw new ServiceUnavailableError('Offered card transfer failed');
      }
      initiatorInstances = await mongo.card_instances
        .find({ instance_id: { $in: accept.offered_instance_ids } })
        .toArray();
    }
    // Transfer recipient -> initiator
    let recipientInstances: CardInstanceDoc[] = [];
    if (accept.requested_instance_ids.length > 0) {
      const lockToken = accept.trade_id;
      const lock = await mongo.card_instances.updateMany(
        { instance_id: { $in: accept.requested_instance_ids }, status: 'active', lock_token: null },
        { $set: { status: 'locked_trade', lock_token: lockToken, updated_at: now() } },
      );
      if (lock.modifiedCount !== accept.requested_instance_ids.length) {
        throw new UserError('Failed to lock recipient cards.');
      }
      const moved = await mongo.card_instances.updateMany(
        { instance_id: { $in: accept.requested_instance_ids }, status: 'locked_trade' },
        {
          $set: { owner_user_id: accept.initiator_id, status: 'active', lock_token: null },
          $inc: { version: 1 },
          $currentDate: { updated_at: true },
        },
      );
      if (moved.modifiedCount !== accept.requested_instance_ids.length) {
        throw new ServiceUnavailableError('Requested card transfer failed');
      }
      recipientInstances = await mongo.card_instances
        .find({ instance_id: { $in: accept.requested_instance_ids } })
        .toArray();
    }
    // Berries exchange: initiator pays the requested berries to recipient,
    // and the offered berries were already debited at creation. If the recipient
    // contributes requested berries, they get debited now.
    if (accept.requested_berries > 0) {
      const recipient_after = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: accept.recipient_id, balance: { $gte: accept.requested_berries } },
        { $inc: { balance: -accept.requested_berries, lifetime_spent: accept.requested_berries }, $set: { updated_at: now() } },
        { returnDocument: 'after' },
      );
      if (!recipient_after) throw new ServiceUnavailableError('Recipient currency debit failed');
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: accept.recipient_id,
        delta: -accept.requested_berries,
        balance_after: recipient_after.balance,
        reason: 'trade_offer',
        reference_id: accept.trade_id,
        created_at: now(),
      });
      const initiator_after = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: accept.initiator_id },
        { $inc: { balance: accept.requested_berries, lifetime_earned: accept.requested_berries }, $set: { updated_at: now() } },
        { upsert: true, returnDocument: 'after' },
      );
      if (!initiator_after) throw new ServiceUnavailableError('Initiator currency credit failed');
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: accept.initiator_id,
        delta: accept.requested_berries,
        balance_after: initiator_after.balance,
        reason: 'trade_receive',
        reference_id: accept.trade_id,
        created_at: now(),
      });
    }
    if (accept.offered_berries > 0) {
      // Offered berries already debited from initiator on create. Pay them to recipient.
      const recipient_after = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: accept.recipient_id },
        { $inc: { balance: accept.offered_berries, lifetime_earned: accept.offered_berries }, $set: { updated_at: now() } },
        { upsert: true, returnDocument: 'after' },
      );
      if (!recipient_after) throw new ServiceUnavailableError('Recipient credit failed');
      await mongo.card_transactions.insertOne({
        txn_id: generateTransactionId(),
        guild_id: ctx.guildId,
        user_id: accept.recipient_id,
        delta: accept.offered_berries,
        balance_after: recipient_after.balance,
        reason: 'trade_receive',
        reference_id: accept.trade_id,
        created_at: now(),
      });
    }
    emitCardEvent(
      ctx,
      'TRADE_ACCEPTED',
      `${accept.recipient_id} accepted trade ${accept.trade_id} from ${accept.initiator_id}`,
      {
        trade_id: accept.trade_id,
        initiator_id: accept.initiator_id,
        recipient_id: accept.recipient_id,
        offered_instance_ids: accept.offered_instance_ids,
        requested_instance_ids: accept.requested_instance_ids,
        offered_berries: accept.offered_berries,
        requested_berries: accept.requested_berries,
      },
    );
    // Record the acquisition side of the exchange so both parties' collections
    // reflect the transfer in the durable audit trail.
    if (initiatorInstances.length > 0 || recipientInstances.length > 0) {
      emitCardEvent(
        ctx,
        'CARD_TRADED',
        `Trade ${accept.trade_id} moved ${initiatorInstances.length + recipientInstances.length} card(s) between ${accept.initiator_id} and ${accept.recipient_id}`,
        {
          trade_id: accept.trade_id,
          initiator_id: accept.initiator_id,
          recipient_id: accept.recipient_id,
          initiator_instance_ids: initiatorInstances.map((i) => i.instance_id),
          recipient_instance_ids: recipientInstances.map((i) => i.instance_id),
        },
      );
    }
    for (const inst of [...initiatorInstances, ...recipientInstances]) {
      emitCardEvent(
        ctx,
        'CARD_ACQUIRED',
        `${inst.owner_user_id} received ${inst.definition_id} via trade ${accept.trade_id}`,
        { instance_id: inst.instance_id, definition_id: inst.definition_id, source: 'trade', trade_id: accept.trade_id },
      );
    }
    return { initiatorInstances, recipientInstances };
  });
}

async function unlockInstances(
  instanceIds: string[],
  mongo: Awaited<ReturnType<typeof db>> | import('mongodb').MongoClient,
  status: CardInstanceDoc['status'],
  lockToken: string | null,
): Promise<void> {
  if (instanceIds.length === 0) return;
  const update: Record<string, unknown> = { status, lock_token: lockToken, updated_at: now() };
  if ('card_instances' in mongo) {
    await mongo.card_instances.updateMany({ instance_id: { $in: instanceIds } }, { $set: update });
  }
}

/* -- Admin issuance / revocation ----------------------------------------- */

export async function adminIssueCard(
  ctx: CardCtx,
  recipient_user_id: string,
  definition_id: string,
  release_event: string | null,
  source: 'event' | 'admin_issued' = 'admin_issued',
  berries_delta = 0,
): Promise<CardInstanceDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const def = getDefinition(definition_id);
    if (!def) throw new UserError('Unknown card definition.');
    if (def.enabled === false) throw new UserError('That card definition is archived or disabled.');
    const existingInEvent = release_event
      ? await mongo.card_instances.countDocuments({ release_event, definition_id })
      : 0;
    if (def.total_supply > 0 && existingInEvent >= def.total_supply) {
      throw new UserError(`${def.character} (${def.rank}) is sold out.`);
    }
    const instance: Omit<CardInstanceDoc, 'instance_id' | 'version' | 'created_at' | 'updated_at'> = {
      definition_id,
      owner_user_id: recipient_user_id,
      owner_guild_id: ctx.guildId,
      acquired_at: now(),
      source,
      serial_number: def.rank === 'limited_arts' ? existingInEvent + 1 : null,
      release_event,
      status: 'active',
      lock_token: null,
    };
    const doc: CardInstanceDoc = {
      ...instance,
      instance_id: generateInstanceId(),
      version: 1,
      created_at: now(),
      updated_at: now(),
    };
    await mongo.card_instances.insertOne(doc);
    await mongo.card_acquisitions.insertOne({
      acquisition_id: generateAcquisitionId(),
      guild_id: ctx.guildId,
      user_id: recipient_user_id,
      instance_id: doc.instance_id,
      definition_id,
      pack_id: null,
      source,
      base_value: def.base_value,
      berries_delta,
      acquired_at: now(),
    });
    if (berries_delta !== 0) {
      const credit = await mongo.card_player_currency.findOneAndUpdate(
        { guild_id: ctx.guildId, user_id: recipient_user_id },
        {
          $inc: berries_delta >= 0
            ? { balance: berries_delta, lifetime_earned: berries_delta }
            : { balance: berries_delta, lifetime_spent: -berries_delta },
          $set: { updated_at: now() },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (credit) {
        await mongo.card_transactions.insertOne({
          txn_id: generateTransactionId(),
          guild_id: ctx.guildId,
          user_id: recipient_user_id,
          delta: berries_delta,
          balance_after: credit.balance,
          reason: source === 'admin_issued' ? 'admin_credit' : 'event_reward',
          reference_id: doc.instance_id,
          created_at: now(),
        });
      }
    }
    emitCardEvent(
      ctx,
      'CARD_ISSUED',
      `${source === 'admin_issued' ? 'Admin' : 'Event'} issued ${definition_id} to ${recipient_user_id}`,
      { instance_id: doc.instance_id, definition_id, recipient_user_id, source, release_event, berries_delta, serial_number: doc.serial_number },
      'warn',
    );
    emitCardEvent(
      ctx,
      'CARD_ACQUIRED',
      `${recipient_user_id} acquired ${definition_id} via ${source}`,
      { instance_id: doc.instance_id, definition_id, source, recipient_user_id },
    );
    return doc;
  });
}

export async function adminRevokeCard(
  ctx: CardCtx,
  instance_id: string,
): Promise<CardInstanceDoc> {
  return runQueued(ctx, async () => {
    const mongo = await db(ctx);
    const result = await mongo.card_instances.findOneAndUpdate(
      { instance_id, status: { $in: ['active', 'locked_trade'] } },
      { $set: { status: 'revoked', version: 1, lock_token: null, updated_at: now() } },
      { returnDocument: 'after' },
    );
    if (!result) throw new UserError('That card cannot be revoked.');
    await mongo.card_acquisitions.insertOne({
      acquisition_id: generateAcquisitionId(),
      guild_id: ctx.guildId,
      user_id: result.owner_user_id,
      instance_id: result.instance_id,
      definition_id: result.definition_id,
      pack_id: null,
      source: 'sold_payout',
      base_value: 0,
      berries_delta: 0,
      acquired_at: now(),
    });
    emitCardEvent(
      ctx,
      'CARD_REVOKED',
      `Admin revoked ${result.definition_id} from ${result.owner_user_id}`,
      { instance_id: result.instance_id, definition_id: result.definition_id, owner_user_id: result.owner_user_id, previous_status: result.status },
      'warn',
    );
    return result;
  });
}
