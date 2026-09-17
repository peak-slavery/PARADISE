// ---------------------------------------------------------------------------
// /sell — sell one of your active card instances for its server-calculated value.
// ---------------------------------------------------------------------------

import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { getDefinition } from '../lib/cards/catalog.js';
import { computeSellValue } from '../lib/cards/engine.js';
import { getInstance, sellInstance } from '../lib/cards/store.js';

export const data = new SlashCommandBuilder()
  .setName('sell')
  .setDescription('Sell one of your cards for berries')
  .addStringOption((o) =>
    o.setName('instance_id').setDescription('Card instance id').setRequired(true),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const instanceId = ctx.interaction.options.getString('instance_id', true);
  const inst = await getInstance(ctx, instanceId);
  if (!inst) throw new UserError('Card not found.');
  if (inst.owner_guild_id !== ctx.guildId) {
    throw new UserError('That card is not in this server.');
  }
  if (inst.owner_user_id !== ctx.userId) {
    throw new UserError('You can only sell cards you own.');
  }
  if (inst.status !== 'active') {
    throw new UserError('Only active cards can be sold.');
  }
  const def = getDefinition(inst.definition_id);
  if (!def) throw new UserError('Card definition is missing.');
  if (!def.is_sellable) {
    throw new UserError(`${def.character} is not sellable.`);
  }
  const value = computeSellValue(def);
  const result = await sellInstance(
    ctx,
    inst.instance_id,
    inst.version,
    inst.status,
    inst.owner_user_id,
    inst.owner_guild_id,
    value,
    def.definition_id,
  );
  if (result.doc.status !== 'sold') {
    throw new UserError('Sale failed; the card is no longer active.');
  }
  await ctx.success(
    'Card sold',
    `**${def.character}** sold for **${value.toLocaleString('en-US')}** berries. New balance: **${result.txn.balance_after.toLocaleString('en-US')}** berries.`,
  );
}
