import type { CommandContext } from '@eiflow/shared';
import { keys, QueueTimeoutError, sanitizeText, ServiceBusyError } from '@eiflow/shared';

/**
 * Web search with a resilient provider chain.
 *
 * Everything external goes through the shared task queue so a hanging provider
 * can never stall the Discord gateway, and every failure is classified into a
 * reason the command can render as a distinct, friendly embed.
 *
 * Order of operations:
 *   1. Redis cache hit  — costs no API call
 *   2. Brave Search     — primary provider
 *   3. SerpAPI          — fallback provider
 *   4. Cache the result — 1 hour
 */

export const CACHE_TTL_SECONDS = 3600;
export const PROVIDER_TIMEOUT_MS = 8000;
/** Discord embeds get cramped past 5 fields; the brief caps results here. */
export const MAX_RESULTS = 5;
/** One request per user per window, so nobody can drain the shared quota. */
export const COOLDOWN_SECONDS = 10;

export type ProviderName = 'brave' | 'serpapi';

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  brave: 'Brave Search',
  serpapi: 'SerpAPI',
};

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchFailureReason =
  | 'not_configured'
  | 'no_results'
  | 'rate_limited'
  | 'provider_error'
  | 'network'
  | 'timeout'
  | 'busy';

export type SearchOutcome =
  | { ok: true; results: SearchResult[]; provider: ProviderName; cached: boolean }
  | { ok: false; reason: SearchFailureReason; detail?: string };

interface CachedSearch {
  results: SearchResult[];
  provider: ProviderName;
  cachedAt: number;
}

type AttemptKind = 'ok' | 'empty' | 'rate_limited' | 'provider_error' | 'network' | 'timeout' | 'busy';

interface ProviderAttempt {
  provider: ProviderName;
  kind: AttemptKind;
  status?: number;
}

/** A provider answered with a non-2xx status, or a payload-level error. */
class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    public readonly kind: 'rate_limited' | 'provider_error',
    public readonly status: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

interface Provider {
  name: ProviderName;
  query(query: string, limit: number): Promise<SearchResult[]>;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

/**
 * GETs JSON through the shared queue. `AbortSignal.timeout` is what actually
 * kills a hanging socket; the queue timeout is the backstop that stops a wedged
 * provider from holding a concurrency slot forever.
 */
async function fetchJson(
  ctx: CommandContext,
  provider: ProviderName,
  url: URL,
  headers: Record<string, string>,
): Promise<unknown> {
  // The body read is inside the queue too: `res.json()` on a trickling response
  // can hang just as badly as the initial request.
  return ctx.services.queue.run(
    async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

      if (!res.ok) {
        // 401 = bad key, 403 = quota/plan, 429 = throttled. All are surfaced
        // distinctly rather than as a stack trace.
        const kind = res.status === 429 || res.status === 403 ? 'rate_limited' : 'provider_error';
        throw new ProviderError(kind, res.status, `${provider} responded ${res.status}`);
      }

      return (await res.json()) as unknown;
    },
    { timeoutMs: PROVIDER_TIMEOUT_MS + 500, maxPending: 16 },
  );
}

function normalise(value: string | undefined, fallback: string, max: number): string {
  const clean = sanitizeText(value ?? '', max);
  return clean.length > 0 ? clean : fallback;
}

/** Drops anything that is not a usable http(s) link before it reaches an embed. */
function isUsableUrl(url: string): boolean {
  return /^https?:\/\/\S+$/.test(url);
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

async function braveSearch(
  ctx: CommandContext,
  apiKey: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));

  const payload = (await fetchJson(ctx, 'brave', url, {
    Accept: 'application/json',
    'X-Subscription-Token': apiKey,
  })) as BraveResponse;

  const results = payload.web?.results ?? [];
  return results
    .map((r) => ({
      title: normalise(r.title, 'Untitled result', 120),
      url: (r.url ?? '').trim(),
      snippet: normalise(r.description, 'No description provided.', 300),
    }))
    .filter((r) => isUsableUrl(r.url))
    .slice(0, limit);
}

interface SerpapiResponse {
  organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  error?: string;
}

async function serpapiSearch(
  ctx: CommandContext,
  apiKey: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(limit));
  url.searchParams.set('engine', 'google');
  url.searchParams.set('api_key', apiKey);

  const payload = (await fetchJson(ctx, 'serpapi', url, { Accept: 'application/json' })) as SerpapiResponse;

  if (typeof payload.error === 'string' && payload.error.length > 0) {
    const throttled = /rate|limit|quota|exceeded/i.test(payload.error);
    throw new ProviderError(throttled ? 'rate_limited' : 'provider_error', undefined, sanitizeText(payload.error, 200));
  }

  const results = payload.organic_results ?? [];
  return results
    .map((r) => ({
      title: normalise(r.title, 'Untitled result', 120),
      url: (r.link ?? '').trim(),
      snippet: normalise(r.snippet, 'No description provided.', 300),
    }))
    .filter((r) => isUsableUrl(r.url))
    .slice(0, limit);
}

/** Providers are ordered: Brave is the primary, SerpAPI the fallback. */
function buildProviders(ctx: CommandContext): Provider[] {
  const { braveSearchApiKey, serpapiKey } = ctx.services.env;
  const brave = braveSearchApiKey;
  const serpapi = serpapiKey;

  const providers: Provider[] = [];
  if (brave) providers.push({ name: 'brave', query: (q, l) => braveSearch(ctx, brave, q, l) });
  if (serpapi) providers.push({ name: 'serpapi', query: (q, l) => serpapiSearch(ctx, serpapi, q, l) });
  return providers;
}

/* ------------------------------------------------------------------ */
/* Failure classification                                              */
/* ------------------------------------------------------------------ */

function classify(err: unknown, provider: ProviderName): ProviderAttempt {
  if (err instanceof ProviderError) {
    return { provider, kind: err.kind, status: err.status };
  }
  if (err instanceof ServiceBusyError) return { provider, kind: 'busy' };
  if (err instanceof QueueTimeoutError) return { provider, kind: 'timeout' };
  if (err instanceof Error && /abort|timeout/i.test(err.name)) return { provider, kind: 'timeout' };
  return { provider, kind: 'network' };
}

function failureFrom(attempts: ProviderAttempt[]): SearchOutcome {
  const kinds = attempts.map((a) => a.kind);

  // Providers answered, but nothing matched the query.
  if (kinds.includes('ok') || kinds.includes('empty')) return { ok: false, reason: 'no_results' };
  if (kinds.every((k) => k === 'rate_limited')) return { ok: false, reason: 'rate_limited' };
  if (kinds.every((k) => k === 'busy')) return { ok: false, reason: 'busy' };
  if (kinds.every((k) => k === 'timeout' || k === 'network')) {
    return { ok: false, reason: kinds.includes('timeout') ? 'timeout' : 'network' };
  }

  const detail = attempts
    .map((a) => `${a.provider}${a.status ? ` ${a.status}` : ''}`)
    .join(', ');
  return { ok: false, reason: 'provider_error', detail };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cache failures are never fatal: a Redis outage degrades to "no cache" rather
 * than failing the search.
 */
async function readCache(ctx: CommandContext, key: string): Promise<CachedSearch | null> {
  try {
    const cached = await ctx.services.redis.get<CachedSearch>(key);
    if (!cached || !Array.isArray(cached.results)) return null;
    return cached;
  } catch (err) {
    ctx.log.warn({ err }, 'search cache read failed');
    return null;
  }
}

async function writeCache(
  ctx: CommandContext,
  key: string,
  results: SearchResult[],
  provider: ProviderName,
): Promise<void> {
  try {
    await ctx.services.redis.set<CachedSearch>(key, { results, provider, cachedAt: Date.now() }, CACHE_TTL_SECONDS);
  } catch (err) {
    ctx.log.warn({ err }, 'search cache write failed');
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function searchWeb(ctx: CommandContext, rawQuery: string, limit: number): Promise<SearchOutcome> {
  // Sanitise before the value touches a cache key, a URL or an embed.
  const query = sanitizeText(rawQuery, 200);
  if (query.length === 0) return { ok: false, reason: 'no_results' };

  const cacheKey = keys.searchCache(query);
  const cached = await readCache(ctx, cacheKey);
  if (cached) {
    return {
      ok: true,
      results: cached.results.slice(0, limit),
      provider: cached.provider,
      cached: true,
    };
  }

  const providers = buildProviders(ctx);
  if (providers.length === 0) return { ok: false, reason: 'not_configured' };

  const attempts: ProviderAttempt[] = [];

  for (const provider of providers) {
    try {
      const results = await provider.query(query, limit);

      if (results.length === 0) {
        // A valid but empty answer is still an answer — try the next provider
        // before telling the user nothing was found.
        attempts.push({ provider: provider.name, kind: 'empty' });
        continue;
      }

      attempts.push({ provider: provider.name, kind: 'ok' });
      // Only non-empty results are cached, so a transient miss can be retried.
      await writeCache(ctx, cacheKey, results, provider.name);
      return { ok: true, results, provider: provider.name, cached: false };
    } catch (err) {
      const attempt = classify(err, provider.name);
      attempts.push(attempt);
      ctx.log.warn({ err, provider: provider.name, queryLength: query.length }, 'search provider failed');
    }
  }

  return failureFrom(attempts);
}
