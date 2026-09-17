// ---------------------------------------------------------------------------
// /open — purchase a pack, roll its cards, and reveal them.
// ---------------------------------------------------------------------------

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { CardInstanceDoc, CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { getPack } from '../lib/cards/catalog.js';
import { openPack } from '../lib/cards/engine.js';
import {
  getCurrency,
  purchaseAndOpenPack,
} from '../lib/cards/store.js';
import { cardEmbedFields } from '../lib/cards/render.js';
import { rarityFor } from '../lib/cards/rarity.js';

export const data = new SlashCommandBuilder()
  .setName('open')
  .setDescription('Open a card pack')
  .addStringOption((o) =>
    o.setName('pack_id')
      .setDescription('Pack id (standard, premium, legendary, event.seasonal)')
      .setRequired(true),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const packId = ctx.interaction.options.getString('pack_id', true);
  const pack = getPack(packId);
  if (!pack) throw new UserError('Unknown pack id.');
  await ctx.defer();
  if (pack.price > 0) {
    const cur = await getCurrency(ctx);
    if (cur.balance < pack.price) {
      throw new UserError(`You need ${pack.price.toLocaleString('en-US')} berries to open this pack.`);
    }
  }
  const roll = openPack(pack);
  const instanceIds = roll.draws.map(() => `c_inst_${Math.random().toString(16).slice(2, 18)}`);
  const draws = roll.draws.map((d, idx) => ({
    rank: d.rank,
    definition_id: d.definition.definition_id,
    instance_id: instanceIds[idx] as string,
  }));
  const created = await purchaseAndOpenPack(ctx, pack, instanceIds as string[], draws);
  const total = created.reduce<number>((acc, _inst, idx) => {
    const r = rarityFor(draws[idx]?.rank ?? 'common');
    return acc + r.baseValue;
  }, 0);
  await reveal(ctx, pack, created, total);
}

async function reveal(
  ctx: Ctx,
  pack: { display_name: string; price: number; card_count: number },
  instances: CardInstanceDoc[],
  totalBase: number,
): Promise<void> {
  const embeds: EmbedBuilder[] = [];
  for (const inst of instances) {
    const def = await import('../lib/cards/catalog.js').then((m) => m.getDefinition(inst.definition_id));
    if (!def) continue;
    const f = cardEmbedFields({ instance: inst, definition: def, marketValue: 0 });
    const e = new EmbedBuilder()
      .setColor(f.color)
      .setTitle(f.title)
      .setDescription(f.description)
      .addFields(f.fields)
      .setFooter({ text: f.footer });
    if (f.image) e.setImage(f.image);
    embeds.push(e);
  }
  const summary = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${pack.display_name} · ${instances.length} card(s)`)
    .setDescription(
      `Total base value: **${totalBase.toLocaleString('en-US')}** berries\nSpent: **${pack.price.toLocaleString('en-US')}** berries`,
    );
  await ctx.interaction.editReply({ embeds: [summary, ...embeds] });
}
