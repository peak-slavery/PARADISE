import test from 'node:test';
import assert from 'node:assert/strict';

import { parseKeepaliveConfig, KEEPALIVE_DEFAULT_INTERVAL_SEC } from './keepalive.js';

test('parses a peer origin into a normalized https origin', () => {
  const config = parseKeepaliveConfig({ keepalivePingUrl: 'https://eiflow-nami.onrender.com/' });
  assert.equal(config?.url, 'https://eiflow-nami.onrender.com');
  assert.equal(config?.intervalSec, KEEPALIVE_DEFAULT_INTERVAL_SEC);
});

test('honors a custom interval inside the clamped range', () => {
  const config = parseKeepaliveConfig({
    keepalivePingUrl: 'https://peer.example',
    keepalivePingIntervalSec: 120,
  });
  assert.equal(config?.intervalSec, 120);
});

test('disabled when the URL is missing or blank', () => {
  assert.equal(parseKeepaliveConfig({}), null);
  assert.equal(parseKeepaliveConfig({ keepalivePingUrl: '   ' }), null);
});

test('rejects non-https remote origins', () => {
  assert.equal(parseKeepaliveConfig({ keepalivePingUrl: 'http://eiflow-nami.onrender.com' }), null);
});

test('allows localhost over http for local development', () => {
  assert.equal(parseKeepaliveConfig({ keepalivePingUrl: 'http://localhost:3101' })?.url, 'http://localhost:3101');
});

test('rejects an unparseable URL', () => {
  assert.equal(parseKeepaliveConfig({ keepalivePingUrl: 'not a url' }), null);
});
