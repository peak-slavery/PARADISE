import type { Env, Logger } from '@eiflow/shared';

/**
 * Model routing — two independent routes, each with its own model and its own
 * ordered fallback list. The routes never share a chain: `/cyrene` can never
 * end up answered by the assistant model, and `/ask` can never end up answered
 * by the Cyrene persona model.
 *
 *   cyrene    → Groq (CYRENE_MODEL, gpt-oss) → Groq (llama-3.3-70b-versatile)
 *               → Gemini → OpenRouter
 *   assistant → Mistral (ASSISTANT_MODEL)    → Groq (llama-3.3-70b-versatile)
 *               → Gemini → OpenRouter
 *
 * Every adapter exposes the same shape (`complete(messages, signal)`) so a
 * route can walk its list without knowing vendor specifics. A missing API key
 * or any transport/parse failure falls through to the next adapter; only when
 * the whole route is exhausted do we surface an "unavailable" embed.
 *
 * Uses Node 22's global fetch — no HTTP client dependency.
 */

export type AiRoute = 'cyrene' | 'assistant';

export const AI_ROUTES: readonly AiRoute[] = ['cyrene', 'assistant'] as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Provider {
  /** Stable, machine-readable id — safe to log. */
  id: string;
  /** Display name for footers and /model. */
  name: string;
  /** Model id sent upstream. */
  model: string;
  /** False when the API key is absent — the route skips it without a request. */
  available: boolean;
  complete(messages: ChatMessage[], signal: AbortSignal): Promise<string>;
}

/** Thrown only after every provider in a route has failed. */
export class AllProvidersFailedError extends Error {
  override readonly name = 'AllProvidersFailedError';
  constructor(public readonly failures: string[]) {
    super(`All AI providers failed: ${failures.join(' | ') || 'no provider configured'}`);
  }
}

/** Slightly under the queue timeout so the queue wins races, not the socket. */
export const REQUEST_TIMEOUT_MS = 18_000;

const DEFAULT_MAX_TOKENS = 1024;
const MAX_TOKENS_LIMIT = 4096;
const MIN_TOKENS_LIMIT = 16;

const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';
const OPENROUTER_FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct';

/** Model ids come from env, so they are whitelisted before hitting a URL or header. */
const SAFE_MODEL_ID = /^[A-Za-z0-9._:/-]{1,100}$/;

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
} as const;

/** Rejects junk/oversized model ids from env and substitutes a known-good one. */
export function safeModelId(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && SAFE_MODEL_ID.test(trimmed) ? trimmed : fallback;
}

/** Clamps an integer option into range, defaulting when it is not a number. */
export function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Clamps a temperature into 0..2, defaulting when it is not a number. */
export function clampTemperature(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}

const maxTokens = (value?: number): number =>
  clampInt(value, DEFAULT_MAX_TOKENS, MIN_TOKENS_LIMIT, MAX_TOKENS_LIMIT);

interface OpenAiLikeResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/** Pulls the leading system message out, Gemini takes it as a separate field. */
function splitSystem(messages: ChatMessage[]): { system: string | null; rest: ChatMessage[] } {
  const first = messages[0];
  const system = first?.role === 'system' ? (first.content ?? null) : null;
  const rest = system === null ? messages : messages.slice(1);
  return { system, rest };
}

/**
 * Upstream error bodies are not safe to retain: providers may echo prompts,
 * request metadata, or credentials in them. Keep only the provider and status;
 * this is sufficient for routing diagnostics without copying response content
 * into logs or Sentry.
 */
function httpError(prefix: string, res: Response): Error {
  return new Error(`${prefix} returned HTTP ${res.status}`);
}

interface OpenAiLikeOptions {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string | undefined;
  model: string;
  env: Env;
  temperature?: number;
  maxTokens?: number;
}

/** Groq, Mistral and OpenRouter all speak the OpenAI chat-completions schema. */
function openAiLikeProvider(opts: OpenAiLikeOptions): Provider {
  const { id, name, endpoint, apiKey, model } = opts;
  return {
    id,
    name,
    model,
    available: Boolean(apiKey),
    async complete(messages, signal) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: clampTemperature(opts.temperature, 0.7),
          max_tokens: maxTokens(opts.maxTokens),
        }),
        signal,
      });

      if (!res.ok) throw httpError(id, res);

      const json = (await res.json()) as OpenAiLikeResponse;
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${id} returned an empty completion`);
      return text;
    },
  };
}

function groqProvider(env: Env, model: string): Provider {
  return openAiLikeProvider({
    id: 'groq',
    name: 'Groq',
    endpoint: ENDPOINTS.groq,
    apiKey: env.groqApiKey,
    model: safeModelId(model, GROQ_FALLBACK_MODEL),
    env,
    temperature: 0.7,
  });
}

function mistralProvider(env: Env, model: string): Provider {
  return openAiLikeProvider({
    id: 'mistral',
    name: 'Mistral',
    endpoint: ENDPOINTS.mistral,
    apiKey: env.mistralApiKey,
    model: safeModelId(model, 'mistral-small-latest'),
    env,
    temperature: 0.5,
  });
}

function geminiProvider(env: Env): Provider {
  const model = GEMINI_FALLBACK_MODEL;
  return {
    id: 'gemini',
    name: 'Gemini',
    model,
    available: Boolean(env.geminiApiKey),
    async complete(messages, signal) {
      const { system, rest } = splitSystem(messages);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.geminiApiKey ?? '')}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: rest.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: clampTemperature(0.8, 0.7),
            maxOutputTokens: maxTokens(),
          },
        }),
        signal,
      });

      if (!res.ok) throw httpError('gemini', res);

      const json = (await res.json()) as GeminiResponse;
      const text = json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) throw new Error('gemini returned an empty completion');
      return text;
    },
  };
}

function openrouterProvider(env: Env): Provider {
  return openAiLikeProvider({
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: ENDPOINTS.openrouter,
    apiKey: env.openrouterApiKey,
    model: OPENROUTER_FALLBACK_MODEL,
    env,
    temperature: 0.7,
  });
}

export interface RouteDescriptor {
  route: AiRoute;
  /** Human label for logs and /model. */
  label: string;
  primary: Provider;
  /** Ordered fallbacks, only consulted when the primary fails. */
  fallbacks: Provider[];
}

/** The ordered provider list for one route. Built fresh from env every call. */
export function createRoute(env: Env, route: AiRoute): RouteDescriptor {
  // The two routes share only the tail of their chain; the head is distinct.
  const sharedTail = [geminiProvider(env), openrouterProvider(env)];

  if (route === 'cyrene') {
    const primary = groqProvider(env, env.cyreneModel);
    const groqFallback = groqProvider(env, GROQ_FALLBACK_MODEL);
    const tail = primary.model === groqFallback.model ? [] : [groqFallback];
    return {
      route,
      label: 'Cyrene (persona)',
      primary,
      fallbacks: [...tail, ...sharedTail],
    };
  }

  return {
    route,
    label: 'Assistant',
    primary: mistralProvider(env, env.assistantModel),
    fallbacks: [groqProvider(env, GROQ_FALLBACK_MODEL), ...sharedTail],
  };
}

export function createRoutes(env: Env): Record<AiRoute, RouteDescriptor> {
  return { cyrene: createRoute(env, 'cyrene'), assistant: createRoute(env, 'assistant') };
}

/** Every provider in a route, primary first, in the order they are tried. */
export function routeChain(route: RouteDescriptor): Provider[] {
  return [route.primary, ...route.fallbacks];
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
}

/**
 * Walks one route in order, logging and swallowing each failure. Never throws
 * for a single provider; throws AllProvidersFailedError only when the route is
 * exhausted (which the caller renders as a friendly embed).
 */
export async function completeWithFallback(
  route: RouteDescriptor,
  messages: ChatMessage[],
  opts: { signal: AbortSignal; log: Logger },
): Promise<CompletionResult> {
  const usable = routeChain(route).filter((p) => p.available);
  if (usable.length === 0) {
    throw new AllProvidersFailedError([`no provider API key configured for the ${route.route} route`]);
  }

  const failures: string[] = [];
  for (const provider of usable) {
    try {
      const text = await provider.complete(messages, opts.signal);
      return { text, provider: provider.name, model: provider.model };
    } catch {
      // Keep provider response bodies and exception messages out of logs/Sentry;
      // the provider id and route are sufficient for fallback diagnostics.
      failures.push(`${provider.name}: provider_error`);
      opts.log.warn({ provider: provider.id, route: route.route }, 'ai provider failed, falling through');
    }
  }

  throw new AllProvidersFailedError(failures);
}

export interface RouteReportEntry {
  route: AiRoute;
  label: string;
  primaryName: string;
  primaryModel: string;
  /** Key-present booleans only — a key value is never surfaced, not even masked. */
  primaryKeyPresent: boolean;
  fallbacks: Array<{ name: string; model: string; keyPresent: boolean }>;
}

/** Diagnostic view for /model. Booleans and model names only, never a key. */
export function describeRoute(env: Env, route: AiRoute): RouteReportEntry {
  const desc = createRoute(env, route);
  return {
    route,
    label: desc.label,
    primaryName: desc.primary.name,
    primaryModel: desc.primary.model,
    primaryKeyPresent: desc.primary.available,
    fallbacks: desc.fallbacks.map((p) => ({
      name: p.name,
      model: p.model,
      keyPresent: p.available,
    })),
  };
}
