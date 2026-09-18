import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types.js';
import {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
} from '../guild-policy.js';

// Operator-critical: this command is registered ONLY in the development guild.
// The canonical guild boundary is code-owned; this command cannot extend it.
export const access = 'dev' as const;

export const data = new SlashCommandBuilder()
  .setName('authorize')
  .setDescription('Inspect the canonical guild authorization boundary')
  .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List the immutable guild boundary'));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const masterDiscordId = ctx.services.env.masterDiscordId;
  if (!masterDiscordId || ctx.userId !== masterDiscordId) {
    await ctx.error('Master access required', 'Only the master operator can inspect the guild boundary.', true);
    return;
  }

  const subcommand = ctx.interaction.options.getSubcommand();
  if (subcommand !== 'list') {
    await ctx.error('Unsupported operation', 'Guild membership changes are managed by the canonical policy.', true);
    return;
  }

  await ctx.info(
    'Canonical guild boundary',
    `Production: \`${APPROVED_PRODUCTION_GUILD_ID}\`\nDevelopment: \`${APPROVED_DEVELOPMENT_GUILD_ID}\`\nNo database or Redis value can extend this boundary.`,
    true,
  );
}
