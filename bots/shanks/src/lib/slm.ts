import type { Env } from '@eiflow/shared';

/**
 * SLM-assisted bad-words / toxicity classification for Shanks.
 *
 * Chain: NVIDIA NIM content-safety model (primary) → Cerebras general model
 * (fallback). Same contract as Zoro's classifier: never throws, never
 * rejects, fail-open — a transport/parse failure is a "not bad" verdict
 * because failing closed would silently punish legitimate speech. The
 * mirror log in the AutoMod handler still records the trigger either way.
 *
 * Parsing is deliberately tolerant: both providers are asked for strict JSON,
 * but the NVIDIA safety models are classifier-tuned and often answer in their
 * native "User Safety: safe|unsafe" form instead, so both shapes are accepted.
 * `response_format` is intentionally omitted — it is Groq-specific and the
 * NVIDIA classifier rejects it. The API keys are never logged, only model ids
 * and provider names.
 */

const ENDPOINTS = {
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
} as const;

const SAFE_MODEL = /^[A-Za-z0-9._/:.-]{1,100}$/;

export interface SlmVerdict {
  /** True when the content was judged worth a warning. */
  bad: boolean;
  /** 0..1 confidence reported by the model. */
  confidence: number;
  /** Short category label for the audit log. */
  category: string;
}

export interface SlmResult extends SlmVerdict {
  ok: boolean;
  model: string;
  error?: string;
}

export function slmEnabled(env: Env): boolean {
  return env.hasSecuritySlm;
}

const SYSTEM_PROMPT = [
  'You are a strict content moderator for a Discord server.',
  'Decide whether the user message contains a slur, hate speech, direct threat of violence, or explicit sexual content that the server static filters missed.',
  'Be precise: do NOT flag mild profanity, jokes, sarcasm, or reclaimed terms. Only flag genuinely harmful content.',
  'Respond with ONLY a JSON object of the form {"bad": boolean, "confidence": number between 0 and 1, "category": "slur"|"hate"|"threat"|"sexual"|"insult"|"none"}.',
].join(' ');

interface Attempt {
  name: 'nvidia' | 'cerebras';
  url: string;
  key: string;
  model: string;
}

function buildChain(env: Env): Attempt[] {
  const chain: Attempt[] = [];
  const nvidia = env.nvidiaNimApiKey?.trim();
  if (nvidia && SAFE_MODEL.test(env.securitySlmModel)) {
    chain.push({ name: 'nvidia', url: ENDPOINTS.nvidia, key: nvidia, model: env.securitySlmModel });
  }
  const cerebras = env.cerebrasApiKey?.trim();
  if (cerebras && SAFE_MODEL.test(env.securitySlmFallbackModel)) {
    chain.push({ name: 'cerebras', url: ENDPOINTS.cerebras, key: cerebras, model: env.securitySlmFallbackModel });
  }
  return chain;
}

/**
 * Accepts strict JSON or the NVIDIA safety models' native verdict line.
 * Exported for the parser test — `classifyText` is its only runtime caller.
 */
export function parseVerdict(content: string): SlmVerdict | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0]) as { bad?: unknown; confidence?: unknown; category?: unknown };
      if (typeof j.bad === 'boolean') {
        const confidence =
          typeof j.confidence === 'number' && Number.isFinite(j.confidence)
            ? Math.min(1, Math.max(0, j.confidence))
            : j.bad
              ? 1
              : 0;
        const category = typeof j.category === 'string' ? j.category.slice(0, 32) : 'none';
        return { bad: j.bad, confidence, category };
      }
    } catch {
      // fall through to the native form
    }
  }
  const native = content.match(/user safety:\s*(safe|unsafe)/i) ?? content.match(/^\s*(safe|unsafe)\b/im);
  const nativeWord = native?.[1]?.toLowerCase();
  if (nativeWord === 'safe' || nativeWord === 'unsafe') {
    const bad = nativeWord === 'unsafe';
    return { bad, confidence: bad ? 0.9 : 0, category: bad ? 'unsafe' : 'none' };
  }
  return null;
}

/** Classify one piece of text. Always resolves — never rejects. */
export async function classifyText(env: Env, text: string, timeoutMs = 6000): Promise<SlmResult> {
  const chain = buildChain(env);
  if (chain.length === 0) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model: 'none', error: 'slm disabled' };
  }

  const body = text.trim();
  if (body.length === 0) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model: 'none', error: 'empty' };
  }

  const failures: string[] = [];
  for (const attempt of chain) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${attempt.key}`,
        },
        body: JSON.stringify({
          model: attempt.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: body.slice(0, 2000) },
          ],
          temperature: 0,
          max_tokens: 128,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        failures.push(`${attempt.name} HTTP ${res.status}`);
        continue;
      }

      const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = j.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        failures.push(`${attempt.name} empty`);
        continue;
      }

      const verdict = parseVerdict(content);
      if (!verdict) {
        failures.push(`${attempt.name} unparseable`);
        continue;
      }
      return { ok: true, model: attempt.model, ...verdict };
    } catch (err) {
      failures.push(`${attempt.name} ${err instanceof Error ? err.name : 'error'}`);
    }
  }

  return { ok: false, bad: false, confidence: 0, category: 'none', model: 'none', error: failures.join(' | ') };
}
