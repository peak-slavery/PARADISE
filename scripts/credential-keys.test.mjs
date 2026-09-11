import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroqAutomodKey } from './credential-keys.mjs';

test('uses the normal GROQ key when the AutoMod label is absent', () => {
  assert.equal(resolveGroqAutomodKey({ explicit: '', normal: 'normal-key' }), 'normal-key');
});

test('prefers an explicit AutoMod GROQ key when present', () => {
  assert.equal(resolveGroqAutomodKey({ explicit: 'automod-key', normal: 'normal-key' }), 'automod-key');
});
