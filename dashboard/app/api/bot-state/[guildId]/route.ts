import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, boundedJson } from '@/lib/api-response';
import { authorizeGuildOrMaster, isDiscordSnowflake } from '@/lib/authz';
import { validateJsonbObject } from '@/lib/jsonb';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';
import type { BotId } from '@/lib/types';

const botIds = new Set<BotId>(['cyrene', 'luffy', 'zoro', 'nami', 'sanji', 'shanks', 'niko-robin', 'boahancock']);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await authorizeGuildOrMaster(guildId);
  if (!access.ok) return authorizationResponse(access);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.from('bot_states').select('*').eq('guild_id', guildId).order('bot_id');
  if (error) return NextResponse.json({ error: 'Unable to load bot states' }, { status: 503 });
  return NextResponse.json({ states: data ?? [] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guild id' }, { status: 400 });
  const access = await authorizeGuildOrMaster(guildId);
  if (!access.ok) return authorizationResponse(access);
  const parsed = await boundedJson<{ bot_id?: unknown; enabled?: unknown; paused?: unknown; feature_flags?: unknown }>(request, 16 * 1024);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (typeof body.bot_id !== 'string' || !botIds.has(body.bot_id as BotId)) return NextResponse.json({ error: 'Invalid bot_id' }, { status: 400 });
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Invalid enabled' }, { status: 400 });
  if (body.paused !== undefined && typeof body.paused !== 'boolean') return NextResponse.json({ error: 'Invalid paused' }, { status: 400 });
  if (body.feature_flags !== undefined) {
    const flags = validateJsonbObject(body.feature_flags);
    if (!flags.ok) return NextResponse.json({ error: `Invalid feature_flags: ${flags.reason}` }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const user = await getCurrentUser();
  const update = {
    guild_id: guildId,
    bot_id: body.bot_id,
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.paused !== undefined ? { paused: body.paused } : {}),
    ...(body.feature_flags !== undefined ? { feature_flags: body.feature_flags } : {}),
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('bot_states').upsert(update, { onConflict: 'guild_id,bot_id' }).select().single();
  if (error) return NextResponse.json({ error: 'Unable to save bot state' }, { status: 503 });
  return NextResponse.json({ state: data });
}
