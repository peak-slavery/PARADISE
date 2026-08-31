import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { isSnowflake, requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { recordAction } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user by ID')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((o) =>
    o.setName('user_id').setDescription('Discord user ID to unban').setRequired(true).setMaxLength(25),
  )
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(512));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');
  requirePermission(ctx, PermissionFlagsBits.BanMembers, 'Ban Members');

  const userId = ctx.requiredString('user_id');
  if (!isSnowflake(userId)) throw new UserError('That is not a valid Discord user ID.');

  const existing = await guild.bans.fetch(userId).catch(() => null);
  if (!existing) throw new UserError('That user is not banned.');

  const reason = ctx.reason();

  try {
    await guild.bans.remove(userId, reason);
  } catch {
    throw new UserError('I do not have permission to unban that user.');
  }

  const persisted = await recordAction(ctx, { action: 'unban', targetId: userId, reason });

  const db = ctx.services.supabase;
  if (db) {
    await db
      .from('mod_actions')
      .update({ active: false })
      .eq('guild_id', ctx.guildId)
      .eq('target_id', userId)
      .eq('action', 'ban')
      .eq('active', true);
  }

  await ctx.replyEmbed(
    ctx.services.embeds.success('User unbanned', `<@${userId}> has been unbanned.`, {
      fields: [{ name: 'Reason', value: reason }],
      footerSuffix: persisted ? undefined : 'Not persisted — database unavailable',
    }),
  );
}
