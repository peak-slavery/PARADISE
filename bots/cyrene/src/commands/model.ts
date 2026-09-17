import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '@eiflow/shared';
import { sanitizeText, truncateFieldValue } from '@eiflow/shared';
import { AI_ROUTES, describeRoute, providerHealth } from '../lib/providers.js';
import { ROUTE_SCOPE } from '../lib/personas.js';

/**
 * `/model` — reports, per route, the configured model and whether that
 * provider's API key is present.
 *
 * Security: this command emits booleans, model names, circuit-breaker state and
 * counters only. No API key (or prefix, suffix or mask of one) is ever read
 * into, formatted into, or logged from this command.
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

/** Live breaker state for a provider id, if it has been exercised this process. */
function healthWord(providerId: string): string {
  const entry = providerHealth.report().find((candidate) => candidate.id === providerId);
  if (!entry) return 'no traffic yet';
  const cooldown = entry.cooldownRemainingMs > 0
    ? `, ${Math.ceil(entry.cooldownRemainingMs / 1000)}s cooldown`
    : '';
  return `${entry.state} (${entry.totalSuccesses} ok / ${entry.totalFailures} failed${cooldown})`;
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const fields = AI_ROUTES.flatMap((route) => {
    const report = describeRoute(ctx.services.env, route);
    const scope = ROUTE_SCOPE[route];
    const rows = [
      {
        name: `Primary — ${report.primaryName}`,
        value: truncateFieldValue(
          `Model: \`${cleanModel(report.primaryModel)}\`\nKey: ${keyWord(report.primaryKeyPresent)}\nHealth: ${healthWord(report.primaryName.toLowerCase())}`,
        ),
        inline: false,
      },
      ...report.fallbacks.map((f) => ({
        name: `Fallback — ${f.name}`,
        value: truncateFieldValue(
          `Model: \`${cleanModel(f.model)}\`\nKey: ${keyWord(f.keyPresent)}\nHealth: ${healthWord(f.name.toLowerCase())}`,
        ),
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
