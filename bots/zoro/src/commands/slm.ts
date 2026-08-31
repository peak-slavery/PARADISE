import { SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager, readConfig } from '../lib/store.js';
import { classifyContent, slmEnabled } from '../lib/slm.js';

export const data = new SlashCommandBuilder()
  .setName('slm')
  .setDescription('Inspect or test the SLM content classifier (Zoro)')
  .addSubcommand((s) => s.setName('status').setDescription('Show SLM configuration'))
  .addSubcommand((s) =>
    s
      .setName('test')
      .setDescription('Classify a sample of text')
      .addStringOption((o) => o.setName('text').setDescription('Text to classify').setRequired(true).setMaxLength(2000)),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const env = ctx.services.env;
  const sub = ctx.interaction.options.getSubcommand();
  await ctx.defer(true);

  if (sub === 'status') {
    const c = await readConfig(ctx.services, ctx.guildId);
    await ctx.replyEmbed(
      ctx.services.embeds.info(
        'SLM status',
        slmEnabled(env) ? 'The AutoMod SLM is online.' : 'The AutoMod SLM is disabled (no GROQ_AUTOMOD_API_KEY).',
        {
          fields: [
            { name: 'Model', value: env.automodSlmModel, inline: true },
            { name: 'Enabled in config', value: c.automodSlm ? 'Yes' : 'No', inline: true },
            { name: 'Threshold', value: `${(c.slmThreshold * 100).toFixed(0)}%`, inline: true },
          ],
        },
      ),
    );
    return;
  }

  const text = ctx.interaction.options.getString('text');
  if (!text) throw new UserError('Provide text to classify.');
  if (!slmEnabled(env)) throw new UserError('The SLM is not configured — set GROQ_AUTOMOD_API_KEY.');

  const res = await classifyContent(env, text, ctx.log);
  const embed = res.bad
    ? ctx.services.embeds.error('SLM verdict', `Model **${res.model}** flagged this as harmful.`, {
        fields: [
          { name: 'Bad?', value: 'Yes', inline: true },
          { name: 'Confidence', value: res.ok ? `${(res.confidence * 100).toFixed(0)}%` : 'n/a', inline: true },
          { name: 'Category', value: res.category, inline: true },
          { name: 'Error', value: res.error ?? 'none', inline: false },
        ],
        footerSuffix: res.ok ? 'live' : 'degraded (fail-open)',
      })
    : ctx.services.embeds.success('SLM verdict', `Model **${res.model}** judged this benign.`, {
        fields: [
          { name: 'Bad?', value: 'No', inline: true },
          { name: 'Confidence', value: res.ok ? `${(res.confidence * 100).toFixed(0)}%` : 'n/a', inline: true },
          { name: 'Category', value: res.category, inline: true },
          { name: 'Error', value: res.error ?? 'none', inline: false },
        ],
        footerSuffix: res.ok ? 'live' : 'degraded (fail-open)',
      });

  await ctx.replyEmbed(embed);
}
