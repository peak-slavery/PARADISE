import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotChildEnv } from './bot-env.mjs';

test('filters unrelated provider credentials from bot child environments', () => {
  const child = createBotChildEnv(
    {
      PATH: 'parent-path',
      LOCAL_ONLY: 'true',
      GROQ_API_KEY: 'cyrene-only',
      SUPABASE_SERVICE_ROLE_KEY: 'parent-admin',
      NODE_ENV: 'production',
    },
    { BOT_ID: 'sanji', DISCORD_TOKEN: 'bootstrap-token' },
  );

  assert.equal(child.PATH, 'parent-path');
  assert.equal(child.LOCAL_ONLY, 'true');
  assert.equal(child.BOT_ID, 'sanji');
  assert.equal(child.DISCORD_TOKEN, 'bootstrap-token');
  assert.equal(child.GROQ_API_KEY, undefined);
  assert.equal(child.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(child.NODE_ENV, undefined);
});

test('own bot values override inherited runtime values', () => {
  const child = createBotChildEnv(
    { PATH: 'parent-path', PORT: 'parent-port' },
    { PORT: '3102' },
  );

  assert.equal(child.PATH, 'parent-path');
  assert.equal(child.PORT, '3102');
});
