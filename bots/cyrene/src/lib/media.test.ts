import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@eiflow/shared';
import { createRoute } from './providers.js';
import { generateImage, MediaResponseError, validateImagePrompt } from './image.js';
import { synthesizeSpeech, TTS_MAX_BYTES, TtsResponseError, validateTtsText } from './tts.js';

const env = {
  openrouterApiKey: 'tts-key',
  agnesImageApiKey: 'agnes-key',
  agnesImageModel: 'openai/gpt-image-1',
  cyreneTtsModel: 'openai/gpt-4o-mini-tts',
  cyreneTtsVoice: 'alloy',
  groqApiKey: 'groq-key',
  mistralApiKey: 'mistral-key',
  geminiApiKey: undefined,
  cyreneModel: 'openai/gpt-oss-20b',
  assistantModel: 'ministral-8b-latest',
} as unknown as Env;

const fetchMock = (response: Response): void => {
  vi.stubGlobal('fetch', vi.fn(async () => response));
};

afterEach(() => vi.unstubAllGlobals());

describe('Cyrene media validation', () => {
  it('caps image prompts and speech text', () => {
    expect(() => validateImagePrompt('x'.repeat(1001))).toThrow(MediaResponseError);
    expect(() => validateTtsText('x'.repeat(801))).toThrow(TtsResponseError);
    expect(validateImagePrompt('  a cat  ')).toBe('a cat');
    expect(validateTtsText('  hello  ')).toBe('hello');
  });
});

describe('Agnes image route', () => {
  it('fails closed until the assigned provider contract is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(generateImage(env, 'a moonlit garden')).rejects.toThrow(
      'Image generation is unavailable until the Agnes provider endpoint is configured.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('OpenRouter TTS route', () => {
  it('accepts JSON audio and sends the audio contract', async () => {
    const audio = Buffer.from('mp3').toString('base64');
    fetchMock(new Response(JSON.stringify({ choices: [{ message: { audio: { data: audio, transcript: 'hello' } } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await synthesizeSpeech(env, 'hello');
    expect(result.data.toString()).toBe('mp3');
    expect(result.transcript).toBe('hello');
    const request = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: 'openai/gpt-4o-mini-tts',
      modalities: ['text', 'audio'],
      audio: { voice: 'alloy', format: 'mp3' },
    });
  });

  it.each([
    ['non-2xx', new Response('', { status: 401 })],
    ['empty', new Response('', { status: 200, headers: { 'content-type': 'audio/mpeg' } })],
    ['malformed', new Response('{"choices":[{}]}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['oversized', new Response('x', { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(TTS_MAX_BYTES + 1) } })],
  ])('rejects %s responses', async (_name, response) => {
    fetchMock(response);
    await expect(synthesizeSpeech(env, 'test')).rejects.toThrow(TtsResponseError);
  });
});

describe('Cyrene text route isolation', () => {
  it('keeps Cyrene and assistant primary routes separate', () => {
    const cyrene = createRoute(env, 'cyrene');
    const assistant = createRoute(env, 'assistant');
    expect(cyrene.primary.id).toBe('groq');
    expect(assistant.primary.id).toBe('mistral');
    expect(cyrene.primary.model).toBe('openai/gpt-oss-20b');
    expect(assistant.primary.model).toBe('ministral-8b-latest');
  });
});
