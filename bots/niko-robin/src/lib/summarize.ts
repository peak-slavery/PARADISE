import type { CommandContext } from '@eiflow/shared';

/**
 * SLM search-result summarizer for Niko Robin.
 *
 * ModelScope is the only provider (single key, no chain). Same contract as
 * the Shanks classifier: never throws, never rejects — any failure simply
 * means "no summary" and the command falls back to the verbatim embed. The
 * API key is never logged.
 */

const ENDPOINT = 'https://api-inference.modelscope.cn/v1/chat/completions';
const SAFE_MODEL = /^[A-Za-z0-9._/:.-]{1,100}$/;
const TIMEOUT_MS = 8000;

/** Embed descriptions cap at 4096 chars; the summary must leave room for links. */
export const MAX_SUMMARY_CHARS = 900;

const SYSTEM_PROMPT = [
  'You summarize web search results for a Discord embed.',
  'Write 2-4 sentences answering the query using only the given results.',
  'Plain language, no markdown headings, no lists, no URLs.',
  'If the results do not answer the query, say what they do cover instead.',
].join(' ');

export function summarizerEnabled(env: CommandContext['services']['env']): boolean {
  return env.hasSearchSlm && SAFE_MODEL.test(env.searchSlmModel);
}

/**
 * Summarize `results` for `query`. Resolves null on any failure — the caller
 * falls back to the verbatim result list. User text is truncated before it
 * leaves this process and the reply is truncated before it reaches Discord.
 */
export async function summarizeResults(
  ctx: CommandContext,
  query: string,
  results: Array<{ title: string; url: string; snippet: string }>,
): Promise<string | null> {
  const key = ctx.services.env.modelScopeApiKey?.trim();
  if (!key || !SAFE_MODEL.test(ctx.services.env.searchSlmModel)) return null;

  // Titles and snippets are already sanitised by the providers; keep the
  // payload bounded so a pathological result cannot blow up the request.
  const digest = results
    .map((r, i) => `[${i + 1}] ${r.title.slice(0, 200)}\n${r.snippet.slice(0, 400)}`)
    .join('\n')
    .slice(0, 4000);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: ctx.services.env.searchSlmModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Query: ${query.slice(0, 200)}\nResults:\n${digest}` },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      ctx.log.warn({ status: res.status }, 'search summarizer http failure');
      return null;
    }

    const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    const summary = content.trim().slice(0, MAX_SUMMARY_CHARS);
    return summary.length > 0 ? summary : null;
  } catch (err) {
    ctx.log.warn({ err }, 'search summarizer unavailable');
    return null;
  }
}
