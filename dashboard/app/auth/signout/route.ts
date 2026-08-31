import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Clears the session cookie and returns to the marketing site. */
export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const supabase = createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
