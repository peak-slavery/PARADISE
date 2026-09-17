// ---------------------------------------------------------------------------
// /cardinfo — show details of a specific card instance.
// ---------------------------------------------------------------------------

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { CardInstanceDoc, CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { getDefinition } from '../lib/cards/catalog.js';
import { computeSellValue } from '../lib/cards/engine.js';
import { getInstance } from '../lib/cards/store.js';
import { cardEmbedFields } from '../lib/cards/render.js';

export const data = new SlashCommandBuilder()
  .setName('cardinfo')
  .setDescription('Show details of a specific card instance')
  .addStringOption((o) =>
    o.setName('instance_id')
      .setDescription('Card instance id (e.g. c_inst_xxxx)')
      .setRequired(true),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const instanceId = ctx.interaction.options.getString('instance_id', true);
  const inst = await getInstance(ctx, instanceId);
  if (!inst) throw new UserError('Card not found.');
  if (inst.owner_guild_id !== ctx.guildId) {
    throw new UserError('That card is not in this server.');
  }
  await renderInfo(ctx, inst);
}

export async function renderInfo(ctx: Ctx, inst: CardInstanceDoc): Promise<void> {
  const def = getDefinition(inst.definition_id);
  if (!def) {
    await ctx.warn('Definition missing', `Card \`${inst.instance_id}\` references an unknown definition.`);
    return;
  }
  const fields = cardEmbedFields({ instance: inst, definition: def, marketValue: computeSellValue(def) });
  const embed = new EmbedBuilder()
    .setColor(fields.color)
    .setTitle(fields.title)
    .setDescription(fields.description)
    .addFields(fields.fields)
    .setFooter({ text: fields.footer });
  if (fields.image) embed.setImage(fields.image);
  if (inst.status !== 'active') {
    embed.setDescription(
      `${fields.description}\n\n**Status:** \`${inst.status}\``,
    );
  }
  await ctx.replyEmbed(embed);
}
