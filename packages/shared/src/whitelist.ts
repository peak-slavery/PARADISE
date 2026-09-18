import type { TypedSupabase } from './db/supabase.js';
import type { Kv } from './redis.js';
import { isApprovedGuild, type GuildPolicyEnv } from './guild-policy.js';

export type GuildAuthorizationResult = 'allowed' | 'denied' | 'unavailable';

const CACHE_TTL_SECONDS = 60;
type CachedAuthorization = { allowed: false };

function validGuildId(guildId: string): boolean {
  return /^\d{17,20}$/.test(guildId);
}

export {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  isApprovedGuild,
  normalizeGuildEnvironment,
  type GuildEnvironment,
  type GuildPolicyEnv,
} from './guild-policy.js';

/**
 * Resolve authorization while preserving an unavailable source for recovery.
 * Redis is a deny-only cache: an allowed row is always revalidated against the
 * authoritative Supabase policy so revocation cannot be delayed by cache TTL.
 */
export async function resolveGuildAuthorization(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: GuildPolicyEnv,
  kv?: Kv,
): Promise<GuildAuthorizationResult> {
  if (!validGuildId(guildId) || !isApprovedGuild(guildId, env)) return 'denied';
  if (!supabase) return 'unavailable';

  const cacheKey = `wl:active:${guildId}`;
  if (kv) {
    try {
      const cached = await kv.get<CachedAuthorization>(cacheKey);
      if (cached?.allowed === false) return 'denied';
    } catch {
      // A cache outage must not widen access; continue to the authority.
    }
  }

  try {
    const { data, error } = await supabase
      .from('guild_whitelists')
      .select('whitelist_type,expires_at,removed_at')
      .eq('guild_id', guildId)
      .is('removed_at', null)
      .maybeSingle();
    if (error || !data) return error ? 'unavailable' : 'denied';
    if (data.whitelist_type === 'full') return 'allowed';
    if (data.whitelist_type === 'temp' && data.expires_at && Date.parse(data.expires_at) > Date.now()) {
      return 'allowed';
    }
  } catch {
    return 'unavailable';
  }

  if (kv) {
    await kv.set(cacheKey, { allowed: false }, CACHE_TTL_SECONDS).catch(() => undefined);
  }
  return 'denied';
}

export async function isGuildWhitelisted(
  supabase: TypedSupabase | null,
  guildId: string,
  env?: GuildPolicyEnv,
  kv?: Kv,
): Promise<boolean> {
  return (await resolveGuildAuthorization(supabase, guildId, env, kv)) === 'allowed';
}
