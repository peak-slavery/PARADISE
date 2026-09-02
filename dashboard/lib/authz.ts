// Server-only guild authorization.
//
// Next.js renders `layout.tsx` and `page.tsx` CONCURRENTLY, so a `notFound()`
// raised in the guild layout does not reliably stop a page from issuing its own
// data fetch. Every page and route handler that reads guild-scoped data must
// therefore authorize independently — the layout check is defence in depth,
// never the control.

import { notFound, redirect } from 'next/navigation';

import { getServer } from '@/lib/data/servers';
import { credentials } from '@/lib/demo';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';

/** Discord snowflakes are 17–20 digit numeric strings. */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

/**
 * True when the operator has supplied *any* backend credential. Used to tell a
 * deliberately demo instance (nothing set) from a broken production deploy
 * (some, but not all, values set) — the latter must fail closed.
 */
export function hasConfiguredEnvironment(): boolean {
  return [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.MONGODB_URI,
    process.env.HMAC_SECRET,
    process.env.HMAC_SECRETS_JSON,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

export type GuildAuthorization =
  | { ok: true; demo: boolean }
  | { ok: false; status: 401 | 404 | 503; error: string };

/**
 * Authorize the caller for a guild: valid snowflake, live session, and an
 * ownership row visible through Supabase RLS (`owns_guild`).
 *
 * Returns `demo: true` only when NO backend credential exists at all, so demo
 * fixtures can never be served to an internet-facing deployment that is
 * partially configured.
 */
export async function authorizeGuild(guildId: string): Promise<GuildAuthorization> {
  if (!isDiscordSnowflake(guildId)) {
    return { ok: false, status: 404, error: 'Guild not found' };
  }

  const status = credentials();
  if (!status.supabase || !status.mongo) {
    return hasConfiguredEnvironment()
      ? { ok: false, status: 503, error: 'Dashboard backend is not configured' }
      : { ok: true, demo: true };
  }

  try {
    if (!(await createSupabaseServerClient())) {
      return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
    }

    const user = await getCurrentUser();
    if (!user) return { ok: false, status: 401, error: 'Authentication required' };

    // RLS hides guilds the caller does not own; a miss is a 404 so we never
    // confirm that another tenant's guild exists.
    const server = await getServer(guildId);
    if (!server) return { ok: false, status: 404, error: 'Guild not found' };
  } catch {
    return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
  }

  return { ok: true, demo: false };
}

const MASTER_DISCORD_ID = '1479589523426902208';

export type MasterAuthorization =
  | { ok: true; userId: string; source: 'database' | 'environment' }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * Resolve master access without trusting browser input. The DB flag/Discord
 * identity is authoritative when Supabase is available; the environment
 * fallback is only a server-side emergency bootstrap for the fixed operator.
 */
export async function authorizeMaster(): Promise<MasterAuthorization> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Authentication required' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return process.env.MASTER_DISCORD_ID === MASTER_DISCORD_ID && user.user_metadata?.provider_id === MASTER_DISCORD_ID
      ? { ok: true, userId: user.id, source: 'environment' }
      : { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
  }

  const { data, error } = await supabase
    .from('users')
    .select('discord_id,is_master')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };

  if (data?.is_master === true || data?.discord_id === MASTER_DISCORD_ID) {
    return { ok: true, userId: user.id, source: 'database' };
  }

  const providerId = user.user_metadata?.provider_id ?? user.user_metadata?.sub;
  if (process.env.MASTER_DISCORD_ID === MASTER_DISCORD_ID && providerId === MASTER_DISCORD_ID) {
    return { ok: true, userId: user.id, source: 'environment' };
  }

  return { ok: false, status: 403, error: 'Master access required' };
}

export async function authorizeGuildOrMaster(guildId: string): Promise<GuildAuthorization & { master?: boolean }> {
  if (!isDiscordSnowflake(guildId)) return { ok: false, status: 404, error: 'Guild not found' };
  const master = await authorizeMaster();
  if (master.ok) return { ok: true, demo: false, master: true };
  const authorization = await authorizeGuild(guildId);
  return authorization.ok ? { ...authorization, master: false } : authorization;
}

/**
 * Page-level variant. Unauthenticated callers go to `/login`; every other
 * failure is a 404 so the response never discloses whether the guild exists.
 */
export async function requireGuildAccess(guildId: string): Promise<{ demo: boolean }> {
  const authorization = await authorizeGuild(guildId);
  if (authorization.ok) return { demo: authorization.demo };
  if (authorization.status === 401) redirect('/login');
  notFound();
}
