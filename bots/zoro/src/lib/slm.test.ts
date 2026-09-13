import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env, Logger } from '@eiflow/shared';
import { classifyContent, parseVerdict, slmEnabled } from './slm.js';

const warn = vi.fn();
const log = { warn } as unknown as Logger;

function env(overrides: Partial<Env> = {}): Env {
  return {
    hasCerebras: true,
    cerebrasApiKey: 'test-key',
    zoroSlmModel: 'not-a-provider-model',
    zoroSlmMaxTokens: 999,
    zoroSlmContextChars: 9999,
    ...overrides,
  } as Env;
}

function response(content: string, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseVerdict', () => {
  it('accepts only a strict JSON object and clamps confidence/category', () => {
    expect(parseVerdict('{"bad":true,"confidence":1.7,"category":"hate"}')).toEqual({
      bad: true,
      confidence: 1,
      category: 'hate',
    });
    expect(parseVerdict('{"bad":false,"confidence":-1,"category":"none"}')).toEqual({
      bad: false,
      confidence: 0,
      category: 'none',
    });
    expect(parseVerdict('{"bad":true,"confidence":0.5,"category":"unknown"}')).toBeNull();
  });

  it('rejects prose, string booleans, non-finite confidence, and malformed JSON', () => {
    expect(parseVerdict('Verdict: {"bad":true,"confidence":1,"category":"hate"}')).toBeNull();
    expect(parseVerdict('{"bad":"true","confidence":1,"category":"hate"}')).toBeNull();
    expect(parseVerdict('{"bad":true,"confidence":null,"category":"hate"}')).toBeNull();
    expect(parseVerdict('{"bad":true')).toBeNull();
  });
});

describe('classifyContent', () => {
  it('sends only the Cerebras request with the safe model and hard payload caps', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('{"bad":true,"confidence":0.9,"category":"hate"}'));
    const input = `  ${'a'.repeat(2500)}  `;

    const result = await classifyContent(env(), input, log);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body)) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };

    expect(result).toMatchObject({ ok: true, bad: true, confidence: 0.9, category: 'hate', model: 'qwen-3.8-27b' });
    expect(url).toBe('https://api.cerebras.ai/v1/chat/completions');
    expect(payload.model).toBe('qwen-3.8-27b');
    expect(payload.max_tokens).toBe(64);
    expect(payload.messages[1]?.content).toHaveLength(2000);
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses configured lower token and context limits without exceeding hard caps', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('{"bad":false,"confidence":0,"category":"none"}'));

    await classifyContent(env({ zoroSlmMaxTokens: 12, zoroSlmContextChars: 17 }), 'x'.repeat(100), log);
    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as { max_tokens: number; messages: Array<{ content: string }> };
    expect(payload.max_tokens).toBe(12);
    expect(payload.messages[1]?.content).toHaveLength(17);
  });

  it.each([
    ['non-2xx', Promise.resolve(new Response('nope', { status: 503 }))],
    ['empty output', Promise.resolve(response(''))],
    ['malformed output', Promise.resolve(response('not json'))],
  ])('fails open for %s', async (_name, upstream) => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(upstream);
    const result = await classifyContent(env(), 'hello', log);
    expect(result).toMatchObject({ ok: false, bad: false, confidence: 0, category: 'none' });
  });

  it('fails open for transport errors without logging secrets or raw user text', async () => {
    const input = 'private user content';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network failed'));
    const result = await classifyContent(env(), input, log);
    expect(result).toMatchObject({ ok: false, bad: false, confidence: 0, category: 'none' });
    expect(warn).toHaveBeenCalledWith({ model: 'qwen-3.8-27b' }, 'slm classify failed');
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ err: expect.anything() }), expect.anything());
    expect(JSON.stringify(warn.mock.calls)).not.toContain(input);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test-key');
  });

  it('fails open when the upstream request times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const result = await classifyContent(env(), 'hello', log);
    expect(result).toMatchObject({ ok: false, bad: false, confidence: 0, category: 'none', error: 'TimeoutError' });
  });

  it('does not call fetch when the Cerebras key is disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await classifyContent(env({ hasCerebras: false, cerebrasApiKey: undefined }), 'hello', log);
    expect(slmEnabled(env({ hasCerebras: false }))).toBe(false);
    expect(result).toMatchObject({ ok: false, bad: false, confidence: 0, category: 'none', model: 'qwen-3.8-27b' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
