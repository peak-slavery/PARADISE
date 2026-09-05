import { NextResponse } from 'next/server';

import { authorizationResponse } from '@/lib/api-response';
import { authorizeMaster, isDiscordSnowflake } from '@/lib/authz';
import { invalidateWhitelistCache } from '@/lib/interlink';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

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
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { error } = await supabase.rpc('revoke_guild_whitelist', {
    p_guild_id: guildId,
    p_removed_by: access.userId,
  });
  if (error) return NextResponse.json({ error: 'Unable to revoke guild whitelist' }, { status: 503 });
  try {
    await invalidateWhitelistCache(guildId);
  } catch {
    return NextResponse.json({ error: 'Unable to refresh guild authorization' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
