import { describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: vi.fn() }));

function request(authorized: boolean): never {
  return {
    headers: { get: () => (authorized ? 'Bearer health-token' : null) },
  } as never;
}

describe('dashboard health', () => {
  it('does not leak readiness details to public callers', async () => {
    process.env.DASHBOARD_HEALTH_TOKEN = 'health-token';
    vi.stubGlobal('fetch', vi.fn());

    const response = await GET(request(false));
    await expect(response.json()).resolves.toEqual({ status: 'starting' });
    expect(response.status).toBe(200);
  });

  it('fails closed when the trusted token is absent', async () => {
    delete process.env.DASHBOARD_HEALTH_TOKEN;

    const response = await GET(request(false));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'starting' });
  });
});
