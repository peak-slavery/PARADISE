import { SlashCommandBuilder, type EmbedBuilder } from 'discord.js';
import { chunkFields, type CommandModule, escapeMarkdown, keys, sanitizeText, truncateFieldValue } from '@eiflow/shared';
import {
  COOLDOWN_SECONDS,
  MAX_RESULTS,
  PROVIDER_LABELS,
  PROVIDER_TIMEOUT_MS,
  type SearchFailureReason,
  searchWeb,
} from '../lib/search.js';

export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search the web')
  .addStringOption((o) =>
    o.setName('query').setDescription('What to search for').setRequired(true).setMaxLength(200),
  )
  .addIntegerOption((o) =>
    o
      .setName('limit')
      .setDescription(`Results to show (1–${MAX_RESULTS})`)
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_RESULTS),
  );

type Ctx = Parameters<CommandModule['execute']>[0];

/**
 * Every provider failure has its own message. A raw stack trace tells the user
 * nothing and leaks internals, so nothing below echoes `err.message`.
 */
function failureEmbed(ctx: Ctx, reason: SearchFailureReason, detail: string | undefined, query: string): EmbedBuilder {
  const { embeds } = ctx.services;
  // Embed descriptions render markdown, so a query must be escaped before echoing.
  const escaped = query.length > 0 ? `“${escapeMarkdown(query)}”` : 'that query';

  switch (reason) {
    case 'not_configured':
      return embeds.warning(
        'Search not configured',
        'No search provider is set up for this bot. An owner needs to configure `BRAVE_SEARCH_API_KEY` or `SERPAPI_KEY`.',
      );
    case 'rate_limited':
      return embeds.warning(
        'Rate limited',
        'The search provider is throttling this bot right now. Try again in a few minutes.',
      );
    case 'timeout':
      return embeds.warning(
        'Search timed out',
        `The provider did not respond within ${Math.round(PROVIDER_TIMEOUT_MS / 1000)}s. Try again shortly.`,
      );
    case 'network':
      return embeds.error(
        'Search unreachable',
        'Could not reach the search provider. This is usually a temporary network problem — please retry.',
      );
    case 'busy':
      return embeds.warning(
        'Search busy',
        'Too many searches are queued at the moment. Try again in a few seconds.',
      );
    case 'no_results':
      return embeds.info('No results', `Nothing found for ${escaped}. Try different wording.`);
    case 'provider_error':
    default:
      return embeds.error(
        'Search provider error',
        `The search provider rejected the request.${detail ? ` (${detail})` : ''} Please try again later.`,
      );
  }
}

export async function execute(ctx: Ctx): Promise<void> {
  // Sanitise before the value reaches the cache key, the URL or the embed.
  const query = sanitizeText(ctx.requiredString('query'), 200);

  const requested = ctx.intOption('limit') ?? MAX_RESULTS;
  const limit = Math.min(MAX_RESULTS, Math.max(1, requested));

  await ctx.defer();

  // Per-user cooldown: one request per window, so a single user cannot drain
  // the shared provider quota. Redis failures fail closed.
  if (!ctx.services.isOwner(ctx.userId)) {
    let used = 1;
    try {
      used = await ctx.services.redis.incr(keys.searchCooldown(ctx.userId), COOLDOWN_SECONDS);
    } catch (err) {
      ctx.log.warn({ err }, 'search cooldown unavailable — rejecting request');
      await ctx.warn('Temporarily unavailable', 'Search protection is unavailable. Please try again shortly.');
      return;
    }
    if (used > 1) {
      await ctx.warn('Slow down', `You can search again in ${COOLDOWN_SECONDS} seconds.`);
      return;
    }
  }

  const outcome = await searchWeb(ctx, query, limit);

  if (!outcome.ok) {
    ctx.log.warn(
      { reason: outcome.reason, detail: outcome.detail, queryLength: query.length, userId: ctx.userId },
      'search failed',
    );
    await ctx.replyEmbed(failureEmbed(ctx, outcome.reason, outcome.detail, query));
    return;
  }

  const fields = outcome.results.map((result, index) => ({
    name: truncateFieldValue(`${index + 1}. ${result.title}`, 256),
    value: truncateFieldValue(`${result.snippet}\n<${result.url}>`),
  }));

  // Discord allows 25 fields per embed; chunk so a future limit bump cannot 400.
  const [first = []] = chunkFields(fields, 25);

  ctx.services.logs.push({
    bot_id: ctx.services.env.botId,
    guild_id: ctx.guildId,
    channel_id: ctx.interaction.channelId,
    user_id: ctx.userId,
    action: 'search.query',
    level: 'info',
    message: `search request via ${outcome.provider}`,
    meta: {
      queryLength: query.length,
      provider: outcome.provider,
      cached: outcome.cached,
      results: outcome.results.length,
    },
    created_at: new Date(),
  });

  await ctx.replyEmbed(
    ctx.services.embeds.brand(`Results for “${query}”`, `Top ${first.length} result(s) via ${PROVIDER_LABELS[outcome.provider]}`, {
      fields: first,
      footerSuffix: outcome.cached ? 'cached result' : 'live result',
    }),
  );
}
