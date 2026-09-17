import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botIds, botServices, botServicesWithUrls, localBots, localBotTuples, BOT_META,
} from './fleet.mjs';

test('fleet manifest derives the canonical eight bots', () => {
  assert.deepEqual(botIds(), [
    'shanks', 'sanji', 'zoro', 'boahancock',
    'nami', 'luffy', 'niko-robin', 'cyrene',
  ]);
});

test('every bot has complete service, url, header, and port metadata', () => {
  for (const id of botIds()) {
    const meta = BOT_META[id];
    assert.ok(meta, `${id} has no manifest metadata`);
    assert.match(meta.service, /^eiflow-[\w-]+$/, `${id} service name malformed`);
    assert.match(meta.url, /^https:\/\/[\w.-]+\.onrender\.com$/, `${id} url malformed`);
    assert.ok(meta.header.length > 0, `${id} header missing`);
    assert.ok(Number.isInteger(meta.port) && meta.port > 0, `${id} port missing`);
  }
});

test('service, url, and local views stay in fleet order with no duplicates', () => {
  const ids = botIds();
  assert.deepEqual(botServices(), ids.map((id) => BOT_META[id].service));
  assert.deepEqual(
    botServicesWithUrls(),
    ids.map((id) => ({ id, url: BOT_META[id].url, header: BOT_META[id].header })),
  );
  assert.deepEqual(
    localBots(),
    ids.map((id) => ({ id, header: BOT_META[id].header, port: BOT_META[id].port })),
  );
  assert.deepEqual(
    localBotTuples(),
    ids.map((id) => [id, BOT_META[id].header, BOT_META[id].port]),
  );
  assert.equal(new Set(ids).size, ids.length, 'duplicate bot ids');
  assert.equal(new Set(botServices()).size, botServices().length, 'duplicate service names');
  assert.equal(new Set(botServicesWithUrls().map((s) => s.url)).size, botServicesWithUrls().length, 'duplicate bot urls');
});

test('local ports are unique and cover the documented PM2 range', () => {
  const ports = localBots().map((bot) => bot.port);
  assert.equal(new Set(ports).size, ports.length, 'two bots share a local port');
  assert.deepEqual(ports.slice().sort((a, b) => a - b), [3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108]);
});
