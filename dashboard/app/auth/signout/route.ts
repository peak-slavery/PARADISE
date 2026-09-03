import { NextResponse, type NextRequest } from 'next/server';

import { resolveSiteOrigin } from '@/lib/site-origin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Clears the session cookie and returns to the marketing site. */
export async function POST(request: NextRequest) {
  const origin = resolveSiteOrigin(new URL(request.url));
  if (!origin) {
    return NextResponse.json(
      { error: 'Authentication is temporarily unavailable' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
