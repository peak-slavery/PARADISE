// ---------------------------------------------------------------------------
// /trades — list the pending trades visible to the player.
// ---------------------------------------------------------------------------

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { listOpenTrades } from '../lib/cards/store.js';

export const data = new SlashCommandBuilder()
  .setName('trades')
  .setDescription('List the trades you have open or are addressed to you');

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const trades = await listOpenTrades(ctx, ctx.userId);
  if (trades.length === 0) {
    await ctx.info('No open trades', 'Use `/trade offer` to start one.');
    return;
  }
  const lines = trades.slice(0, 25).map((t) => {
    const dir = t.initiator_id === ctx.userId ? '→ sent to' : '← from';
    const other = t.initiator_id === ctx.userId ? t.recipient_id : t.initiator_id;
    const cards = t.offered_instance_ids.length;
    const req = t.requested_instance_ids.length;
    const offerParts: string[] = [];
    if (cards) offerParts.push(`${cards} card${cards > 1 ? 's' : ''}`);
    if (t.offered_berries) offerParts.push(`${t.offered_berries.toLocaleString('en-US')}b`);
    const reqParts: string[] = [];
    if (req) reqParts.push(`${req} card${req > 1 ? 's' : ''}`);
    if (t.requested_berries) reqParts.push(`${t.requested_berries.toLocaleString('en-US')}b`);
    const offer = offerParts.length ? offerParts.join(' + ') : 'nothing';
    const reqStr = reqParts.length ? reqParts.join(' + ') : 'nothing';
    return `\`${t.trade_id}\` ${dir} <@${other}> · offer ${offer} ↔ want ${reqStr}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Open trades · ${trades.length}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Use /trade accept <id> or /trade cancel <id>' });
  await ctx.replyEmbed(embed);
}
