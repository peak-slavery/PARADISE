import { afterEach, describe, expect, it } from 'vitest';

import { credentials, demoMode } from './demo';

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe('explicit demo mode', () => {
  it('does not infer fixtures from missing credentials', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEMO_MODE = undefined;
    process.env.NEXT_PUBLIC_SUPABASE_URL = undefined;
    process.env.MONGODB_URI = undefined;

    expect(demoMode()).toBe(false);
    expect(credentials().demo).toBe(false);
  });

  it('requires explicit opt-in for fixtures', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEMO_MODE = 'true';

    expect(demoMode()).toBe(true);
  });

  it('fails closed in production without an explicit false demo mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = undefined;

    expect(() => demoMode()).toThrow('DEMO_MODE must be explicitly false in production');
  });
});
