import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';
import { assertDashboardAuthEnvironment } from '@/lib/demo';

/**
 * Route gate (Next.js 16 `proxy` convention).
 *
 * `/dashboard/**` requires a session; signed-in visitors are bounced off
 * `/login`. When Supabase is not configured the gate opens entirely so the
 * dashboard can be previewed against demo fixtures.
 *
 * Next.js 16 renamed the `middleware` file/function to `proxy`; the config
 * matcher syntax is unchanged. Bot traffic on `/api/internal/*` (HMAC signed,
 * cookie-less) is unaffected because the CSRF check keys off the Supabase
 * session cookie, and `/api/internal/*` is exempt from the configured-gate
 * 503.
 */
/** Methods that change state and therefore need CSRF protection. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Per-IP sliding-window rate limiter (in-memory, per serverless instance).
 *
 * Defense in depth on top of platform edge protections: it slows credential
 * stuffing and brute-force attempts against the sign-in and callback endpoints
 * even if an edge rule is ever misconfigured. Limits are approximate across
 * instances — acceptable for a guardrail that must work without Redis.
 */
const RATE_LIMITS: Array<{ matches: (pathname: string) => boolean; limit: number; windowMs: number }> = [
  // The OAuth kickoff + callback round-trip: tightest bucket.
  { matches: (p) => p === '/auth/callback' || p === '/login', limit: 10, windowMs: 60_000 },
  // HMAC-signed bot traffic is low-volume (cache refreshes); still capped.
  { matches: (p) => p.startsWith('/api/internal/'), limit: 60, windowMs: 60_000 },
  { matches: (p) => p.startsWith('/dashboard'), limit: 120, windowMs: 60_000 },
];

const rateBuckets = new Map<string, number[]>();
const RATE_BUCKET_MAX = 5_000;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function rateLimited(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  const rule = RATE_LIMITS.find((candidate) => candidate.matches(pathname));
  if (!rule) return false;

  const now = Date.now();
  const key = `${clientIp(request)}:${rule.limit}:${rule.windowMs}`;
  const hits = (rateBuckets.get(key) ?? []).filter((time) => now - time < rule.windowMs);
  hits.push(now);
  rateBuckets.set(key, hits);
  if (hits.length > rule.limit) return true;

  // Bound the map so abusive IPs cannot grow it without limit.
  if (rateBuckets.size > RATE_BUCKET_MAX) {
    for (const [bucketKey, times] of rateBuckets) {
      if (times.every((time) => now - time >= rule.windowMs)) rateBuckets.delete(bucketKey);
      if (rateBuckets.size <= RATE_BUCKET_MAX) break;
    }
  }
  return false;
}

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
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

/** Preserve any refreshed Supabase cookies when returning an alternate response. */
function withRefreshedCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

export async function proxy(request: NextRequest) {
  assertDashboardAuthEnvironment();
  const { response, user, configured } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (rateLimited(request)) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Too many requests. Slow down and try again shortly.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
      ),
      response,
    );
  }

  if (
    UNSAFE_METHODS.has(request.method) &&
    hasSessionCookie(request) &&
    !isSameOrigin(request)
  ) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Cross-origin request rejected' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
      response,
    );
  }

  // Bot -> dashboard traffic is authenticated by HMAC and per-bot secrets, not
  // by a browser session, so it must stay reachable even when the dashboard's
  // own OAuth config is absent. It performs its own authorization.
  const isInternalEndpoint = pathname.startsWith('/api/internal/');

  if (!configured && !isInternalEndpoint) {
    if (process.env.DEMO_MODE !== 'true') {
      return withRefreshedCookies(
        NextResponse.json(
          { error: 'Dashboard authentication is not configured' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        ),
        response,
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
