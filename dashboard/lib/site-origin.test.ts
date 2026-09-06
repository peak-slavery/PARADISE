import { afterEach, describe, expect, it } from 'vitest';
import { resolveSiteOrigin } from './site-origin';

const originalNodeEnv = process.env.NODE_ENV;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe('resolveSiteOrigin', () => {
  it('uses the configured HTTPS origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://dashboard.example.test/base';

    expect(resolveSiteOrigin(new URL('https://forged.example.test/callback'))).toBe('https://dashboard.example.test');
  });

  it('rejects host-header fallback in production without a valid configured origin', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(resolveSiteOrigin(new URL('https://forged.example.test/callback'))).toBeNull();
  });

  it('allows the request origin for local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(resolveSiteOrigin(new URL('http://localhost:3000/callback'))).toBe('http://localhost:3000');
  });
});

