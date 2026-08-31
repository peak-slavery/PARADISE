import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

/**
 * Route gate.
 *
 * `/dashboard/**` requires a session; signed-in visitors are bounced off
 * `/login`. When Supabase is not configured the gate opens entirely so the
 * dashboard can be previewed against demo fixtures.
 */
export async function middleware(request: NextRequest) {
  const { response, user, configured } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!configured) {
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
  matcher: ['/dashboard/:path*', '/login', '/auth/:path*'],
};
