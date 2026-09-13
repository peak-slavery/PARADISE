import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeMaster } from './authz';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';

vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/data/servers', () => ({ getServer: vi.fn() }));
vi.mock('@/lib/demo', () => ({ credentials: vi.fn(), demoMode: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

describe('authorizeMaster', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'master-user-id' } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn(),
    } as never);
  });

  it('authorizes only a database-confirmed master user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as never);

    await expect(authorizeMaster()).resolves.toEqual({
      ok: true,
      userId: 'master-user-id',
      source: 'database',
    });
  });

  it('rejects a user who is not a master user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as never);

    await expect(authorizeMaster()).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Master access required',
    });
  });

  it('fails closed when the master RPC is unavailable', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      }),
    } as never);

    await expect(authorizeMaster()).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'Dashboard backend is unavailable',
    });
  });
});
