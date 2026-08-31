import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { formatDuration, MAX_TIMEOUT_SECONDS, parseDuration, requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { assertModeratable, notifyTarget, recordAction } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Timeout a member')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('user').setDescription('Member to mute').setRequired(true))
  .addStringOption((o) =>
    o.setName('duration').setDescription('How long: 30s, 10m, 2h, 7d').setRequired(true).setMaxLength(16),
  )
  .addStringOption((o) =>
    o.setName('reason').setDescription('Reason for the mute').setRequired(false).setMaxLength(512),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = ctx.targetUser();
  requirePermission(ctx, PermissionFlagsBits.ModerateMembers, 'Moderate Members');
  const member = ctx.targetMember();
  if (!member) throw new UserError('That user is not in this server.');

  assertModeratable(ctx, member);

  const seconds = parseDuration(ctx.requiredString('duration'));
  if (!seconds || seconds <= 0) {
    throw new UserError('Invalid duration. Use a format like `30s`, `10m`, `2h` or `7d`.');
  }
  if (seconds > MAX_TIMEOUT_SECONDS) {
    throw new UserError('Duration cannot exceed 28 days.');
  }

  const reason = ctx.reason();

  try {
    await member.timeout(seconds * 1000, reason);
  } catch {
    throw new UserError('I do not have permission to time out that member.');
  }

  const expiresAt = new Date(Date.now() + seconds * 1000);
  const persisted = await recordAction(ctx, {
    action: 'mute',
    targetId: target.id,
    reason,
    durationSeconds: seconds,
    expiresAt,
  });

  await ctx.replyEmbed(
    ctx.services.embeds.success('Member muted', `${target.tag} has been timed out.`, {
      fields: [
        { name: 'Duration', value: formatDuration(seconds), inline: true },
        { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
      footerSuffix: persisted ? undefined : 'Not persisted — database unavailable',
    }),
  );

  await notifyTarget(
    ctx,
    target.id,
    ctx.services.embeds.warning(
      `You were muted in ${ctx.interaction.guild?.name ?? 'a server'}`,
      `**Duration:** ${formatDuration(seconds)}\n**Reason:** ${reason}`,
    ),
  );
}
