import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { recordAction } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Remove a timeout from a member')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('user').setDescription('Member to unmute').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(512));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = ctx.targetUser();
  requirePermission(ctx, PermissionFlagsBits.ModerateMembers, 'Moderate Members');
  const member = ctx.targetMember();
  if (!member) throw new UserError('That user is not in this server.');

  if (!member.isCommunicationDisabled()) {
    throw new UserError(`${target.tag} is not currently muted.`);
  }

  const reason = ctx.reason();

  try {
    await member.timeout(null, reason);
  } catch {
    throw new UserError('I do not have permission to remove that timeout.');
  }

  const persisted = await recordAction(ctx, { action: 'unmute', targetId: target.id, reason });

  // Timeouts are expiring records — retire any active mute row for this member.
  const db = ctx.services.supabase;
  if (db) {
    await db
      .from('mod_actions')
      .update({ active: false })
      .eq('guild_id', ctx.guildId)
      .eq('target_id', target.id)
      .eq('action', 'mute')
      .eq('active', true);
  }

  await ctx.replyEmbed(
    ctx.services.embeds.success('Member unmuted', `${target.tag} can speak again.`, {
      fields: [{ name: 'Reason', value: reason }],
      footerSuffix: persisted ? undefined : 'Not persisted — database unavailable',
    }),
  );
}
