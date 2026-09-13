import type { Env } from '@eiflow/shared';

export const TTS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const TTS_TEXT_MAX = 800;
export const TTS_MAX_BYTES = 10 * 1024 * 1024;

export class TtsResponseError extends Error {
  override readonly name = 'TtsResponseError';
}

export interface TtsMedia {
  data: Buffer;
  transcript?: string;
}

export function validateTtsText(value: string | null | undefined): string {
  const text = value?.trim() ?? '';
  if (text.length === 0) throw new TtsResponseError('Please provide text to speak.');
  if (text.length > TTS_TEXT_MAX) throw new TtsResponseError(`Speech text must be ${TTS_TEXT_MAX} characters or fewer.`);
  return text;
}

function decode(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const data = Buffer.from(value, 'base64');
  return data.length > 0 ? data : null;
}

function parseAudioJson(body: Buffer): TtsMedia | null {
  try {
    const value = JSON.parse(body.toString('utf8')) as {
      choices?: Array<{ message?: { audio?: { data?: string; transcript?: string } } }>;
    };
    const audio = value.choices?.[0]?.message?.audio;
    const data = decode(audio?.data);
    return data ? { data, transcript: audio?.transcript } : null;
  } catch {
    return null;
  }
}

function parseAudioSse(body: Buffer): TtsMedia | null {
  let encoded = '';
  let transcript = '';
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const value = line.slice(6).trim();
    if (value === '[DONE]') continue;
    try {
      const chunk = JSON.parse(value) as { choices?: Array<{ delta?: { audio?: { data?: string; transcript?: string } } }> };
      const audio = chunk.choices?.[0]?.delta?.audio;
      if (audio?.data) encoded += audio.data;
      if (audio?.transcript) transcript += audio.transcript;
    } catch {
      // Require at least one valid audio payload; malformed chunks are ignored.
    }
  }
  const data = decode(encoded);
  return data ? { data, transcript: transcript || undefined } : null;
}

export async function synthesizeSpeech(env: Env, text: string, signal?: AbortSignal): Promise<TtsMedia> {
  if (!env.openrouterApiKey || !env.cyreneTtsModel || !env.cyreneTtsVoice) {
    throw new TtsResponseError('Speech synthesis is not configured.');
  }
  const response = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openrouterApiKey}` },
    body: JSON.stringify({
      model: env.cyreneTtsModel,
      messages: [{ role: 'user', content: text }],
      modalities: ['text', 'audio'],
      audio: { voice: env.cyreneTtsVoice, format: 'mp3' },
      stream: true,
    }),
    signal,
  });

  if (!response.ok) throw new TtsResponseError(`Speech synthesis returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > TTS_MAX_BYTES) throw new TtsResponseError('Generated audio is too large.');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > TTS_MAX_BYTES) throw new TtsResponseError('Generated audio was empty or too large.');
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const media = contentType.includes('audio/') ? { data: body } : contentType.includes('application/json') ? parseAudioJson(body) : contentType.includes('text/event-stream') ? parseAudioSse(body) : null;
  if (!media || media.data.length > TTS_MAX_BYTES) throw new TtsResponseError('Audio response was not valid audio.');
  return media;
}
