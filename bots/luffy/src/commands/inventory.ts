import { SlashCommandBuilder } from 'discord.js';
import { chunkFields, type CommandModule, truncateFieldValue } from '@eiflow/shared';
import { getInventory, runQueued } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('Show the items you have won');

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  const inventory = await runQueued(ctx, () => getInventory(ctx));

  if (inventory.items.length === 0) {
    await ctx.info('Inventory empty', 'Win a round with `/play` and drops will show up here.');
    return;
  }

  const total = inventory.items.reduce((sum, item) => sum + item.quantity, 0);
  const fields = inventory.items.map((item) => ({
    name: truncateFieldValue(item.name, 256),
    value: `\`${item.item_id}\` × ${item.quantity}`,
    inline: true,
  }));

  // Discord allows 25 fields per embed; a stacked inventory can exceed that.
  const [first = []] = chunkFields(fields, 25);

  await ctx.replyEmbed(
    ctx.services.embeds.brand(
      'Inventory',
      `**${total}** item(s) across **${inventory.items.length}** stack(s).`,
      { fields: first, footerSuffix: first.length < fields.length ? 'showing first 25 stacks' : undefined },
    ),
  );
}
