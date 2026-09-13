import type { Env, Logger } from '@eiflow/shared';

/**
 * SLM-assisted bad-word / toxicity detection for Zoro.
 *
 * Cerebras is shared with Shanks. This classifier is fail-open: transport,
 * timeout, HTTP, empty, and parse failures never escalate content.
 */

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const MODEL = 'qwen-3.8-27b';
const MAX_TOKENS = 64;
const MAX_CONTEXT_CHARS = 2000;
const TIMEOUT_MS = 6000;
const CATEGORIES = new Set(['slur', 'hate', 'threat', 'sexual', 'insult', 'none']);

export interface SlmVerdict {
  bad: boolean;
  confidence: number;
  category: string;
}

export interface SlmResult extends SlmVerdict {
  ok: boolean;
  model: string;
  error?: string;
}

export function slmEnabled(env: Env): boolean {
  return env.hasCerebras && Boolean(env.cerebrasApiKey?.trim());
}

const SYSTEM_PROMPT = [
  'You are a strict content moderator for a Discord server.',
  'Decide whether the user message contains a slur, hate speech, direct threat of violence, or explicit sexual content that the server static filters missed.',
  'Be precise: do NOT flag mild profanity, jokes, sarcasm, or reclaimed terms. Only flag genuinely harmful content.',
  'Respond with ONLY a JSON object of the form {"bad": boolean, "confidence": number between 0 and 1, "category": "slur"|"hate"|"threat"|"sexual"|"insult"|"none"}.',
].join(' ');

/** Parse only the exact JSON object requested from the model. */
export function parseVerdict(raw: string): SlmVerdict | null {
  const value = raw.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return null;

  try {
    const obj = JSON.parse(value) as Record<string, unknown>;
    if (typeof obj.bad !== 'boolean') return null;
    if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) return null;
    if (typeof obj.category !== 'string' || !CATEGORIES.has(obj.category)) return null;
    return {
      bad: obj.bad,
      confidence: Math.min(1, Math.max(0, obj.confidence)),
      category: obj.category,
    };
  } catch {
    return null;
  }
}

/** Classify one piece of text. Always resolves — never rejects. */
export async function classifyContent(
  env: Env,
  text: string,
  log: Logger,
  timeoutMs = 6000,
): Promise<SlmResult> {
  const model = MODEL;
  const maxTokens = Math.min(MAX_TOKENS, Math.max(1, env.zoroSlmMaxTokens));
  const contextChars = Math.min(MAX_CONTEXT_CHARS, Math.max(1, env.zoroSlmContextChars));
  const key = env.cerebrasApiKey?.trim();
  if (!env.hasCerebras || !key) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'slm disabled' };
  }

  const body = text.trim();
  if (!body) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'empty' };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: body.slice(0, contextChars) },
        ],
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, Math.max(1, timeoutMs))),
    });

    if (!res.ok) {
      return { ok: false, bad: false, confidence: 0, category: 'none', model, error: `cerebras ${res.status}` };
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const raw = json.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'empty response' };
    }
    const verdict = parseVerdict(raw);
    if (!verdict) {
      return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'unparseable response' };
    }
    return { ok: true, ...verdict, model };
  } catch (err) {
    const error = err instanceof Error ? err.name : 'request failed';
    log.warn({ model }, 'slm classify failed');
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error };
  }
}
