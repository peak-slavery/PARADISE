import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, invalidJsonResponse } from '@/lib/api-response';
import { authorizeGuildOrMaster, isDiscordSnowflake } from '@/lib/authz';
import { isBotId } from '@/lib/bots';
import { publishDashboardEmbed } from '@/lib/interlink';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type EmbedBody = {
  bot_id?: unknown;
  channel_id?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  color?: unknown;
  thumbnail?: unknown;
  image?: unknown;
  footer?: unknown;
  author?: unknown;
  fields?: unknown;
  buttons?: unknown;
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function url(value: unknown): string {
  const raw = text(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

async function readBody(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guild id' }, { status: 400 });
  const access = await authorizeGuildOrMaster(guildId);
  if (!access.ok) return authorizationResponse(access);

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  const rawBody = await readBody(request);
  if (rawBody === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });

  let body: EmbedBody;
  try {
    body = JSON.parse(rawBody) as EmbedBody;
  } catch {
    return invalidJsonResponse();
  }

  const botId = typeof body.bot_id === 'string' ? body.bot_id : '';
  const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : '';
  if (!isBotId(botId)) return NextResponse.json({ error: 'Invalid bot_id' }, { status: 400 });
  if (!/^\d{17,20}$/.test(channelId)) return NextResponse.json({ error: 'Invalid channel_id' }, { status: 400 });

  const title = text(body.title, 256);
  const description = text(body.description, 4096);
  const footer = text(body.footer, 2048);
  const color = text(body.color, 7) || '#5865F2';
  const authorSource = body.author && typeof body.author === 'object' && !Array.isArray(body.author)
    ? body.author as Record<string, unknown>
    : {};
  const fields = Array.isArray(body.fields)
    ? body.fields.slice(0, 25).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const field = item as Record<string, unknown>;
        const name = text(field.name, 256);
        const value = text(field.value, 1024);
        return name && value ? [{ name, value, inline: field.inline === true }] : [];
      })
    : [];

  const hasAuthor = text(authorSource.name, 256).length > 0;
  const hasFields = fields.length > 0;
  const hasMedia = url(body.thumbnail).length > 0 || url(body.image).length > 0;
  if (!title && !description && !footer && !hasAuthor && !hasFields && !hasMedia) {
    return NextResponse.json({ error: 'Add content to the embed before sending' }, { status: 400 });
  }
  if (!HEX_COLOR.test(color)) return NextResponse.json({ error: 'Invalid embed color' }, { status: 400 });

  const buttons = Array.isArray(body.buttons)
    ? body.buttons.slice(0, 5).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const button = item as Record<string, unknown>;
        const label = text(button.label, 80);
        const buttonUrl = url(button.url);
        return label && buttonUrl ? [{ label, url: buttonUrl }] : [];
      })
    : [];

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const [settingsResult, stateResult] = await Promise.all([
    supabase.from('server_settings').select('server_paused').eq('guild_id', guildId).maybeSingle(),
    supabase.from('bot_states').select('enabled,paused').eq('guild_id', guildId).eq('bot_id', botId).maybeSingle(),
  ]);
  if (settingsResult.error || stateResult.error) return NextResponse.json({ error: 'Unable to verify bot state' }, { status: 503 });
  if (settingsResult.data?.server_paused || stateResult.data?.enabled === false || stateResult.data?.paused) {
    return NextResponse.json({ error: 'The selected bot or server is paused' }, { status: 409 });
  }

  try {
    const result = await publishDashboardEmbed({
      botId,
      guildId,
      channelId,
      title,
      description,
      url: url(body.url),
      color,
      thumbnail: url(body.thumbnail),
      image: url(body.image),
      author: { name: text(authorSource.name, 256), url: url(authorSource.url), iconUrl: url(authorSource.iconUrl) },
      footer,
      fields,
      buttons,
    });
    return NextResponse.json({ ok: true, queued: true, event_id: result.eventId }, { status: 202 });
  } catch (error) {
    console.error('[embed] interlink publication failed', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: 'Embed delivery is temporarily unavailable' }, { status: 503 });
  }
}
