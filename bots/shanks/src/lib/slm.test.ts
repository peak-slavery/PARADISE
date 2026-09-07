import { describe, expect, it } from 'vitest';
import { parseVerdict } from './slm.js';

/** The one runnable check for the dual-shape SLM verdict parser. */
describe('parseVerdict', () => {
  it('parses strict JSON with clamped confidence and sliced category', () => {
    expect(parseVerdict('{"bad": true, "confidence": 1.7, "category": "hate"}')).toEqual({
      bad: true,
      confidence: 1,
      category: 'hate',
    });
    // JSON wrapped in prose must still parse (regex-extracted {...}).
    expect(parseVerdict('Verdict: {"bad": true, "confidence": 0.9, "category": "slur"} thanks')).toEqual({
      bad: true,
      confidence: 0.9,
      category: 'slur',
    });
    // Missing confidence defaults to 1 on bad, 0 on safe.
    expect(parseVerdict('{"bad": true}')).toMatchObject({ bad: true, confidence: 1 });
    expect(parseVerdict('{"bad": false}')).toMatchObject({ bad: false, confidence: 0 });
  });

  it("parses the NVIDIA safety models' native 'User Safety: safe|unsafe' line", () => {
    expect(parseVerdict('User Safety: unsafe')).toEqual({ bad: true, confidence: 0.9, category: 'unsafe' });
    expect(parseVerdict('user safety: Safe')).toEqual({ bad: false, confidence: 0, category: 'none' });
    // Bare leading safe/unsafe counts too.
    expect(parseVerdict('unsafe')).toMatchObject({ bad: true, confidence: 0.9 });
  });

  it('returns null on unparseable content so the caller can fall through the chain', () => {
    expect(parseVerdict('I think this is fine, no verdict given')).toBeNull();
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict('{"bad": "yes"}')).toBeNull();
  });
});
