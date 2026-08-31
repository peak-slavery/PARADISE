import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requireManageGuild, UserError, type CommandModule } from '@eiflow/shared';
import { addWhitelistEntry, loadWhitelist, removeWhitelistEntry, resolveWhitelistTarget } from '../lib/store.js';

/**
 * `/whitelist add|remove` — each subcommand accepts either a user or a role.
 * Discord has no mutually-exclusive options, so both are optional and the
 * resolver rejects the "both" and "neither" cases.
 */
export const data = new SlashCommandBuilder()
  .setName('whitelist')
  .setDescription('Exempt users and roles from antinuke enforcement')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Exempt a user or role')
      .addUserOption((o) => o.setName('user').setDescription('User to exempt').setRequired(false))
      .addRoleOption((o) => o.setName('role').setDescription('Role to exempt').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove an exemption')
      .addUserOption((o) => o.setName('user').setDescription('User to un-exempt').setRequired(false))
      .addRoleOption((o) => o.setName('role').setDescription('Role to un-exempt').setRequired(false)),
  );

async function add(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = resolveWhitelistTarget(ctx);

  const inserted = await addWhitelistEntry(ctx, target);
  if (!inserted) throw new UserError('Could not add that entry. It may already be whitelisted.');

  // Read-through after the write so the embed reflects committed state.
  const entries = await loadWhitelist(ctx.services, ctx.guildId).catch(() => []);
  const mention = target.targetType === 'user' ? `<@${target.targetId}>` : `<@&${target.targetId}>`;

  await ctx.replyEmbed(
    ctx.services.embeds.success('Whitelist entry added', `${mention} is now exempt from antinuke.`, {
      fields: [
        { name: 'Type', value: target.targetType, inline: true },
        { name: 'Target', value: mention, inline: true },
        { name: 'Entries', value: String(entries.length), inline: true },
      ],
    }),
  );
}

async function remove(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const target = resolveWhitelistTarget(ctx);

  const removed = await removeWhitelistEntry(ctx, target);
  if (!removed) throw new UserError('That entry was not on the whitelist.');

  const mention = target.targetType === 'user' ? `<@${target.targetId}>` : `<@&${target.targetId}>`;

  await ctx.replyEmbed(
    ctx.services.embeds.success('Whitelist entry removed', `${mention} is no longer exempt.`, {
      fields: [
        { name: 'Type', value: target.targetType, inline: true },
        { name: 'Target', value: mention, inline: true },
      ],
    }),
  );
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requireManageGuild(ctx);
  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'add') return add(ctx);
  if (sub === 'remove') return remove(ctx);
  throw new UserError('Unknown subcommand.');
}
