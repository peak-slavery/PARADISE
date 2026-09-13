import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { QueueTimeoutError, ServiceBusyError, type CommandModule } from '@eiflow/shared';
import { synthesizeSpeech, TtsResponseError, validateTtsText } from '../lib/tts.js';

export const data = new SlashCommandBuilder()
  .setName('speak')
  .setDescription('Have Cyrene speak text aloud')
  .addStringOption((o) => o.setName('text').setDescription('Text to speak').setRequired(true).setMaxLength(800));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  let text: string;
  try {
    text = validateTtsText(ctx.interaction.options.getString('text'));
  } catch (err) {
    await ctx.warn('Invalid speech text', err instanceof Error ? err.message : 'Please provide valid text.', true);
    return;
  }

  await ctx.defer(true);
  try {
    const audio = await ctx.services.queue.run(
      () => synthesizeSpeech(ctx.services.env, text, AbortSignal.timeout(18_000)),
      { timeoutMs: 20_000, maxPending: 16 },
    );
    await ctx.interaction.editReply({
      content: audio.transcript ? `Cyrene: ${audio.transcript}` : 'Cyrene speaks',
      files: [new AttachmentBuilder(audio.data, { name: 'cyrene-speech.mp3' })],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      await ctx.warn('Speech synthesis timed out', 'Please try again shortly.', true);
      return;
    }
    if (err instanceof ServiceBusyError) {
      await ctx.warn('Speech service busy', 'Too many speech requests are queued right now. Try again shortly.', true);
      return;
    }
    if (err instanceof TtsResponseError) {
      await ctx.warn('Speech synthesis unavailable', err.message, true);
      return;
    }
    ctx.log.error({ err }, 'unexpected speech synthesis failure');
    await ctx.warn('Speech synthesis unavailable', 'Please try again shortly.', true);
  }
}
