import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, invalidJsonResponse } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
  let body: { guild_id?: unknown; whitelist_type?: unknown; expires_at?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return invalidJsonResponse(); }
  if (typeof body.guild_id !== 'string' || !/^\d{17,20}$/.test(body.guild_id)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });
  if (fixedGuild(body.guild_id)) return NextResponse.json({ error: 'Configured dev/main guilds are immutable' }, { status: 409 });
  if (!['full', 'temp', 'unauthorised'].includes(String(body.whitelist_type))) return NextResponse.json({ error: 'Invalid whitelist_type' }, { status: 400 });
  const type = body.whitelist_type as 'full' | 'temp' | 'unauthorised';
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;
  if (type === 'temp' && (!expiresAt || Date.parse(expiresAt) <= Date.now())) return NextResponse.json({ error: 'Temporary whitelist must expire in the future' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { error: revokeError } = await supabase.from('guild_whitelists').update({ removed_at: new Date().toISOString(), removed_by: access.userId }).eq('guild_id', body.guild_id).is('removed_at', null);
  if (revokeError) return NextResponse.json({ error: 'Unable to replace guild whitelist' }, { status: 503 });
  const { data, error } = await supabase.from('guild_whitelists').insert({ guild_id: body.guild_id, whitelist_type: type, expires_at: type === 'temp' ? expiresAt : null, note: typeof body.note === 'string' ? body.note.slice(0, 500) : null, added_by: access.userId }).select('*').single();
  if (error || !data) return NextResponse.json({ error: 'Unable to save guild whitelist' }, { status: 503 });
  await supabase.from('servers').update({ authorized: type !== 'unauthorised' }).eq('guild_id', body.guild_id);
  return NextResponse.json({ whitelist: data }, { status: 201 });
}
