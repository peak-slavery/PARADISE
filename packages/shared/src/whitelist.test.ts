import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  isGuildWhitelisted,
  resolveGuildAuthorization,
} from './whitelist.js';

const schema = readFileSync(new URL('../../../infra/supabase/schema.sql', import.meta.url), 'utf8');

function activeGuildRow(type = 'full', expiresAt: string | null = null) {
  return { whitelist_type: type, expires_at: expiresAt, removed_at: null };
}

function supabaseWithRow(row: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ maybeSingle: async () => ({ data: row, error }) }),
        }),
      }),
    }),
  } as never;
}

describe('canonical guild authorization', () => {
  it('requires an active authority row for the matching canonical guild', async () => {
    const supabase = supabaseWithRow(activeGuildRow());

    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
    )).resolves.toBe('allowed');
    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'development' },
    )).resolves.toBe('denied');
    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_DEVELOPMENT_GUILD_ID,
      { runtimeEnvironment: 'development' },
    )).resolves.toBe('allowed');
  });

  it('allows a temporary canonical grant only while it is active', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const supabase = supabaseWithRow(activeGuildRow('temp', expiresAt));

    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_DEVELOPMENT_GUILD_ID,
      { runtimeEnvironment: 'development' },
    )).resolves.toBe('allowed');
  });

  it('rejects an expired temporary canonical grant', async () => {
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const supabase = supabaseWithRow(activeGuildRow('temp', expiresAt));

    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_DEVELOPMENT_GUILD_ID,
      { runtimeEnvironment: 'development' },
    )).resolves.toBe('denied');
  });

  it('rejects random guilds before querying storage or writing a cache entry', async () => {
    const randomGuildId = '849213847293847021';
    const queries: unknown[] = [];
    const writes: unknown[] = [];
    const supabase = {
      from: () => {
        queries.push('queried');
        return supabaseWithRow(activeGuildRow());
      },
    } as never;
    const kv = {
      get: async () => null,
      set: async (...args: unknown[]) => writes.push(args),
    } as never;

    await expect(resolveGuildAuthorization(
      supabase,
      randomGuildId,
      { runtimeEnvironment: 'production' },
      kv,
    )).resolves.toBe('denied');
    expect(queries).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('treats an authority outage as unavailable only for a canonical guild', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: { code: 'PGRST205' } }),
            }),
          }),
        }),
      }),
    } as never;

    await expect(resolveGuildAuthorization(
      supabase,
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
    )).resolves.toBe('unavailable');
    await expect(resolveGuildAuthorization(
      supabase,
      '849213847293847021',
      { runtimeEnvironment: 'production' },
    )).resolves.toBe('denied');
  });

  it('uses Redis only to narrow canonical authorization', async () => {
    const kv = {
      get: async () => ({ allowed: false }),
      set: async () => undefined,
    } as never;

    await expect(resolveGuildAuthorization(
      supabaseWithRow(activeGuildRow()),
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
      kv,
    )).resolves.toBe('denied');
    await expect(isGuildWhitelisted(
      supabaseWithRow(activeGuildRow()),
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
      kv,
    )).resolves.toBe(false);
  });

  it('continues to the authority when the deny cache is unavailable', async () => {
    const kv = {
      get: async () => { throw new Error('cache unavailable'); },
      set: async () => undefined,
    } as never;

    await expect(resolveGuildAuthorization(
      supabaseWithRow(activeGuildRow()),
      APPROVED_PRODUCTION_GUILD_ID,
      { runtimeEnvironment: 'production' },
      kv,
    )).resolves.toBe('allowed');
  });
});

describe('config authorization migration', () => {
  it('requires an active whitelist for every bot config write', () => {
    expect(schema).not.toContain('p_allow_legacy');
    expect(schema).toContain("whitelist_type = 'full'");
    expect(schema).toContain("whitelist_type = 'temp' and expires_at > now()");
  });
});
