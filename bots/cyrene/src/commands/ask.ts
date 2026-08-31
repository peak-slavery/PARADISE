import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { runCompletion } from '../lib/ai.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask the assistant anything')
  .addStringOption((o) =>
    o.setName('prompt').setDescription('Your question').setRequired(true).setMaxLength(1000),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  // Explicit route: the assistant chain is Mistral first — it never falls back
  // to the Cyrene persona model.
  await runCompletion(ctx, { route: 'assistant' });
}
