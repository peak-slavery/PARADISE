import { describe, expect, it } from 'vitest';

import { BOT_IDS, getAllowedRuntimeSecrets, getRuntimeSecretMappings } from './index.js';

describe('runtime secret policy', () => {
  it('gives every bot only common runtime records plus its own providers', () => {
    const common = [
      'mongodb.primary.uri',
      'mongodb.primary.database',
      'mongodb.secondary.uri',
      'mongodb.secondary.database',
      'redis.primary.url',
      'redis.primary.token',
      'supabase.runtime.url',
      'supabase.runtime.service_key',
    ];
    for (const botId of BOT_IDS) {
      expect(getAllowedRuntimeSecrets(botId).slice(0, common.length)).toEqual(common);
    }
    expect(getAllowedRuntimeSecrets('niko-robin')).toContain('provider.brave.api_key');
    expect(getAllowedRuntimeSecrets('niko-robin')).toContain('provider.serpapi.api_key');
    expect(getAllowedRuntimeSecrets('cyrene')).toEqual([...common, 'provider.groq.api_key', 'provider.gemini.api_key', 'provider.openrouter.api_key', 'provider.mistral.api_key']);
    expect(getAllowedRuntimeSecrets('zoro')).toContain('provider.groq_automod.api_key');
    expect(getAllowedRuntimeSecrets('shanks')).toEqual(common);
  });

  it('fails closed for unknown bots', () => {
    expect(getAllowedRuntimeSecrets('unknown')).toEqual([]);
    expect(getRuntimeSecretMappings(null)).toEqual([]);
  });
});
