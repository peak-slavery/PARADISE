// ---------------------------------------------------------------------------
// /cards — show the player's active card collection (paginated, embedded).
// ---------------------------------------------------------------------------

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { ButtonContext, CardInstanceDoc, CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { getDefinition } from '../lib/cards/catalog.js';
import { computeSellValue } from '../lib/cards/engine.js';
import { listInstances, type CardCtx } from '../lib/cards/store.js';
import { collectionLine } from '../lib/cards/render.js';

const PAGE_SIZE = 8;
const KNOWN_RANKS = [
  'common', 'rare', 'elite', 'gold', 'ex', 'exx', 's', 'ss', 'sss_plus', 'diamond', 'limited_arts',
];

interface CardPageResult {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
  totalPages: number;
  page: number;
}

async function buildCardPage(
  ctx: CardCtx,
  page: number,
  rankFilter: string | null,
): Promise<CardPageResult> {
  const all = await listInstances(ctx, { status: 'active' });
  const filtered = rankFilter
    ? all.filter((i) => getDefinition(i.definition_id)?.rank === rankFilter)
    : all;
  if (filtered.length === 0) {
    throw new UserError('No cards match that filter.');
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const lines = slice.map((i: CardInstanceDoc) => {
    const def = getDefinition(i.definition_id);
    if (!def) return `\`${i.instance_id}\` · *unknown definition*`;
    return collectionLine({ instance: i, definition: def }, computeSellValue(def));
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Your collection · page ${safePage} / ${totalPages}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Total active cards: ${filtered.length} · filter: ${rankFilter ?? 'none'}` });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cards:page:${safePage - 1}:${rankFilter ?? ''}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`cards:page:${safePage + 1}:${rankFilter ?? ''}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages),
  );
  return { embed, components: [buttons], totalPages, page: safePage };
}

export const data = new SlashCommandBuilder()
  .setName('cards')
  .setDescription('Show your collectible card collection')
  .addIntegerOption((o) =>
    o.setName('page').setDescription('Page number (default 1)').setMinValue(1).setRequired(false),
  )
  .addStringOption((o) =>
    o.setName('rank').setDescription('Filter by rank').setRequired(false).addChoices(
      ...KNOWN_RANKS.map((rank) => ({ name: rank, value: rank })),
    ),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const page = ctx.interaction.options.getInteger('page') ?? 1;
  const rankFilter = ctx.interaction.options.getString('rank');
  await ctx.defer();
  const result = await buildCardPage(ctx, page, rankFilter);
  await ctx.interaction.editReply({ embeds: [result.embed], components: result.components });
}

export async function handleCardPagerButton(ctx: ButtonContext): Promise<boolean> {
  const id = ctx.interaction.customId;
  const m = /^cards:page:(\d+):(.*)$/.exec(id);
  if (!m) return false;
  const page = Number(m[1]);
  const rankFilter = m[2] || null;
  const result = await buildCardPage(ctx, page, rankFilter);
  await ctx.interaction.update({ embeds: [result.embed], components: result.components });
  return true;
}
