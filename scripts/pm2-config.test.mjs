import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../ecosystem.config.cjs';

const expected = [
  ['paradise-dashboard', 3000],
  ['paradise-shanks', 3101],
  ['paradise-sanji', 3102],
  ['paradise-zoro', 3103],
  ['paradise-boahancock', 3104],
  ['paradise-nami', 3105],
  ['paradise-luffy', 3106],
  ['paradise-niko-robin', 3107],
  ['paradise-cyrene', 3108],
];

test('PM2 local stack has the expected services and ports', () => {
  assert.deepEqual(
    config.apps.map((app) => [app.name, Number(app.env?.PORT ?? (app.name === 'paradise-dashboard' ? 3000 : NaN))]),
    expected,
  );
});

test('PM2 local stack uses a 500MB restart ceiling without credentials', () => {
  for (const app of config.apps) {
    assert.equal(app.max_memory_restart, '500M', `${app.name} memory ceiling`);
    assert.equal(app.env?.DISCORD_TOKEN, undefined, `${app.name} token not embedded`);
    assert.equal(app.env?.HMAC_SECRET, undefined, `${app.name} HMAC secret not embedded`);
  }
});
