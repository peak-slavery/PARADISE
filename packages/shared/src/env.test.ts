import { describe, expect, it } from 'vitest';
import { loadDeployEnv } from './env.js';

describe('deploy environment', () => {
  it('accepts the minimal Render command-registration environment', () => {
    expect(
      loadDeployEnv({
        BOT_ID: 'niko-robin',
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: '1479781452987109377',
      }),
    ).toEqual({
      botId: 'niko-robin',
      discordToken: 'discord-token',
      discordClientId: '1479781452987109377',
    });
  });

  it('loads the normalized provider and bounded Zoro SLM contract', async () => {
    const { loadEnv, resetEnvCache } = await import('./env.js');
    resetEnvCache();
    const env = loadEnv({
      BOT_ID: 'zoro',
      BOT_NAME: 'Zoro',
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '1544547167858069504',
      OWNER_IDS: '123456789012345678',
      MASTER_DISCORD_ID: '123456789012345678',
      CEREBRAS_API_KEY: 'cerebras-key',
      OPENROUTER_API_KEY: 'openrouter-key',
      AGNES_IMAGE_API_KEY: 'agnes-key',
      CYRENE_TTS_MODEL: 'openai/tts-1',
      CYRENE_TTS_VOICE: 'alloy',
    });

    expect(env.cerebrasApiKey).toBe('cerebras-key');
    expect(env.hasCerebras).toBe(true);
    expect(env.hasAgnesImage).toBe(true);
    expect(env.hasTts).toBe(true);
    expect(env.masterDiscordId).toBe('123456789012345678');
    expect(env.agnesImageModel).toBe('agnes-image-2.5-flash');
    expect(env.zoroSlmModel).toBe('qwen-3.8-27b');
    expect(env.zoroSlmMaxTokens).toBe(64);
    expect(env.zoroSlmContextChars).toBe(2000);
    resetEnvCache();

    const bounded = loadEnv({
      BOT_ID: 'zoro',
      BOT_NAME: 'Zoro',
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '1544547167858069504',
      ZORO_SLM_MAX_TOKENS: 1,
      ZORO_SLM_CONTEXT_CHARS: 1,
    });
    expect(bounded.zoroSlmMaxTokens).toBe(1);
    expect(bounded.zoroSlmContextChars).toBe(1);
    resetEnvCache();

    const upperBounded = loadEnv({
      BOT_ID: 'zoro',
      BOT_NAME: 'Zoro',
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '1544547167858069504',
      ZORO_SLM_MAX_TOKENS: 64,
      ZORO_SLM_CONTEXT_CHARS: 2000,
    });
    expect(upperBounded.zoroSlmMaxTokens).toBe(64);
    expect(upperBounded.zoroSlmContextChars).toBe(2000);
    expect(upperBounded).not.toHaveProperty('groqAutomodApiKey');
    expect(upperBounded).not.toHaveProperty('hasAutomodSlm');
    resetEnvCache();
  });

  it('rejects Zoro SLM limits outside their safe bounds', async () => {
    const { loadEnv, resetEnvCache } = await import('./env.js');
    resetEnvCache();
    expect(() => loadEnv({
      BOT_ID: 'zoro',
      BOT_NAME: 'Zoro',
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '1544547167858069504',
      ZORO_SLM_MAX_TOKENS: 65,
    })).toThrow(/ZORO_SLM_MAX_TOKENS/);
    resetEnvCache();
    expect(() => loadEnv({
      BOT_ID: 'zoro',
      BOT_NAME: 'Zoro',
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '1544547167858069504',
      ZORO_SLM_CONTEXT_CHARS: 2001,
    })).toThrow(/ZORO_SLM_CONTEXT_CHARS/);
    resetEnvCache();
  });
});
