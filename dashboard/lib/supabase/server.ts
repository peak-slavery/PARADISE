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
 * Session cookies carry the Supabase access/refresh JWTs, so they must never be
 * reachable from JavaScript — otherwise a single XSS anywhere in the app is
 * enough to steal a dashboard session outright.
 *
 * `@supabase/ssr` defaults to `httpOnly: false`, so these attributes are set
 * explicitly rather than inherited from library defaults that can change
 * between releases.
 */
const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  // Lax still lets the cookie ride along on the top-level OAuth redirect back
  // from Discord, while blocking cross-site subrequests (the CSRF case that
  // actually matters here).
  sameSite: 'lax',
  // `Secure` would break plain-http local development, so it tracks NODE_ENV.
  secure: process.env.NODE_ENV === 'production',
} satisfies CookieOptions;

/**
 * Cookie-backed Supabase client for server components and route handlers.
 *
 * The session travels in cookies, so Postgres RLS applies with
 * `auth.uid()` set to the signed-in Discord identity — a caller can only ever
 * read rows for guilds they own. Returns `null` when Supabase is not
 * configured; callers must then fall back to fixtures.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!credentials().supabase) return null;

  const store = await cookies();

  return createServerClient(publicUrl(), anonKey(), {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            // Hardened attributes are spread LAST so they always win: the
            // library's `maxAge`/`expires` survive, but `httpOnly`, `secure`,
            // `sameSite` and `path` can never be weakened back to defaults.
            store.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
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
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
