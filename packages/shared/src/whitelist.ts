import type { GuildWhitelistRow, TypedSupabase } from './db/supabase.js';
import type { Env } from './env.js';
import type { Kv } from './redis.js';

export type WhitelistType = GuildWhitelistRow['whitelist_type'];
export type GuildAuthorizationResult = 'allowed' | 'denied' | 'unavailable';
const CACHE_TTL_SECONDS = 60;

function validGuildId(guildId: string): boolean {
  return /^\d{17,20}$/.test(guildId);
}

export function isPermanentGuild(env: Pick<Env, 'devGuildId' | 'mainGuildId'>, guildId: string): boolean {
  return Boolean(guildId && (guildId === env.devGuildId || guildId === env.mainGuildId));
}

/** Resolve the command whitelist with outage state preserved for reconciliation. */
export async function resolveGuildAuthorization(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: Pick<Env, 'devGuildId' | 'mainGuildId'>,
  kv?: Kv,
): Promise<GuildAuthorizationResult> {
  if (!validGuildId(guildId)) return 'denied';
  if (env && isPermanentGuild(env, guildId)) return 'allowed';
  if (!supabase) return 'unavailable';

  const cacheKey = `wl:active:${guildId}`;
  if (kv) {
    try {
      const cached = await kv.get<{ allowed: boolean }>(cacheKey);
      if (cached && typeof cached.allowed === 'boolean') return cached.allowed ? 'allowed' : 'denied';
    } catch {
      // Cache failures must never widen access. Resolve from Supabase below.
    }
  }

  let allowed = false;
  let useLegacyAuthorization = false;
  try {
    const { data, error } = await supabase
      .from('guild_whitelists')
      .select('whitelist_type,expires_at,removed_at')
      .eq('guild_id', guildId)
      .is('removed_at', null)
      .maybeSingle();
    if (!error && data) {
      if (data.whitelist_type === 'full') allowed = true;
      else if (data.whitelist_type === 'temp' && data.expires_at) allowed = Date.parse(data.expires_at) > Date.now();
      else allowed = false;
    } else {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      useLegacyAuthorization = code === '42P01' || code === 'PGRST205';
      if (error && !useLegacyAuthorization) return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }

  if (!useLegacyAuthorization) {
    if (kv) await kv.set(cacheKey, { allowed }, CACHE_TTL_SECONDS).catch(() => undefined);
    return allowed ? 'allowed' : 'denied';
  }

  try {
    const { data, error } = await supabase
      .from('servers')
      .select('authorized')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) return 'unavailable';
    allowed = data?.authorized === true;
  } catch {
    return 'unavailable';
  }
  if (kv) await kv.set(cacheKey, { allowed }, CACHE_TTL_SECONDS).catch(() => undefined);
  return allowed ? 'allowed' : 'denied';
}

export async function isGuildWhitelisted(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: Pick<Env, 'devGuildId' | 'mainGuildId'>,
  kv?: Kv,
): Promise<boolean> {
  return (await resolveGuildAuthorization(supabase, guildId, env, kv)) === 'allowed';
}

export async function invalidateGuildWhitelistCache(kv: Kv | null | undefined, guildId: string): Promise<void> {
  if (!kv || !validGuildId(guildId)) return;
  await kv.del(`wl:active:${guildId}`).catch(() => undefined);
}

export async function writeGuildWhitelist(
  supabase: TypedSupabase,
  input: {
    guildId: string;
    type: WhitelistType;
    expiresAt?: string | null;
    note?: string | null;
    addedBy?: string | null;
  },
): Promise<GuildWhitelistRow> {
  if (!validGuildId(input.guildId)) throw new Error('Invalid guild id');
  if (input.type === 'temp' && (!input.expiresAt || Date.parse(input.expiresAt) <= Date.now())) {
    throw new Error('Temporary whitelist must expire in the future');
  }

  const { data, error } = await supabase.rpc('set_guild_whitelist', {
    p_guild_id: input.guildId,
    p_whitelist_type: input.type,
    p_expires_at: input.type === 'temp' ? input.expiresAt ?? null : null,
    p_note: input.note ?? null,
    p_added_by: input.addedBy ?? null,
  });
  if (error || !data) throw error ?? new Error('Whitelist write returned no row');
  return data as GuildWhitelistRow;
}

export async function removeGuildWhitelist(
  supabase: TypedSupabase,
  guildId: string,
  removedBy?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('revoke_guild_whitelist', {
    p_guild_id: guildId,
    p_removed_by: removedBy ?? null,
  });
  if (error) throw error;
}
