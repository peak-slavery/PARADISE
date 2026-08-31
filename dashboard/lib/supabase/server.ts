import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { credentials } from '../demo';

function publicUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
}

/**
 * Cookie-backed Supabase client for server components and route handlers.
 *
 * The session travels in cookies, so Postgres RLS applies with
 * `auth.uid()` set to the signed-in Discord identity — a caller can only ever
 * read rows for guilds they own. Returns `null` when Supabase is not
 * configured; callers must then fall back to fixtures.
 */
export function createSupabaseServerClient(): SupabaseClient | null {
  if (!credentials().supabase) return null;

  const store = cookies();

  return createServerClient(publicUrl(), anonKey(), {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a server component, where cookies are read-only.
          // Session refresh is handled by `middleware.ts`, so this is safe to
          // swallow — the next request will carry the refreshed cookies.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for trusted, non-user-facing work — currently the HMAC-protected
 * internal route that lets a bot push config/activity without a dashboard
 * session. Never expose this client to a request handler that a browser can
 * reach without signature verification.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = publicUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolves the signed-in user, or `null` when absent / unconfigured. */
export async function getCurrentUser() {
  const supabase = createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
