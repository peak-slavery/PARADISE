import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearVaultSecretCache, hydrateRuntimeSecrets } from './vault-client.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  clearVaultSecretCache();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('runtime vault hydration', () => {
  it('fetches only the provider records allowed for the current bot', async () => {
    process.env.BOT_ID = 'cyrene';
    process.env.DASHBOARD_URL = 'https://dashboard.example';
    process.env.HMAC_SECRET = 'h'.repeat(32);
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MONGODB_URI', 'MONGODB_SECONDARY_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AGNES_IMAGE_API_KEY', 'MISTRAL_API_KEY']) {
      delete process.env[name];
    }

    const expectedRequestNames = [
      'mongodb.primary.uri',
      'mongodb.primary.database',
      'mongodb.secondary.uri',
      'mongodb.secondary.database',
      'redis.primary.url',
      'redis.primary.token',
      'supabase.runtime.url',
      'supabase.runtime.service_key',
      'provider.groq.api_key',
      'provider.gemini.api_key',
      'provider.openrouter.api_key',
      'provider.agnes.api_key',
      'provider.mistral.api_key',
    ];
    const expectedResponses = Object.fromEntries(expectedRequestNames.map((name) => [name, `value-${name}`]));
    const fetchSecret = vi.fn(async (name: string) => expectedResponses[name as keyof typeof expectedResponses] ?? null);
    const result = await hydrateRuntimeSecrets({ fetchSecret });

    expect(fetchSecret).toHaveBeenCalledTimes(expectedRequestNames.length);
    expect(fetchSecret).toHaveBeenCalledWith('provider.agnes.api_key');
    expect(fetchSecret).not.toHaveBeenCalledWith('discord.cyrene.token');
    expect(process.env.GROQ_API_KEY).toBe(expectedResponses['provider.groq.api_key']);
    expect(process.env.AGNES_IMAGE_API_KEY).toBe(expectedResponses['provider.agnes.api_key']);
    expect(process.env.MISTRAL_API_KEY).toBe(expectedResponses['provider.mistral.api_key']);
    expect(result.loaded).toContain('provider.groq.api_key');
  });

  it('fails closed and performs no requests when bot identity is unknown', async () => {
    process.env.BOT_ID = 'not-a-bot';
    process.env.DASHBOARD_URL = 'https://dashboard.example';
    process.env.HMAC_SECRET = 'h'.repeat(32);
    const fetchSecret = vi.fn(async () => 'should-not-load');

    await expect(hydrateRuntimeSecrets({ fetchSecret })).resolves.toEqual({
      attempted: [],
      loaded: [],
      missing: [],
      failed: [],
    });
    expect(fetchSecret).not.toHaveBeenCalled();
  });
});
