import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSiteOrigin } from './site-origin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveSiteOrigin', () => {
  it('uses the configured HTTPS origin in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dashboard.example.test/some-path');

    expect(resolveSiteOrigin(new URL('https://attacker.example.test/logout'))).toBe(
      'https://dashboard.example.test',
    );
  });

  it('does not trust the request origin in production without configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('DEMO_MODE', '');

    expect(resolveSiteOrigin(new URL('https://attacker.example.test/logout'))).toBeNull();
  });

  it('does not let production demo mode bypass canonical-origin validation', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('DEMO_MODE', 'true');

    expect(resolveSiteOrigin(new URL('https://attacker.example.test/logout'))).toBeNull();
  });

  it('allows the request origin for local development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

    expect(resolveSiteOrigin(new URL('http://localhost:3000/logout'))).toBe(
      'http://localhost:3000',
    );
  });
});
