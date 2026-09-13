import { describe, expect, it } from 'vitest';
import { shouldUseEphemeralReply, withTimeoutFallback } from './ai.js';

describe('Cyrene reply visibility', () => {
  it('keeps replies private by default', () => {
    expect(shouldUseEphemeralReply({})).toBe(true);
    expect(shouldUseEphemeralReply({ ephemeral: true })).toBe(true);
  });

  it('allows an explicitly public reply', () => {
    expect(shouldUseEphemeralReply({ ephemeral: false })).toBe(false);
  });

  it('falls back to private visibility when config is slow', async () => {
    const fallback = { ephemeral: true };
    const result = await withTimeoutFallback(new Promise<{ ephemeral: boolean }>(() => undefined), fallback, 10);
    expect(result).toEqual(fallback);
  });
});
