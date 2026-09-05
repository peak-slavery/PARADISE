import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, boundedJson } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { invalidateWhitelistCache } from '@/lib/interlink';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fixedGuild(guildId: string): boolean {
  return guildId === process.env.DEV_GUILD_ID?.trim() || guildId === process.env.MAIN_GUILD_ID?.trim();
}

export async function GET() {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.from('guild_whitelists').select('*').is('removed_at', null).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Unable to load guild whitelists' }, { status: 503 });
  return NextResponse.json({ whitelists: data ?? [] }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const parsed = await boundedJson<{ guild_id?: unknown; whitelist_type?: unknown; expires_at?: unknown; note?: unknown }>(request, 8 * 1024);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (typeof body.guild_id !== 'string' || !/^\d{17,20}$/.test(body.guild_id)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });
  if (fixedGuild(body.guild_id)) return NextResponse.json({ error: 'Configured dev/main guilds are immutable' }, { status: 409 });
  if (!['full', 'temp', 'unauthorised'].includes(String(body.whitelist_type))) return NextResponse.json({ error: 'Invalid whitelist_type' }, { status: 400 });
  const type = body.whitelist_type as 'full' | 'temp' | 'unauthorised';
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;
  if (type === 'temp' && (!expiresAt || Date.parse(expiresAt) <= Date.now())) return NextResponse.json({ error: 'Temporary whitelist must expire in the future' }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.rpc('set_guild_whitelist', {
    p_guild_id: body.guild_id,
    p_whitelist_type: type,
    p_expires_at: type === 'temp' ? expiresAt : null,
    p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    p_added_by: access.userId,
  });
  if (error || !data) return NextResponse.json({ error: 'Unable to save guild whitelist' }, { status: 503 });
  try {
    await invalidateWhitelistCache(body.guild_id);
  } catch {
    return NextResponse.json({ error: 'Unable to refresh guild authorization' }, { status: 503 });
  }
  return NextResponse.json({ whitelist: data }, { status: 201 });
}
