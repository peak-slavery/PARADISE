import { randomUUID, createHmac } from 'node:crypto';

type VaultCacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, VaultCacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export async function loadVaultSecret(name: string): Promise<string | null> {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const baseUrl = process.env.DASHBOARD_URL?.trim();
  const botId = process.env.BOT_ID?.trim();
  const hmacSecret = process.env.HMAC_SECRET?.trim();
  if (!baseUrl || !botId || !hmacSecret) {
    return null;
  }
  const body = JSON.stringify({ request_id: randomUUID().replace(/-/g, ''), bot_id: botId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/secret/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pe-bot-id': botId,
        'x-pe-timestamp': timestamp,
        'x-pe-signature': sign(hmacSecret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const payload = await response.json() as { value?: unknown };
    if (typeof payload.value !== 'string') return null;
    cache.set(name, { value: payload.value, expiresAt: Date.now() + CACHE_TTL_MS });
    return payload.value;
  } catch {
    return null;
  }
}

/**
 * Hydrate only provider credentials that are absent from the process env. The
 * bot keeps Discord identity/HMAC configuration local, while MongoDB, Redis,
 * runtime Supabase, and optional provider credentials can remain in the vault.
 */
export async function hydrateRuntimeSecrets(): Promise<void> {
  const mappings = [
    ['DISCORD_TOKEN', `discord.${process.env.BOT_ID ?? ''}.token`],
    ['SUPABASE_URL', 'supabase.runtime.url'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'supabase.runtime.service_key'],
    ['MONGODB_URI', 'mongodb.primary.uri'],
    ['MONGODB_DB', 'mongodb.primary.database'],
    ['MONGODB_SECONDARY_URI', 'mongodb.secondary.uri'],
    ['MONGODB_SECONDARY_DB', 'mongodb.secondary.database'],
    ['UPSTASH_REDIS_REST_URL', 'redis.primary.url'],
    ['UPSTASH_REDIS_REST_TOKEN', 'redis.primary.token'],
  ] as const;
  if (!process.env.DASHBOARD_URL?.trim() || !process.env.BOT_ID?.trim() || !process.env.HMAC_SECRET?.trim()) return;

  for (const [envName, secretName] of mappings) {
    if (process.env[envName]?.trim() || secretName.endsWith('.token') && !process.env.BOT_ID?.trim()) continue;
    const value = await loadVaultSecret(secretName);
    if (value) process.env[envName] = value;
  }
}

export function clearVaultSecretCache(): void {
  cache.clear();
}
