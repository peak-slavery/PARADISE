// Server-only module: imports `next/headers` and the Supabase cookie client.
// Never import it from a `'use client'` file.

import { DEMO_USER, demoServer, demoServers } from '../demo';
import { createSupabaseServerClient } from '../supabase/server';
import { demoMode } from '../demo';
import { fetchUnavailable } from './unavailable';
import type { ServerRow, UserRow } from '../types';

export interface ServersResult {
  servers: ServerRow[];
  demo: boolean;
}

/**
 * The caller's guilds.
 *
 * RLS (`servers_owner_select` -> `public.owns_guild`) already scopes this to
 * servers the signed-in Discord identity owns, so no extra `where` clause is
 * needed — and none should be added, or a bug here could leak another guild.
 */
export async function getServers(): Promise<ServersResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    if (!demoMode()) throw fetchUnavailable();
    return { servers: demoServers(), demo: true };
  }

  const { data, error } = await supabase
    .from('servers')
    .select('*')
    .order('name', { ascending: true });

  if (error || !data) {
    // RLS already scopes the result to guilds the caller can access via the
    // trusted relationship table (owner/administrator/inviter) or master status.
    return { servers: [], demo: false };
  }

  // Keep the navigation and overview aligned with the same server-authorized
  // contract enforced by guild routes. RLS scopes the caller; this flag scopes
  // the bot's own registration state.
  const servers = (data as ServerRow[]).filter((server) => server.authorized);
  return { servers, demo: false };
}

/**
 * Master status comes from the database-backed `is_master_user()` predicate,
 * never from client-supplied profile metadata. Returns false when unconfigured
 * or on any error so the master panel is hidden rather than leaked.
 */
export async function getMasterStatus(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('is_master_user');
    if (error || typeof data !== 'boolean') return false;
    return data;
  } catch {
    return false;
  }
}

/** Single guild, or `null` when RLS hides it (or it doesn't exist). */
export async function getServer(guildId: string): Promise<ServerRow | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    if (!demoMode()) return null;
    return demoServer(guildId);
  }

  const { data, error } = await supabase
    .from('servers')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ServerRow;
}

/** The dashboard identity shown in the header. */
export async function getProfile(): Promise<{ user: UserRow; demo: boolean } | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    if (!demoMode()) return null;
    return { user: DEMO_USER, demo: true };
  }

  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user;
  if (!authUser) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error || !data) {
    // Authenticated but the profile row hasn't been written yet (the Discord
    // OAuth trigger may not have run). Fall back to the identity metadata.
    const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const fallback: UserRow = {
      id: authUser.id,
      discord_id: typeof meta.provider_id === 'string' ? meta.provider_id : '',
      username:
        (typeof meta.full_name === 'string' && meta.full_name) ||
        (typeof meta.preferred_username === 'string' && meta.preferred_username) ||
        authUser.email ||
        null,
      avatar_url: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
      is_owner: false,
      is_master: false,
      created_at: authUser.created_at ?? new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    return { user: fallback, demo: false };
  }

  return { user: data as UserRow, demo: false };
}
