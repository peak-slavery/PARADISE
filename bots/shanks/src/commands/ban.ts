import { SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { PermissionFlagsBits } from 'discord.js';
import { notifyTarget, recordAction } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a member from the server')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
  .addStringOption((o) =>
    o.setName('reason').setDescription('Reason for the ban').setRequired(false).setMaxLength(512),
  )
  .addIntegerOption((o) =>
    o
      .setName('delete_messages')
      .setDescription('Days of message history to delete (0–7)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(7),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');
  requirePermission(ctx, PermissionFlagsBits.BanMembers, 'Ban Members');

  const target = ctx.targetUser();
  if (target.id === guild.ownerId) throw new UserError('The server owner cannot be banned.');
  if (target.id === ctx.userId) throw new UserError('You cannot ban yourself.');

  const member = ctx.targetMember();
  const botMember = guild.members.me;
  if (member && botMember && member.roles.highest.position >= botMember.roles.highest.position) {
    throw new UserError('That member has an equal or higher role than me.');
  }

  // Don't waste an API call if the member is already banned.
  const existing = await guild.bans.fetch(target.id).catch(() => null);
  if (existing) throw new UserError(`${target.tag} is already banned.`);

  const reason = ctx.reason();
  const days = ctx.intOption('delete_messages') ?? 0;

  try {
    await guild.bans.create(target.id, { reason, deleteMessageSeconds: days * 86_400 });
  } catch {
    throw new UserError('I do not have permission to ban that member.');
  }

  const persisted = await recordAction(ctx, {
    action: 'ban',
    targetId: target.id,
    reason,
    meta: { deleteMessageDays: days },
  });

  await ctx.replyEmbed(
    ctx.services.embeds.success('Member banned', `${target.tag} has been banned.`, {
      fields: [
        { name: 'Reason', value: reason, inline: false },
        { name: 'History deleted', value: days === 0 ? 'No' : `${days} day(s)`, inline: true },
      ],
      footerSuffix: persisted ? undefined : 'Not persisted — database unavailable',
    }),
  );

  await notifyTarget(
    ctx,
    target.id,
    ctx.services.embeds.error(
      `You were banned from ${guild.name}`,
      `**Reason:** ${reason}`,
    ),
  );
}
