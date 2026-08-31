import { SlashCommandBuilder } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { assertModeratable, clearWarn, listActiveWarns, notifyTarget, recordAction } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Manage member warnings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Warn a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the warning').setRequired(false).setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove an active warning by its number')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('index').setDescription('Warning number (1-based)').setRequired(true).setMinValue(1),
      ),
  );

async function add(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = ctx.targetUser();
  const member = ctx.targetMember();
  if (member) assertModeratable(ctx, member);

  const reason = ctx.reason();
  const persisted = await recordAction(ctx, { action: 'warn', targetId: target.id, reason });
  const warns = await listActiveWarns(ctx, target.id).catch(() => null);

  await ctx.replyEmbed(
    ctx.services.embeds.success('Warning issued', `${target.tag} has been warned.`, {
      fields: [
        { name: 'Reason', value: reason, inline: false },
        { name: 'Active warnings', value: warns ? String(warns.length) : 'unknown', inline: true },
      ],
      footerSuffix: persisted ? undefined : 'Not persisted — database unavailable',
    }),
  );

  await notifyTarget(
    ctx,
    target.id,
    ctx.services.embeds.warning(
      `You were warned in ${ctx.interaction.guild?.name ?? 'a server'}`,
      `**Reason:** ${reason}`,
    ),
  );
}

async function remove(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = ctx.targetUser();
  const index = ctx.requiredInt('index');

  const warns = await listActiveWarns(ctx, target.id);
  if (warns.length === 0) {
    throw new UserError(`${target.tag} has no active warnings.`);
  }

  const warn = warns[index - 1];
  if (!warn) {
    throw new UserError(`Invalid warning number. ${target.tag} has ${warns.length} active warning(s).`);
  }

  const cleared = await clearWarn(ctx, warn.id);
  if (!cleared) throw new UserError('Could not remove that warning. Please try again.');

  const remaining = warns.length - 1;
  await ctx.success(
    'Warning removed',
    `Removed warning #${index} from ${target.tag}. ${remaining} remaining.`,
  );
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.ModerateMembers, 'Moderate Members');
  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'add') return add(ctx);
  if (sub === 'remove') return remove(ctx);
  throw new UserError('Unknown subcommand.');
}
