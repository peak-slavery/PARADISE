import { afterEach, describe, expect, it } from 'vitest';

import { startHealthServer, type HealthServer } from './health.js';

const servers: HealthServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('health server bootstrap', () => {
  it('binds to an explicit loopback host for local-only tests', async () => {
    const server = await startHealthServer({
      port: 0,
      host: '127.0.0.1',
      botId: 'cyrene',
      version: '1.0.0',
      startedAt: Date.now(),
      log: { info: () => undefined, error: () => undefined } as never,
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('health server did not expose an address');
    expect(address.address).toBe('127.0.0.1');
  });

  it('answers liveness before runtime dependencies are attached', async () => {
    const server = await startHealthServer({
      port: 0,
      botId: 'cyrene',
      version: '1.0.0',
      startedAt: Date.now(),
      log: { info: () => undefined, error: () => undefined } as never,
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('health server did not expose an address');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'starting',
    });
  });
});
