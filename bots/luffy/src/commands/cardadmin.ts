// ---------------------------------------------------------------------------
// /cardadmin — privileged issuance / revocation of card instances.
//
// Authorization: the existing shared `services.isOwner` check. No privileged
// Discord id is hardcoded in this file — operator identity flows from
// OWNER_IDS / MASTER_DISCORD_ID, and admin issuance is logged for audit.
// ---------------------------------------------------------------------------

import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { UserError } from '@eiflow/shared';

import { CARD_DEFINITIONS } from '../lib/cards/catalog.js';
import { adminIssueCard, adminRevokeCard, getInstance } from '../lib/cards/store.js';

function requireAdmin(ctx: Parameters<CommandModule['execute']>[0]): void {
  if (!ctx.services.isOwner(ctx.userId)) {
    throw new UserError('Only the master operator can run this command.');
  }
}

export const data = new SlashCommandBuilder()
  .setName('cardadmin')
  .setDescription('Administrative card issuance and revocation (master operator only)')
  .addSubcommand((s) =>
    s
      .setName('issue')
      .setDescription('Issue a card instance to a user')
      .addUserOption((o) => o.setName('recipient').setDescription('Who to issue to').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('definition_id')
          .setDescription('Card definition id')
          .setRequired(true)
          .addChoices(...CARD_DEFINITIONS.map((d) => ({ name: `${d.character} (${d.rank})`, value: d.definition_id }))),
      )
      .addStringOption((o) =>
        o.setName('release_event').setDescription('Optional release event name').setRequired(false),
      )
      .addIntegerOption((o) =>
        o.setName('berries').setDescription('Berries to credit alongside the card (default 0)').setMinValue(0).setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('revoke')
      .setDescription('Revoke a card instance from circulation')
      .addStringOption((o) => o.setName('instance_id').setDescription('Card instance id').setRequired(true)),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

export async function execute(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'issue') return issue(ctx);
  if (sub === 'revoke') return revoke(ctx);
  throw new UserError('Unknown cardadmin subcommand.');
}

async function issue(ctx: Ctx): Promise<void> {
  const recipient = ctx.interaction.options.getUser('recipient', true);
  const definitionId = ctx.interaction.options.getString('definition_id', true);
  const releaseEvent = ctx.interaction.options.getString('release_event') || null;
  const berries = ctx.interaction.options.getInteger('berries') ?? 0;
  await ctx.defer();
  const doc = await adminIssueCard(ctx, recipient.id, definitionId, releaseEvent, 'admin_issued', berries);
  ctx.services.logs.push({
    bot_id: ctx.services.env.botId,
    guild_id: ctx.guildId,
    channel_id: ctx.interaction.channelId,
    user_id: ctx.userId,
    action: 'card.admin.issue',
    level: 'warn',
    message: `admin ${ctx.userId} issued ${definitionId} → ${recipient.id}`,
    meta: { instance_id: doc.instance_id, definition_id: doc.definition_id, release_event: releaseEvent, berries },
    created_at: new Date(),
  });
  await ctx.success(
    'Card issued',
    `Issued **${definitionId}** (\`${doc.instance_id}\`) to <@${recipient.id}>${releaseEvent ? ` · release \`${releaseEvent}\`` : ''}.`,
  );
}

async function revoke(ctx: Ctx): Promise<void> {
  const instanceId = ctx.interaction.options.getString('instance_id', true);
  await ctx.defer();
  const inst = await getInstance(ctx, instanceId);
  if (!inst) throw new UserError('Card not found.');
  const result = await adminRevokeCard(ctx, instanceId);
  if (result.status !== 'revoked') {
    throw new UserError('Card could not be revoked.');
  }
  ctx.services.logs.push({
    bot_id: ctx.services.env.botId,
    guild_id: ctx.guildId,
    channel_id: ctx.interaction.channelId,
    user_id: ctx.userId,
    action: 'card.admin.revoke',
    level: 'warn',
    message: `admin ${ctx.userId} revoked ${instanceId}`,
    meta: { instance_id: instanceId, previous_owner: inst.owner_user_id },
    created_at: new Date(),
  });
  await ctx.success('Card revoked', `\`${instanceId}\` is now marked revoked and cannot be traded or sold.`);
}
