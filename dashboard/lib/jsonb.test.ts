import { describe, expect, it } from 'vitest';

import { DEFAULT_JSONB_LIMITS, validateJsonbObject } from './jsonb';

describe('validateJsonbObject', () => {
  it('accepts a small plain object', () => {
    const result = validateJsonbObject({ theme: 'dark', count: 3, enabled: true, note: null });
    expect(result).toEqual({
      ok: true,
      value: { theme: 'dark', count: 3, enabled: true, note: null },
    });
  });

  it('rejects arrays at the top level', () => {
    expect(validateJsonbObject([])).toEqual({ ok: false, value: null, reason: 'not-an-object' });
  });

  it('rejects null and primitive roots', () => {
    expect(validateJsonbObject(null)).toEqual({ ok: false, value: null, reason: 'not-an-object' });
    expect(validateJsonbObject('hello')).toEqual({ ok: false, value: null, reason: 'not-an-object' });
    expect(validateJsonbObject(42)).toEqual({ ok: false, value: null, reason: 'not-an-object' });
  });

  it('rejects when nested depth exceeds the cap', () => {
    const deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < DEFAULT_JSONB_LIMITS.maxDepth + 2; i++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.leaf = true;
    expect(validateJsonbObject(deep)).toEqual({ ok: false, value: null, reason: 'depth-exceeded' });
  });

  it('rejects when a single object has too many keys', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < DEFAULT_JSONB_LIMITS.maxKeysPerObject + 1; i++) {
      wide[`k${i}`] = i;
    }
    expect(validateJsonbObject(wide)).toEqual({ ok: false, value: null, reason: 'keys-exceeded' });
  });

  it('rejects non-finite numbers', () => {
    const result = validateJsonbObject({ score: Number.NaN });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported-value');
  });

  it('rejects values that exceed the byte budget', () => {
    const longString = 'a'.repeat(DEFAULT_JSONB_LIMITS.maxBytes + 1);
    const result = validateJsonbObject({ note: longString });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bytes-exceeded');
  });

  it('measures the byte budget using UTF-8 bytes', () => {
    const result = validateJsonbObject({ note: '🙂'.repeat(DEFAULT_JSONB_LIMITS.maxBytes) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bytes-exceeded');
  });

  it('preserves prototype-shaped keys as inert data', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"value":1}}') as Record<string, unknown>;
    const result = validateJsonbObject(input);
    expect(result.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects objects with very long keys', () => {
    const result = validateJsonbObject({ ['k'.repeat(120)]: 'v' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported-value');
  });
});
