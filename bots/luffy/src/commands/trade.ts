// ---------------------------------------------------------------------------
// /trade — create, accept, or cancel a card trade.
//
// Command subcommands:
//   /trade offer <recipient> <offered_instances> <requested_instances> [offered_berries] [requested_berries] [ttl_minutes]
//   /trade accept <trade_id>
//   /trade cancel <trade_id>
//
// Instance ids and trade ids are separated by space or comma. UserError is
// raised on bad input so the shared bot layer surfaces a clean 4xx-style reply.
// ---------------------------------------------------------------------------

import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { getDefinition } from '../lib/cards/catalog.js';
import {
  acceptTrade,
  cancelTrade,
  createTrade,
  getInstance,
  listOpenTrades,
} from '../lib/cards/store.js';

const DEFAULT_TTL_MIN = 30;
const MAX_TTL_MIN = 24 * 60;

function splitIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Create, accept, or cancel a card trade')
  .addSubcommand((s) =>
    s
      .setName('offer')
      .setDescription('Propose a trade to another player')
      .addUserOption((o) => o.setName('recipient').setDescription('Who to trade with').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('offered_instances')
          .setDescription('Space/comma separated instance ids you are offering')
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('requested_instances')
          .setDescription('Space/comma separated instance ids you want')
          .setRequired(false),
      )
      .addIntegerOption((o) =>
        o.setName('offered_berries').setDescription('Berries you are offering').setMinValue(0).setRequired(false),
      )
      .addIntegerOption((o) =>
        o.setName('requested_berries').setDescription('Berries you want').setMinValue(0).setRequired(false),
      )
      .addIntegerOption((o) =>
        o.setName('ttl_minutes')
          .setDescription('Minutes until expiry (default 30, max 1440)')
          .setMinValue(1)
          .setMaxValue(MAX_TTL_MIN)
          .setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('accept')
      .setDescription('Accept a pending trade addressed to you')
      .addStringOption((o) => o.setName('trade_id').setDescription('Trade id').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel a trade you initiated')
      .addStringOption((o) => o.setName('trade_id').setDescription('Trade id').setRequired(true)),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'offer') return offerTrade(ctx);
  if (sub === 'accept') return accept(ctx);
  if (sub === 'cancel') return cancel(ctx);
  throw new UserError('Unknown trade subcommand.');
}

async function offerTrade(ctx: Ctx): Promise<void> {
  const recipient = ctx.interaction.options.getUser('recipient', true);
  const offeredRaw = splitIds(ctx.interaction.options.getString('offered_instances'));
  const requestedRaw = splitIds(ctx.interaction.options.getString('requested_instances'));
  const offeredBerries = ctx.interaction.options.getInteger('offered_berries') ?? 0;
  const requestedBerries = ctx.interaction.options.getInteger('requested_berries') ?? 0;
  const ttl = (ctx.interaction.options.getInteger('ttl_minutes') ?? DEFAULT_TTL_MIN) * 60_000;
  if (offeredRaw.length === 0 && offeredBerries === 0) {
    throw new UserError('Offer at least one card or some berries.');
  }
  if (recipient.id === ctx.userId) {
    throw new UserError('You cannot trade with yourself.');
  }
  for (const id of offeredRaw) {
    const inst = await getInstance(ctx, id);
    if (!inst || inst.owner_user_id !== ctx.userId || inst.status !== 'active') {
      throw new UserError(`Card \`${id}\` is not an active card you own.`);
    }
    const def = getDefinition(inst.definition_id);
    if (!def || !def.is_tradeable) {
      throw new UserError(`Card \`${id}\` is not tradeable.`);
    }
  }
  for (const id of requestedRaw) {
    if (!/^c_inst_/.test(id)) throw new UserError(`\`${id}\` is not a valid card id.`);
  }
  const trade = await createTrade(
    ctx,
    { instance_ids: offeredRaw, berries: offeredBerries },
    { instance_ids: requestedRaw, berries: requestedBerries },
    recipient.id,
    ttl,
  );
  await ctx.success(
    'Trade offered',
    `Trade \`${trade.trade_id}\` sent to **${recipient.username}**. Offer expires at <t:${Math.floor(trade.expires_at.getTime() / 1000)}:F>.`,
  );
}

async function accept(ctx: Ctx): Promise<void> {
  const tradeId = ctx.interaction.options.getString('trade_id', true);
  // Trade doc version is monotonically 1 on creation, but we read it back to
  // use a robust CAS. We do not need the value, only the existence.
  const open = await listOpenTrades(ctx, ctx.userId);
  const existing = open.find((t) => t.trade_id === tradeId);
  if (!existing) throw new UserError('Trade not found or no longer pending.');
  const result = await acceptTrade(ctx, tradeId, existing.version);
  await ctx.success(
    'Trade accepted',
    `Trade complete. ${result.initiatorInstances.length + result.recipientInstances.length} card(s) exchanged.`,
  );
}

async function cancel(ctx: Ctx): Promise<void> {
  const tradeId = ctx.interaction.options.getString('trade_id', true);
  const open = await listOpenTrades(ctx, ctx.userId);
  const existing = open.find((t) => t.trade_id === tradeId);
  if (!existing) throw new UserError('Trade not found or already settled.');
  await cancelTrade(ctx, tradeId, existing.version);
  await ctx.success('Trade cancelled', `Trade \`${tradeId}\` was cancelled. Offered cards and berries are returned.`);
}
