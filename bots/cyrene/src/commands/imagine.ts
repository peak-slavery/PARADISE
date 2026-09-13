import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { QueueTimeoutError, ServiceBusyError, type CommandModule } from '@eiflow/shared';
import { generateImage, MediaResponseError, validateImagePrompt } from '../lib/image.js';

export const data = new SlashCommandBuilder()
  .setName('imagine')
  .setDescription('Generate an image with Cyrene')
  .addStringOption((o) => o.setName('prompt').setDescription('Image description').setRequired(true).setMaxLength(1000));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  let prompt: string;
  try {
    prompt = validateImagePrompt(ctx.interaction.options.getString('prompt'));
  } catch (err) {
    await ctx.warn('Invalid image prompt', err instanceof Error ? err.message : 'Please provide a valid prompt.', true);
    return;
  }

  await ctx.defer(true);
  try {
    const image = await ctx.services.queue.run(
      () => generateImage(ctx.services.env, prompt, AbortSignal.timeout(29_000)),
      { timeoutMs: 30_000, maxPending: 8 },
    );
    await ctx.interaction.editReply({
      content: 'Generated image',
      files: [new AttachmentBuilder(image.data, { name: `cyrene-image.${image.extension}` })],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      await ctx.warn('Image generation timed out', 'Please try again shortly.', true);
      return;
    }
    if (err instanceof ServiceBusyError) {
      await ctx.warn('Image service busy', 'Too many image requests are queued right now. Try again shortly.', true);
      return;
    }
    if (err instanceof MediaResponseError) {
      await ctx.warn('Image generation unavailable', err.message, true);
      return;
    }
    ctx.log.error({ err }, 'unexpected image generation failure');
    await ctx.warn('Image generation unavailable', 'Please try again shortly.', true);
  }
}
