// ---------------------------------------------------------------------------
// Server-only Discord guild verification.
//
// This module is only ever imported from route handlers / server components. It
// never runs in the browser and never returns a provider token to a client.
// The provider token comes from the server-side Supabase session established by
// the OAuth code exchange, is used only to call Discord as the signed-in user,
// and is dropped after the call returns.
//
// Fail-closed rules:
//   - Missing token            => no relationships are trusted (empty result).
//   - Discord API failure      => no relationships are trusted.
//   - Unparseable guild data   => that guild is skipped, not trusted.
//   - Unknown/invalid snowflake => never trusted.
// Browser-supplied guild IDs or "I'm an admin" claims are never accepted.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DiscordGuildMembership {
  guildId: string;
  /** True when the user is the guild owner according to Discord. */
  isOwner: boolean;
  /** True when the user has the ADMINISTRATOR permission in the guild. */
  isAdministrator: boolean;
}

export interface DiscordVerification {
  /** True only when Discord successfully returned the complete guild list. */
  ok: boolean;
  discordUserId: string | null;
  guilds: DiscordGuildMembership[];
  reason?: 'missing_token' | 'discord_error' | 'invalid_response';
}

const DISCORD_API = 'https://discord.com/api';
const SNOWFLAKE_RE = /^\d{17,20}$/;

function safeSnowflake(value: unknown): string | null {
  return typeof value === 'string' && SNOWFLAKE_RE.test(value) ? value : null;
}

function parseGuild(raw: unknown): DiscordGuildMembership | null {
  if (!raw || typeof raw !== 'object') return null;
  const guild = raw as Record<string, unknown>;
  const guildId = safeSnowflake(guild.id);
  if (!guildId) return null;

  const owner = guild.owner === true;
  const permissions = typeof guild.permissions === 'string' ? guild.permissions : null;
  let isAdministrator = false;
  if (permissions) {
    // ADMINISTRATOR is bit 3 of the Discord permission bitfield.
    const bits = BigInt(permissions);
    isAdministrator = (bits & (1n << 3n)) !== 0n;
  }

  return { guildId, isOwner: owner, isAdministrator };
}

/**
 * Resolve the signed-in Discord user's guild memberships from Discord itself.
 * Returns an empty result on any failure — never widens access on error.
 */
export async function verifyDiscordGuilds(providerToken: string | undefined | null): Promise<DiscordVerification> {
  const token = providerToken?.trim();
  if (!token) {
    return { ok: false, discordUserId: null, guilds: [], reason: 'missing_token' };
  }

  try {
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!meRes.ok) {
      return { ok: false, discordUserId: null, guilds: [], reason: 'discord_error' };
    }
    const me = (await meRes.json()) as Record<string, unknown>;
    const discordUserId = safeSnowflake(me.id);
    if (!discordUserId) {
      return { ok: false, discordUserId: null, guilds: [], reason: 'invalid_response' };
    }

    const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!guildsRes.ok) {
      return { ok: false, discordUserId, guilds: [], reason: 'discord_error' };
    }

    const rawGuilds = (await guildsRes.json()) as unknown;
    if (!Array.isArray(rawGuilds)) {
      return { ok: false, discordUserId, guilds: [], reason: 'invalid_response' };
    }

    const guilds = rawGuilds
      .map(parseGuild)
      .filter((guild): guild is DiscordGuildMembership => guild !== null);

    return { ok: true, discordUserId, guilds };
  } catch {
    return { ok: false, discordUserId: null, guilds: [], reason: 'discord_error' };
  }
}

interface GuildAccessInput {
  guildId: string;
  discordUserId: string;
  accessSource: 'owner' | 'administrator';
  verifiedAt: string;
}

/**
 * Reconcile trusted guild relationships for the signed-in user.
 *
 * Only `owner`/`administrator` rows are written here. Inviter relationships are
 * established by the bot from Discord audit logs and must not be inferred from
 * browser claims. Existing rows for other sources are untouched.
 *
 * Writes use the admin client so RLS cannot block the service from recording a
 * verified relationship. Any database failure is swallowed into a returned
 * `ok: false` so a broken write never silently grants or denies dashboard
 * access — the caller still renders based on the current RLS view.
 */
export async function reconcileGuildAccess(
  admin: SupabaseClient,
  verification: DiscordVerification,
): Promise<{ ok: boolean }> {
  if (!verification.ok || !verification.discordUserId) {
    return { ok: false };
  }

  try {
    // Only guilds where Ei Point is currently authorized are eligible for the
    // dashboard. Discord membership alone must never create a dashboard tenant.
    const { data: serverRows, error: serverError } = await admin
      .from('servers')
      .select('guild_id')
      .eq('authorized', true);
    if (serverError || !serverRows) return { ok: false };

    const authorizedGuilds = new Set(
      serverRows
        .map((row) => row.guild_id)
        .filter((guildId): guildId is string => typeof guildId === 'string' && SNOWFLAKE_RE.test(guildId)),
    );
    const now = new Date().toISOString();
    const rows: GuildAccessInput[] = verification.guilds
      .filter((guild) => authorizedGuilds.has(guild.guildId) && (guild.isOwner || guild.isAdministrator))
      .map((guild) => ({
        guildId: guild.guildId,
        discordUserId: verification.discordUserId as string,
        accessSource: (guild.isOwner ? 'owner' : 'administrator') as 'owner' | 'administrator',
        verifiedAt: now,
      }));

    if (rows.length > 0) {
      const { error } = await admin.from('guild_access').upsert(
        rows.map((row) => ({
          guild_id: row.guildId,
          discord_user_id: row.discordUserId,
          access_source: row.accessSource,
          verified_at: row.verifiedAt,
          revoked_at: null,
        })),
        { onConflict: 'guild_id,discord_user_id,access_source' },
      );
      if (error) return { ok: false };
    }

    // A complete Discord response is authoritative for owner/admin rows. Revoke
    // only stale role relationships; inviter evidence is independent and remains
    // untouched until its own trusted revocation path exists.
    const { data: existing, error: existingError } = await admin
      .from('guild_access')
      .select('id,guild_id,access_source')
      .eq('discord_user_id', verification.discordUserId)
      .in('access_source', ['owner', 'administrator'])
      .is('revoked_at', null);
    if (existingError || !existing) return { ok: false };

    const desired = new Set(rows.map((row) => `${row.guildId}:${row.accessSource}`));
    for (const row of existing) {
      if (desired.has(`${row.guild_id}:${row.access_source}`)) continue;
      const { error } = await admin
        .from('guild_access')
        .update({ revoked_at: now, updated_at: now })
        .eq('id', row.id);
      if (error) return { ok: false };
    }

    return { ok: true };
  } catch {
    return { ok: false };
  }
}
