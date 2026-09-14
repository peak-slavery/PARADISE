import { describe, expect, it } from 'vitest';

import { parseKeepaliveConfig, KEEPALIVE_DEFAULT_INTERVAL_SEC } from './keepalive.js';

describe('keepalive config', () => {
  it('parses a peer origin into a normalized https origin', () => {
    const config = parseKeepaliveConfig({ keepalivePingUrl: 'https://eiflow-nami.onrender.com/' });
    expect(config?.url).toBe('https://eiflow-nami.onrender.com');
    expect(config?.intervalSec).toBe(KEEPALIVE_DEFAULT_INTERVAL_SEC);
  });

  it('honors a custom interval inside the clamped range', () => {
    const config = parseKeepaliveConfig({
      keepalivePingUrl: 'https://peer.example',
      keepalivePingIntervalSec: 120,
    });
    expect(config?.intervalSec).toBe(120);
  });

  it('is disabled when the URL is missing or blank', () => {
    expect(parseKeepaliveConfig({})).toBeNull();
    expect(parseKeepaliveConfig({ keepalivePingUrl: '   ' })).toBeNull();
  });

  it('rejects non-https remote origins', () => {
    expect(parseKeepaliveConfig({ keepalivePingUrl: 'http://eiflow-nami.onrender.com' })).toBeNull();
  });

  it('allows localhost over http for local development', () => {
    expect(parseKeepaliveConfig({ keepalivePingUrl: 'http://localhost:3101' })?.url).toBe('http://localhost:3101');
  });

  it('rejects an unparseable URL', () => {
    expect(parseKeepaliveConfig({ keepalivePingUrl: 'not a url' })).toBeNull();
  });
});
