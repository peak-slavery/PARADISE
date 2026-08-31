import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { runCompletion } from '../lib/ai.js';

export const data = new SlashCommandBuilder()
  .setName('cyrene')
  .setDescription('Speak with Cyrene — a gentle keeper of memories')
  .addStringOption((o) =>
    o.setName('prompt').setDescription('What would you like to ask her?').setRequired(true).setMaxLength(1000),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  // Explicit route: the persona chain is Groq gpt-oss first — it never reaches
  // the general assistant model.
  await runCompletion(ctx, { route: 'cyrene' });
}
