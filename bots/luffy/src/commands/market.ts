// ---------------------------------------------------------------------------
// /market — show the pack catalog with prices, sizes, and allowed rarities.
// ---------------------------------------------------------------------------

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';

import { CARD_PACKS } from '../lib/cards/catalog.js';
import { packEmbed } from '../lib/cards/render.js';
import { getCurrency } from '../lib/cards/store.js';

export const data = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Show the card-pack catalog');

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const cur = await getCurrency(ctx);
  const embeds: EmbedBuilder[] = [];
  for (const pack of CARD_PACKS) {
    const fields = packEmbed(pack);
    const e = new EmbedBuilder()
      .setColor(fields.color)
      .setTitle(fields.title)
      .setDescription(fields.description)
      .addFields(fields.fields);
    if (fields.image) e.setImage(fields.image);
    embeds.push(e);
  }
  const summary = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Card market')
    .setDescription(`Your balance: **${cur.balance.toLocaleString('en-US')}** berries. Pick a pack and use \`/open\`.`);
  await ctx.replyEmbed(summary);
  // Discord caps a single message at 10 embeds; send packs as a follow-up.
  for (const e of embeds) {
    await ctx.interaction.followUp({ embeds: [e], allowedMentions: { parse: [] } });
  }
}
