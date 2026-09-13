import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCerebrasKey } from './credential-keys.mjs';

test('returns an empty value when Cerebras is not configured', () => {
  assert.equal(resolveCerebrasKey({ explicit: '' }), '');
});

test('trims an explicit Cerebras key', () => {
  assert.equal(resolveCerebrasKey({ explicit: ' cerebras-key ' }), 'cerebras-key');
});

test('prefers an environment assignment over the credential file', async () => {
  const { resolveCredential } = await import('./credential-keys.mjs');
  assert.equal(resolveCredential({
    raw: 'GROQ_API_KEY=file-key\n"gpt oss" = descriptive-key',
    name: 'GROQ_API_KEY',
    environment: ' env-key ',
    descriptive: /"gpt oss"\s*=\s*(\S+)/,
  }), 'env-key');
});

test('accepts explicit assignments and descriptive credential lines', async () => {
  const { resolveCredential } = await import('./credential-keys.mjs');
  assert.equal(resolveCredential({ raw: 'GROQ_API_KEY=file-key', name: 'GROQ_API_KEY' }), 'file-key');
  assert.equal(resolveCredential({
    raw: '"gpt oss" = descriptive-key',
    name: 'GROQ_API_KEY',
    descriptive: /"gpt oss"\s*=\s*(\S+)/,
  }), 'descriptive-key');
});
