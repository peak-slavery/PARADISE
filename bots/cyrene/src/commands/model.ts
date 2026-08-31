import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { sanitizeText, truncateFieldValue } from '@eiflow/shared';
import { AI_ROUTES, describeRoute } from '../lib/providers.js';
import { ROUTE_SCOPE } from '../lib/personas.js';

/**
 * `/model` — reports, per route, the configured model and whether that
 * provider's API key is present.
 *
 * Security: this command emits booleans and model names only. No API key (or
 * prefix, suffix or mask of one) is ever read into, formatted into, or logged
 * from this command.
 */

export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Show which model each command routes to, and whether its API key is configured');

/** Model ids come from env, so they are sanitised again before rendering. */
function cleanModel(value: string): string {
  return sanitizeText(value, 100) || 'unset';
}

function keyWord(present: boolean): string {
  return present ? 'configured' : 'missing';
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const fields = AI_ROUTES.flatMap((route) => {
    const report = describeRoute(ctx.services.env, route);
    const scope = ROUTE_SCOPE[route];
    const rows = [
      {
        name: `Primary — ${report.primaryName}`,
        value: truncateFieldValue(
          `Model: \`${cleanModel(report.primaryModel)}\`\nKey: ${keyWord(report.primaryKeyPresent)}`,
        ),
        inline: false,
      },
      ...report.fallbacks.map((f) => ({
        name: `Fallback — ${f.name}`,
        value: truncateFieldValue(`Model: \`${cleanModel(f.model)}\`\nKey: ${keyWord(f.keyPresent)}`),
        inline: false,
      })),
    ];

    return [
      { name: `/${route === 'assistant' ? 'ask' : 'cyrene'} → ${report.label}`, value: `Context scope: \`${scope}\``, inline: false },
      ...rows,
    ];
  });

  await ctx.replyEmbed(
    ctx.services.embeds.info('Model routing', 'Each route has its own chain — they never share a model.', {
      fields,
      footerSuffix: 'keys are never displayed',
    }),
    true,
  );
}
