// ---------------------------------------------------------------------------
// /cardstats — collection statistics and current currency balance.
// ---------------------------------------------------------------------------

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { CardRank, CommandModule } from '@eiflow/shared';

import { CARD_DEFINITIONS, getDefinition } from '../lib/cards/catalog.js';
import { computeSellValue } from '../lib/cards/engine.js';
import { getCurrency, listInstances } from '../lib/cards/store.js';

const KNOWN_RANKS: CardRank[] = [
  'common', 'rare', 'elite', 'gold', 'ex', 'exx', 's', 'ss', 'sss_plus', 'diamond', 'limited_arts',
];

export const data = new SlashCommandBuilder()
  .setName('cardstats')
  .setDescription('Show collection statistics and berries balance')
  .addUserOption((o) => o.setName('user').setDescription('Inspect another user (optional)').setRequired(false));

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const target = ctx.interaction.options.getUser('user');
  const targetUserId = target?.id ?? ctx.userId;
  const isSelf = targetUserId === ctx.userId;
  // For other users we need a server-side lookup; fall back to a public totals-only view.
  const all = await listInstances(ctx, { status: 'active' });
  const instances = isSelf ? all : all.filter((i) => i.owner_user_id === targetUserId);
  if (instances.length === 0 && !isSelf && !target) {
    await ctx.info('No cards yet', 'You have not collected any cards.');
    return;
  }

  const byRank = new Map<CardRank, number>();
  let total = 0;
  for (const inst of instances) {
    const def = getDefinition(inst.definition_id);
    if (!def) continue;
    byRank.set(def.rank, (byRank.get(def.rank) ?? 0) + 1);
    total += computeSellValue(def);
  }

  // Catalog progress: how many unique definitions this player has at least one copy of.
  const ownedDefs = new Set(instances.map((i) => i.definition_id));
  const progressLines = KNOWN_RANKS.map((rank) => {
    const owned = ownedDefs
      ? CARD_DEFINITIONS.filter((d) => d.rank === rank)
          .map((d) => d.definition_id)
          .filter((id) => ownedDefs.has(id)).length
      : 0;
    const total = CARD_DEFINITIONS.filter((d) => d.rank === rank).length;
    const count = byRank.get(rank) ?? 0;
    return `**${rank.padEnd(13)}** ${count} cards · ${owned}/${total} unique`;
  });

  const cur = await getCurrency(ctx);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(isSelf ? 'Your collection' : `<@${targetUserId}>'s collection`)
    .addFields(
      { name: 'Active cards', value: String(instances.length), inline: true },
      { name: 'Estimated value', value: `${total.toLocaleString('en-US')} berries`, inline: true },
      { name: 'Berries', value: cur.balance.toLocaleString('en-US'), inline: true },
      { name: 'Catalog progress', value: progressLines.join('\n'), inline: false },
    )
    .setFooter({ text: `${ownedDefs.size}/${CARD_DEFINITIONS.length} unique definitions collected` });
  await ctx.replyEmbed(embed);
}
