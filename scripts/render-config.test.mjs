import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const render = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

test('Render bot builds do not require runtime credentials', () => {
  const match = render.match(/^\s+buildCommand:\s+(.+)$/m);
  assert.ok(match, 'shared bot buildCommand is present');
  assert.equal(match[1], 'npm ci --include=dev');
  assert.doesNotMatch(match[1], /deploy:commands/);
});

test('every Render service declares the shared runtime env vars locally', () => {
  const serviceSection = render.slice(render.indexOf('\nservices:'));
  const services = serviceSection
    .split(/\n(?=  - name: )/)
    .filter((block) => /^  - name: /m.test(block))
    .map((block) => [null, block.match(/^  - name: (eiflow-[\w-]+)/m)?.[1], block]);
  assert.equal(services.length, 8, 'all bot service blocks are present');
  const required = [
    'NODE_OPTIONS', 'BOT_VERSION', 'OWNER_IDS', 'MONGODB_DB',
    'MONGODB_SECONDARY_DB', 'LOG_LEVEL', 'REDIS_DAILY_COMMAND_BUDGET',
    'DISCORD_TOKEN', 'HMAC_SECRET', 'DASHBOARD_URL', 'DEV_GUILD_ID',
    'MAIN_GUILD_ID', 'DEV_AUTH_CHANNEL_ID', 'HEALTH_TOKEN', 'SENTRY_DSN',
  ];
  for (const [, name, block] of services) {
    for (const key of required) {
      assert.match(block, new RegExp(`^\\s+- key: ${key}\\s*$`, 'm'), `${name} must declare ${key}`);
    }
  }
});

test('Render scopes provider secrets and declares safe provider defaults', () => {
  const service = (name) => {
    const start = render.indexOf(`  - name: ${name}`);
    if (start < 0) return '';
    const next = render.indexOf('\n  - name: ', start + 1);
    return render.slice(start, next < 0 ? render.length : next);
  };
  for (const name of ['eiflow-shanks', 'eiflow-zoro']) {
    assert.match(service(name), /^\s+- key: CEREBRAS_API_KEY\s*\n\s+sync: false\s*$/m);
  }
  const cyrene = service('eiflow-cyrene');
  for (const key of ['GROQ_API_KEY', 'MISTRAL_API_KEY', 'AGNES_IMAGE_API_KEY', 'OPENROUTER_API_KEY']) {
    assert.match(cyrene, new RegExp(`^\\s+- key: ${key}\\s*\\n\\s+sync: false\\s*$`, 'm'));
  }
  assert.match(cyrene, /^\s+- key: AGNES_IMAGE_MODEL\s*\n\s+value: agnes-image-2\.5-flash\s*$/m);
  assert.match(cyrene, /^\s+- key: CYRENE_TTS_MODEL\s*\n\s+value: openai\/tts-1\s*$/m);
  assert.match(cyrene, /^\s+- key: CYRENE_TTS_VOICE\s*\n\s+value: alloy\s*$/m);
  assert.doesNotMatch(render, /GROQ_AUTOMOD_API_KEY|AUTOMOD_SLM_MODEL|llama-3\.1-8b-instant|provider\.groq_automod/);
});
