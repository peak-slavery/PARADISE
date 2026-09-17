import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileGuildAccess, verifyDiscordGuilds } from './discord-verify';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('verifyDiscordGuilds', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns no trust when no provider token is present', async () => {
    const result = await verifyDiscordGuilds(undefined);
    expect(result).toEqual({ ok: false, discordUserId: null, guilds: [], reason: 'missing_token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no trust when the /me call fails (fail closed)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401));
    const result = await verifyDiscordGuilds('token');
    expect(result).toEqual({ ok: false, discordUserId: null, guilds: [], reason: 'discord_error' });
  });

  it('parses owner and administrator guilds and ignores malformed entries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: '123456789012345678', username: 'owner' }))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: '111111111111111111', owner: true, permissions: '0' },
          { id: '222222222222222222', owner: false, permissions: '8' }, // ADMINISTRATOR bit
          { id: '333333333333333333', owner: false, permissions: '0' }, // member, no admin
          { id: 'not-a-snowflake', owner: true, permissions: '0' }, // invalid id
          'garbage',
        ]),
      );

    const result = await verifyDiscordGuilds('token');
    expect(result.discordUserId).toBe('123456789012345678');
    expect(result.guilds).toEqual([
      { guildId: '111111111111111111', isOwner: true, isAdministrator: false },
      { guildId: '222222222222222222', isOwner: false, isAdministrator: true },
      { guildId: '333333333333333333', isOwner: false, isAdministrator: false },
    ]);
  });

  it('still returns the user id when the guilds call fails (no widening)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: '123456789012345678' }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const result = await verifyDiscordGuilds('token');
    expect(result.discordUserId).toBe('123456789012345678');
    expect(result.guilds).toEqual([]);
  });

  it('returns no trust on a network error (fail closed)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await verifyDiscordGuilds('token');
    expect(result).toEqual({ ok: false, discordUserId: null, guilds: [], reason: 'discord_error' });
  });

  it('does not trust a user whose /me id is not a snowflake', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'not-numeric', username: 'x' }));
    const result = await verifyDiscordGuilds('token');
    expect(result.discordUserId).toBeNull();
  });
});

describe('reconcileGuildAccess', () => {
  it('returns ok when there is nothing to reconcile', async () => {
    const admin = { from: vi.fn() } as never;
    expect(await reconcileGuildAccess(admin, { ok: false, discordUserId: null, guilds: [], reason: 'missing_token' })).toEqual({ ok: false });
    expect(await reconcileGuildAccess(admin, {
      ok: true,
      discordUserId: '123456789012345678',
      guilds: [],
    })).toEqual({ ok: false });
  });

  it('upserts only owner/administrator relationships, never inviter', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const authorizedServers = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: [
          { guild_id: '111111111111111111' },
          { guild_id: '222222222222222222' },
        ],
        error: null,
      }),
    });
    const existing = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    const admin = {
      from: vi.fn((table: string) => table === 'servers'
        ? { select: authorizedServers }
        : { upsert, select: existing, update }),
    } as never;
    const verification = {
      ok: true,
      discordUserId: '123456789012345678',
      guilds: [
        { guildId: '111111111111111111', isOwner: true, isAdministrator: false },
        { guildId: '222222222222222222', isOwner: false, isAdministrator: true },
        { guildId: '333333333333333333', isOwner: false, isAdministrator: false },
      ],
    };
    const result = await reconcileGuildAccess(admin as never, verification as never);
    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    const rows = upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.guild_id).sort()).toEqual(['111111111111111111', '222222222222222222']);
    expect(rows.every((r) => r.access_source === 'owner' || r.access_source === 'administrator')).toBe(true);
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
  });

  it('fails closed (ok:false) on a database write error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const admin = { from: vi.fn().mockReturnValue({ upsert }) } as never;
    const result = await reconcileGuildAccess(admin as never, {
      discordUserId: '123456789012345678',
      guilds: [{ guildId: '111111111111111111', isOwner: true, isAdministrator: false }],
    } as never);
    expect(result).toEqual({ ok: false });
  });
});
