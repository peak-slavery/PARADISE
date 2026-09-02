import type { GuildWhitelistRow, TypedSupabase } from './db/supabase.js';
import type { Env } from './env.js';
import type { Kv } from './redis.js';

export type WhitelistType = GuildWhitelistRow['whitelist_type'];
const CACHE_TTL_SECONDS = 60;

function validGuildId(guildId: string): boolean {
  return /^\d{17,20}$/.test(guildId);
}

export function isPermanentGuild(env: Pick<Env, 'devGuildId' | 'mainGuildId'>, guildId: string): boolean {
  return Boolean(guildId && (guildId === env.devGuildId || guildId === env.mainGuildId));
}

/** Resolve the command whitelist. Missing stores and query errors fail closed. */
export async function isGuildWhitelisted(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: Pick<Env, 'devGuildId' | 'mainGuildId'>,
  kv?: Kv,
): Promise<boolean> {
  if (!validGuildId(guildId)) return false;
  if (env && isPermanentGuild(env, guildId)) return true;
  if (!supabase) return false;

  const cacheKey = `wl:active:${guildId}`;
  if (kv) {
    try {
      const cached = await kv.get<{ allowed: boolean }>(cacheKey);
      if (cached && typeof cached.allowed === 'boolean') return cached.allowed;
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
    }
  } catch {
    // The old test/deployment client has no `is` filter. A real Supabase
    // network/query error must fail closed and must not fall through to a stale
    // legacy authorization row.
    useLegacyAuthorization = true;
  }

  if (!useLegacyAuthorization) {
    if (kv) await kv.set(cacheKey, { allowed }, CACHE_TTL_SECONDS).catch(() => undefined);
    return allowed;
  }

  try {
    const { data, error } = await supabase
      .from('servers')
      .select('authorized')
      .eq('guild_id', guildId)
      .maybeSingle();
    allowed = !error && data?.authorized === true;
  } catch {
    allowed = false;
  }
  if (kv) await kv.set(cacheKey, { allowed }, CACHE_TTL_SECONDS).catch(() => undefined);
  return allowed;
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

  const { error: revokeError } = await supabase
    .from('guild_whitelists')
    .update({ removed_at: new Date().toISOString(), removed_by: input.addedBy ?? null })
    .eq('guild_id', input.guildId)
    .is('removed_at', null);
  if (revokeError) throw revokeError;

  const { data, error } = await supabase
    .from('guild_whitelists')
    .insert({
      guild_id: input.guildId,
      whitelist_type: input.type,
      expires_at: input.type === 'temp' ? input.expiresAt ?? null : null,
      note: input.note ?? null,
      added_by: input.addedBy ?? null,
      removed_at: null,
      removed_by: null,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Whitelist write returned no row');
  return data as GuildWhitelistRow;
}

export async function removeGuildWhitelist(
  supabase: TypedSupabase,
  guildId: string,
  removedBy?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('guild_whitelists')
    .update({ removed_at: new Date().toISOString(), removed_by: removedBy ?? null })
    .eq('guild_id', guildId)
    .is('removed_at', null);
  if (error) throw error;
}
