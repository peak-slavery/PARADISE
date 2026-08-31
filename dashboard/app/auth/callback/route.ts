import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

const STABLE_ERRORS = {
  missingCode: 'missing_code',
  notConfigured: 'not_configured',
  exchangeFailed: 'exchange_failed',
} as const;

/**
 * OAuth code exchange.
 *
 * Supabase redirects here with `?code=...` after Discord authenticates the
 * user. Exchanging the code server-side is what mints the cookie session —
 * the anon key is safe on the client, but the session itself must never be
 * created there.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const origin = resolveOrigin(requestUrl);
  if (!origin) {
    // Never reflect an untrusted Host header in production redirects.
    console.error('[auth/callback] no valid canonical site origin configured');
    return NextResponse.json({ error: 'Authentication is temporarily unavailable' }, { status: 500 });
  }

  const code = requestUrl.searchParams.get('code');
  const target = safeInternalTarget(requestUrl.searchParams.get('next'));

  if (!code) {
    return redirectToLogin(origin, STABLE_ERRORS.missingCode);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return redirectToLogin(origin, STABLE_ERRORS.notConfigured);
  }

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logExchangeFailure(error);
      return redirectToLogin(origin, STABLE_ERRORS.exchangeFailed);
    }
  } catch (error) {
    logExchangeFailure(error);
    return redirectToLogin(origin, STABLE_ERRORS.exchangeFailed);
  }

  return NextResponse.redirect(new URL(target, origin));
}

function resolveOrigin(requestUrl: URL): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      const protocolAllowed =
        parsed.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:');
      if (protocolAllowed && !parsed.username && !parsed.password) {
        return parsed.origin;
      }
    } catch {
      // Invalid deployment configuration is handled below without exposing it.
    }
  }

  const isExplicitLocalOrDemo =
    process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === 'true';
  return isExplicitLocalOrDemo ? requestUrl.origin : null;
}

function safeInternalTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }

  try {
    const parsed = new URL(value, 'https://internal.invalid');
    if (parsed.origin !== 'https://internal.invalid') return '/dashboard';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard';
  }
}

function redirectToLogin(origin: string, errorCode: string): NextResponse {
  const login = new URL('/login', origin);
  login.searchParams.set('error', errorCode);
  return NextResponse.redirect(login);
}

function logExchangeFailure(error: unknown): void {
  const details = error as { name?: unknown; status?: unknown; code?: unknown };
  console.error('[auth/callback] OAuth code exchange failed', {
    name: typeof details.name === 'string' ? details.name : 'AuthError',
    status: typeof details.status === 'number' ? details.status : undefined,
    code: typeof details.code === 'string' ? details.code : undefined,
  });
}
