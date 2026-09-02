import { NextResponse } from 'next/server';

import { authorizationResponse } from '@/lib/api-response';
import { authorizeMaster, isDiscordSnowflake } from '@/lib/authz';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const { guildId } = await params;
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guild id' }, { status: 400 });
  if (guildId === process.env.DEV_GUILD_ID?.trim() || guildId === process.env.MAIN_GUILD_ID?.trim()) {
    return NextResponse.json({ error: 'Configured dev/main guilds are immutable' }, { status: 409 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { error } = await supabase.from('guild_whitelists').update({ removed_at: new Date().toISOString(), removed_by: access.userId }).eq('guild_id', guildId).is('removed_at', null);
  if (error) return NextResponse.json({ error: 'Unable to revoke guild whitelist' }, { status: 503 });
  await supabase.from('servers').update({ authorized: false }).eq('guild_id', guildId);
  return NextResponse.json({ ok: true });
}
