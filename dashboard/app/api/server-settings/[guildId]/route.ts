import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, invalidJsonResponse } from '@/lib/api-response';
import { authorizeGuildOrMaster, isDiscordSnowflake } from '@/lib/authz';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';

const themes = new Set(['light', 'dark', 'system']);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const access = await authorizeGuildOrMaster(guildId);
  if (!access.ok) return authorizationResponse(access);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.from('server_settings').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Unable to load server settings' }, { status: 503 });
  return NextResponse.json({ settings: data ?? { guild_id: guildId, theme: 'system', notifications_enabled: true, server_paused: false, notification_preferences: {} } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guild id' }, { status: 400 });
  const access = await authorizeGuildOrMaster(guildId);
  if (!access.ok) return authorizationResponse(access);
  let body: { theme?: unknown; notifications_enabled?: unknown; server_paused?: unknown; notification_preferences?: unknown };
  try { body = await request.json(); } catch { return invalidJsonResponse(); }
  if (body.theme !== undefined && (typeof body.theme !== 'string' || !themes.has(body.theme))) return NextResponse.json({ error: 'Invalid theme' }, { status: 400 });
  if (body.notifications_enabled !== undefined && typeof body.notifications_enabled !== 'boolean') return NextResponse.json({ error: 'Invalid notifications_enabled' }, { status: 400 });
  if (body.server_paused !== undefined && typeof body.server_paused !== 'boolean') return NextResponse.json({ error: 'Invalid server_paused' }, { status: 400 });
  if (body.notification_preferences !== undefined && (!body.notification_preferences || typeof body.notification_preferences !== 'object' || Array.isArray(body.notification_preferences))) return NextResponse.json({ error: 'Invalid notification_preferences' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const user = await getCurrentUser();
  const update = {
    guild_id: guildId,
    ...(body.theme !== undefined ? { theme: body.theme } : {}),
    ...(body.notifications_enabled !== undefined ? { notifications_enabled: body.notifications_enabled } : {}),
    ...(body.server_paused !== undefined ? { server_paused: body.server_paused } : {}),
    ...(body.notification_preferences !== undefined ? { notification_preferences: body.notification_preferences } : {}),
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('server_settings').upsert(update, { onConflict: 'guild_id' }).select().single();
  if (error) return NextResponse.json({ error: 'Unable to save server settings' }, { status: 503 });
  return NextResponse.json({ settings: data });
}
