import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { requireBotPermission, requirePermission } from './authorization.js';
import { UserError } from './errors.js';
import type { CommandContext } from './types.js';

function context(hasPermission: boolean, hasGuild = true): CommandContext {
  return {
    userId: '123456789012345678',
    services: { isOwner: () => false },
    interaction: {
      guild: hasGuild ? { id: '123456789012345678', members: { me: { permissions: { has: () => hasPermission } } } } : null,
      memberPermissions: { has: () => hasPermission },
    },
  } as unknown as CommandContext;
}

describe('execution-time authorization', () => {
  it('allows an authorized member', () => {
    expect(() => requirePermission(context(true), PermissionFlagsBits.BanMembers, 'Ban Members')).not.toThrow();
  });

  it('rejects a member without the required permission', () => {
    expect(() => requirePermission(context(false), PermissionFlagsBits.BanMembers, 'Ban Members'))
      .toThrow(UserError);
  });

  it('preflights the bot permission before destructive work', () => {
    expect(() => requireBotPermission(context(true), PermissionFlagsBits.BanMembers, 'Ban Members')).not.toThrow();
    expect(() => requireBotPermission(context(false), PermissionFlagsBits.BanMembers, 'Ban Members'))
      .toThrow(UserError);
    expect(() => requireBotPermission(context(true, false), PermissionFlagsBits.BanMembers, 'Ban Members'))
      .toThrow(UserError);
  });
});
