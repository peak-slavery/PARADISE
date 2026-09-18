import { randomUUID } from 'node:crypto';
import { signRequestWithContext } from './hmac.js';
import {
  getRuntimeSecretMappings,
  isBotId,
  type RuntimeSecretMapping,
} from '@eiflow/secret-policy';

type VaultCacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, VaultCacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export async function loadVaultSecret(name: string): Promise<string | null> {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const baseUrl = process.env.DASHBOARD_URL?.trim();
  const botId = process.env.BOT_ID?.trim();
  const hmacSecret = process.env.HMAC_SECRET?.trim();
  if (!baseUrl || !botId || !hmacSecret) return null;
  let dashboardUrl: URL;
  try {
    dashboardUrl = new URL(baseUrl);
    if (dashboardUrl.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const requestId = randomUUID().replace(/-/g, '');
  const route = `/api/internal/secret/${encodeURIComponent(name)}`;
  const body = JSON.stringify({ request_id: requestId, bot_id: botId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequestWithContext(hmacSecret, body, {
    method: 'POST',
    route,
    botId,
    requestId,
    guildId: null,
  });
  try {
    const response = await fetch(`${dashboardUrl.origin}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pe-method': 'POST',
        'x-pe-route': route,
        'x-pe-bot-id': botId,
        'x-pe-request-id': requestId,
        'x-pe-timestamp': timestamp,
        'x-pe-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

export type HydrationResult = {
  attempted: string[];
  loaded: string[];
  missing: string[];
  failed: string[];
};

/**
 * Hydrate only the runtime records allowed for this bot and absent from its
 * explicit environment. Discord identity is deliberately never vault-backed:
 * a bot must receive its token directly from the hosting provider.
 */
export async function hydrateRuntimeSecrets(options: {
  botId?: string;
  fetchSecret?: (name: string) => Promise<string | null>;
} = {}): Promise<HydrationResult> {
  const botId = options.botId ?? process.env.BOT_ID?.trim();
  const mappings = getRuntimeSecretMappings(botId);
  const result: HydrationResult = { attempted: [], loaded: [], missing: [], failed: [] };
  if (!isBotId(botId) || !process.env.DASHBOARD_URL?.trim() || !process.env.HMAC_SECRET?.trim()) return result;

  const pending = mappings.filter(({ envName }) => !process.env[envName]?.trim());
  result.attempted.push(...pending.map(({ name }) => name));
  const fetchSecret = options.fetchSecret ?? loadVaultSecret;
  const settled = await Promise.allSettled(pending.map(async (mapping) => ({
    mapping,
    value: await fetchSecret(mapping.name),
  })));

  for (let index = 0; index < settled.length; index += 1) {
    const mapping = pending[index] as RuntimeSecretMapping;
    const outcome = settled[index];
    if (!outcome || outcome.status === 'rejected') {
      result.failed.push(mapping.name);
      continue;
    }
    if (outcome.value.value) {
      process.env[mapping.envName] = outcome.value.value;
      result.loaded.push(mapping.name);
    } else {
      result.missing.push(mapping.name);
    }
  }
  return result;
}

export function clearVaultSecretCache(): void {
  cache.clear();
}
