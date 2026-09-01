import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

/**
 * Route gate.
 *
 * `/dashboard/**` requires a session; signed-in visitors are bounced off
 * `/login`. When Supabase is not configured the gate opens entirely so the
 * dashboard can be previewed against demo fixtures.
 */
/** Methods that change state and therefore need CSRF protection. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when the request carries a Supabase session cookie.
 *
 * Using the cookie — rather than the path — as the trigger means bot traffic
 * on `/api/internal/*` (HMAC signed, cookie-less) is unaffected, while every
 * browser-driven state change is covered.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

/**
 * Rejects cross-site state changes.
 *
 * `SameSite=Lax` already blocks the classic form-post CSRF, but that is a
 * browser default we do not control and it disappears entirely if the cookie
 * policy is ever relaxed. Requiring an `Origin` that matches this deployment
 * keeps the guarantee in our own code. Requests with no `Origin` are rejected
 * too — a browser always sends one on a cross-site request.
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { response, user, configured } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (
    UNSAFE_METHODS.has(request.method) &&
    hasSessionCookie(request) &&
    !isSameOrigin(request)
  ) {
    return NextResponse.json(
      { error: 'Cross-origin request rejected' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Bot -> dashboard traffic is authenticated by HMAC and per-bot secrets, not
  // by a browser session, so it must stay reachable even when the dashboard's
  // own OAuth config is absent. It performs its own authorization.
  const isInternalEndpoint = pathname.startsWith('/api/internal/');

  if (!configured && !isInternalEndpoint) {
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      return NextResponse.json(
        { error: 'Dashboard authentication is not configured' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return response;
  }

  if (pathname.startsWith('/dashboard') && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    redirectUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (pathname === '/login' && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // `/api` is included so the CSRF check and session refresh cover the JSON
  // endpoints. Route handlers still perform their own authorization — this
  // matcher is defence in depth, never the control.
  matcher: ['/dashboard/:path*', '/login', '/auth/:path*', '/api/:path*'],
};
