import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

export interface SessionRefresh {
  response: NextResponse;
  user: User | null;
  /** False when Supabase env vars are absent — middleware must not gate then. */
  configured: boolean;
}

/**
 * Refreshes the Supabase session cookie inside middleware.
 *
 * Middleware is the only place in the request lifecycle that can both read the
 * incoming cookies and write refreshed ones back onto the response, which is
 * why the session is touched here rather than in a layout.
 *
 * When Supabase is unconfigured this short-circuits and reports
 * `configured: false`, so the app degrades to demo mode instead of bouncing
 * every request to `/login`.
 */
export async function updateSession(request: NextRequest): Promise<SessionRefresh> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { response: NextResponse.next({ request }), user: null, configured: false };
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching the user is what actually triggers a token refresh when the
  // access token has expired. `getUser()` revalidates with the Auth server;
  // `getSession()` alone would happily return a stale session.
  //
  // If the Auth server is unreachable it throws. Treat that as "no session"
  // rather than letting the exception escape: middleware must fail CLOSED, so
  // the gate sends the caller to /login instead of returning a 500 that could
  // bypass route protection.
  try {
    const { data } = await supabase.auth.getUser();
    return { response: supabaseResponse, user: data?.user ?? null, configured: true };
  } catch {
    return { response: supabaseResponse, user: null, configured: true };
  }
}
