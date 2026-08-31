import type { Env, Logger } from '@eiflow/shared';

/**
 * SLM-assisted bad-word / toxicity detection.
 *
 * This is the "second opinion" layer: Discord's own AutoMod already flags
 * obvious content. When an `AutoModerationActionExecution` fires we forward
 * the *original* content to a small, fast Groq model and ask it to decide
 * whether the message is actually a slur, threat, sexual content or severe
 * insult — including evasive forms (leetspeak, spacing, unicode) that static
 * word lists miss. The dedicated `GROQ_AUTOMOD_API_KEY` keeps this traffic off
 * the chat quota.
 *
 * Design rules:
 *   - Never throws. A transport/parse failure is a "not bad" verdict, because
 *     failing closed (silently deleting legit speech) is worse than failing
 *     open here — the audit log still records the AutoMod trigger.
 *   - The model is asked for strict JSON only; we parse defensively.
 *   - The API key is never logged, only the model id.
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const SAFE_MODEL = /^[A-Za-z0-9._:-]{1,100}$/;

export interface SlmVerdict {
  /** True when the model judged the content worth escalating. */
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
  return env.hasAutomodSlm;
}

function safeModel(env: Env): string {
  const m = env.automodSlmModel?.trim();
  return m && SAFE_MODEL.test(m) ? m : 'llama-3.1-8b-instant';
}

const SYSTEM_PROMPT = [
  'You are a strict content moderator for a Discord server.',
  'Decide whether the user message contains a slur, hate speech, direct threat of violence, or explicit sexual content that the server static filters missed.',
  'Be precise: do NOT flag mild profanity, jokes, sarcasm, or reclaimed terms. Only flag genuinely harmful content.',
  'Respond with ONLY a JSON object of the form {"bad": boolean, "confidence": number between 0 and 1, "category": "slur"|"hate"|"threat"|"sexual"|"insult"|"none"}.',
].join(' ');

/** Classify one piece of text. Always resolves — never rejects. */
export async function classifyContent(
  env: Env,
  text: string,
  log: Logger,
  timeoutMs = 6000,
): Promise<SlmResult> {
  const model = safeModel(env);
  if (!env.hasAutomodSlm || !env.groqAutomodApiKey) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'slm disabled' };
  }

  const body = text.trim();
  if (body.length === 0) {
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error: 'empty' };
  }

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.groqAutomodApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: body.slice(0, 2000) },
        ],
        temperature: 0,
        max_tokens: 64,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, bad: false, confidence: 0, category: 'none', model, error: `groq ${res.status}` };
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? '';
    return { ok: true, ...parseVerdict(raw), model };
  } catch (err) {
    log.warn({ err, model }, 'slm classify failed');
    return { ok: false, bad: false, confidence: 0, category: 'none', model, error: String(err) };
  }
}

/** Extracts the first JSON object from arbitrary model output. */
function parseVerdict(raw: string): SlmVerdict {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const fallback: SlmVerdict = { bad: false, confidence: 0, category: 'none' };
  if (start === -1 || end === -1 || end <= start) return fallback;

  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const bad = obj.bad === true || obj.bad === 'true';
    const confidence =
      typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : bad ? 0.8 : 0;
    const category = typeof obj.category === 'string' ? obj.category.slice(0, 40) : bad ? 'unknown' : 'none';
    return { bad, confidence, category };
  } catch {
    return fallback;
  }
}
