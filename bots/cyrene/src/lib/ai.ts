import type { EmbedBuilder } from 'discord.js';
import type { CommandContext } from '@eiflow/shared';
import {
  QueueTimeoutError,
  ServiceBusyError,
  UserError,
  escapeMentions,
  keys,
  sanitizeText,
  truncateEmbedText,
  truncateFieldValue,
} from '@eiflow/shared';
import { appendTurn, readContext } from './context.js';
import { PERSONAS, ROUTE_SCOPE } from './personas.js';
import {
  AllProvidersFailedError,
  REQUEST_TIMEOUT_MS,
  completeWithFallback,
  createRoute,
  type AiRoute,
  type ChatMessage,
} from './providers.js';

/**
 * The single path every AI command takes: cooldown → queue → route chain →
 * context write → embed.
 *
 * The caller passes the route explicitly, so `/cyrene` and `/ask` can never
 * reach each other's model: the chain is built from the route, not shared.
 *
 * Invariants:
 *  - the interaction is always deferred first (model calls exceed 3s)
 *  - the model call always runs inside the queue with a hard timeout
 *  - every failure mode ends in an embed, never a hang and never a crash
 */

const PROMPT_MAX = 1000;
const COOLDOWN_WINDOW_SEC = 10;
const COOLDOWN_LIMIT = 1;
const QUEUE_TIMEOUT_MS = 20_000;
const QUEUE_MAX_PENDING = 16;

/** Discord allows 6000 chars per embed in total — leave headroom. */
const MAX_REPLY_CHARS = 4500;
const CHUNK_SIZE = 1000;
const MAX_CHUNKS = 25;

export interface RunCompletionOptions {
  /** Selects the model chain, the persona and the context/cache namespace. */
  route: AiRoute;
}

/** Reads and sanitises the `prompt` option shared by /ask and /cyrene. */
export function readPrompt(ctx: CommandContext): string {
  const raw = ctx.interaction.options.getString('prompt');
  const prompt = sanitizeText(raw ?? '', PROMPT_MAX);
  if (prompt.length === 0) throw new UserError('Please provide a prompt.');
  return prompt;
}

/** Splits on line boundaries where possible so markdown stays readable. */
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let current = '';

  const push = (): void => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const line of text.split('\n')) {
    if (line.length > size) {
      push();
      for (let i = 0; i < line.length; i += size) chunks.push(line.slice(i, i + size));
      continue;
    }
    if (current.length + line.length + 1 > size) push();
    current = current ? `${current}\n${line}` : line;
  }

  push();
  return chunks.length > 0 ? chunks : [text];
}

function buildAnswerEmbed(
  ctx: CommandContext,
  title: string,
  prompt: string,
  answer: string,
  provider: string,
): EmbedBuilder {
  const safe = escapeMentions(answer);
  const chunks = chunkText(truncateEmbedText(safe, MAX_REPLY_CHARS), CHUNK_SIZE).slice(0, MAX_CHUNKS);
  const asked = { name: 'You asked', value: truncateFieldValue(prompt, 300), inline: false };
  const footerSuffix = provider === 'cache' ? 'cached response' : `via ${provider}`;

  if (chunks.length <= 1) {
    return ctx.services.embeds.brand(title, chunks[0] ?? safe, { fields: [asked], footerSuffix });
  }

  return ctx.services.embeds.brand(title, undefined, {
    fields: [
      asked,
      ...chunks.map((chunk, i) => ({
        name: `Response (${i + 1}/${chunks.length})`,
        value: truncateFieldValue(chunk),
        inline: false,
      })),
    ],
    footerSuffix,
  });
}

/**
 * Runs one routed completion end to end and replies with an embed.
 *
 * `route` decides the model chain; the scope (and therefore the persona and the
 * Mongo/Redis namespace) follows from it via ROUTE_SCOPE.
 */
export async function runCompletion(ctx: CommandContext, opts: RunCompletionOptions): Promise<void> {
  const { route } = opts;
  const scope = ROUTE_SCOPE[route];

  const prompt = readPrompt(ctx);
  await ctx.defer();

  if (!ctx.services.isOwner(ctx.userId)) {
    const verdict = await ctx.services.redis
      .allow(keys.aiCooldown(ctx.guildId, ctx.userId), COOLDOWN_LIMIT, COOLDOWN_WINDOW_SEC)
      .catch(() => ({ allowed: false, resetSec: COOLDOWN_WINDOW_SEC }));

    if (verdict && !verdict.allowed) {
      await ctx.warn('Slow down', `You can ask again in ${verdict.resetSec}s.`);
      return;
    }
  }

  // Context is private to this guild and user, so responses cannot be shared
  // through a prompt-only cache key. Always generate a fresh answer.
  const history = await readContext(ctx, scope);
  const persona = PERSONAS[scope];
  const messages: ChatMessage[] = [
    { role: 'system', content: persona.systemPrompt },
    ...history,
    { role: 'user', content: prompt },
  ];

  let result: { text: string; provider: string };
  try {
    result = await ctx.services.queue.run(
      () =>
        completeWithFallback(createRoute(ctx.services.env, route), messages, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          log: ctx.log,
        }),
      { timeoutMs: QUEUE_TIMEOUT_MS, maxPending: QUEUE_MAX_PENDING },
    );
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      await ctx.warn('Took too long', 'The AI did not answer in time. Please try again.');
      return;
    }
    if (err instanceof ServiceBusyError) {
      await ctx.warn('Service busy', 'Too many AI requests are queued right now. Try again shortly.');
      return;
    }
    if (err instanceof AllProvidersFailedError) {
      ctx.log.error({ failures: err.failures, route, scope }, 'every provider in the route failed');
      await ctx.replyEmbed(ctx.services.embeds.unavailable('The AI service'));
      return;
    }
    throw err;
  }

  const answer = result.text;
  const provider = result.provider;

  // Fire-and-forget: appendTurn swallows its own failures, and history must
  // never delay or fail the reply the user is waiting for.
  void appendTurn(ctx, scope, prompt, answer);

  await ctx.replyEmbed(buildAnswerEmbed(ctx, PERSONAS[scope].title, prompt, answer, provider));
}
