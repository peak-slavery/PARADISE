import { PermissionFlagsBits, type PermissionResolvable } from 'discord.js';
import { UserError } from './errors.js';
import type { CommandContext } from './types.js';

/** Enforce permissions at execution time, not only at command registration. */
export function requirePermission(
  ctx: CommandContext,
  permission: PermissionResolvable,
  label: string,
): void {
  if (ctx.services.isOwner(ctx.userId)) return;
  if (!ctx.interaction.guild) {
    throw new UserError('This command can only be used inside a server.');
  }

  if (!ctx.interaction.memberPermissions?.has(permission)) {
    throw new UserError(`You need the "${label}" permission to use this command.`);
  }
}

export function requireManageGuild(ctx: CommandContext): void {
  requirePermission(ctx, PermissionFlagsBits.ManageGuild, 'Manage Server');
}

/**
 * Verify the bot's live permission before a destructive call. A controlled
 * failure here prevents partial execution when Discord UI state is stale.
 */
export function requireBotPermission(
  ctx: CommandContext,
  permission: PermissionResolvable,
  label: string,
): void {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');
  if (!guild.members.me?.permissions.has(permission)) {
    throw new UserError(`I need the "${label}" permission to do that.`);
  }
}
