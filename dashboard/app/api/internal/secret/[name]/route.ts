import { NextResponse, type NextRequest } from 'next/server';

import { BOTS, isBotId } from '@/lib/bots';
import { credentials } from '@/lib/demo';
import { HMAC_SIGNATURE_HEADER, HMAC_TIMESTAMP_HEADER, verifyRequest } from '@/lib/hmac';
import { loadSecret } from '@/lib/secret-vault';
import { consumeNonce } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;
const NAME_PATTERN = /^[a-z][a-z0-9_.:-]{1,127}$/;

const BOT_SECRET_ALLOWLIST: Record<string, readonly string[]> = Object.fromEntries(
  BOTS.map((bot) => [bot.id, [
    'core.guild.dev',
    'core.guild.main',
    'core.guild.dev.auth_channel',
    `discord.${bot.id}.token`,
    'mongodb.primary.uri',
    'mongodb.primary.database',
    'mongodb.secondary.uri',
    'mongodb.secondary.database',
    'redis.primary.url',
    'redis.primary.token',
    'supabase.runtime.url',
    'supabase.runtime.service_key',
    'firebase.admin.service_account',
    'cloudflare.account_id',
    'cloudflare.api_token',
    'cloudflare.r2.access_key_id',
    'cloudflare.r2.secret_access_key',
    'cloudflare.r2.endpoint',
    'cloudflare.d1.database_id',
  ]]),
);

function botSecret(botId: string): string {
  const raw = process.env.HMAC_SECRETS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[botId];
      if (typeof value === 'string' && value.length >= 32) return value;
    } catch {
      // Fall through to the local-development secret.
    }
  }
  return process.env.NODE_ENV === 'production' ? '' : process.env.HMAC_SECRET?.trim() ?? '';
}

async function boundedBody(request: NextRequest): Promise<string | null> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) return null;
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
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const botId = request.headers.get('x-pe-bot-id') ?? '';
  if (!isBotId(botId) || !NAME_PATTERN.test(name)) return NextResponse.json({ error: 'Invalid internal request' }, { status: 400 });
  const secret = botSecret(botId);
  if (!secret || !credentials().hmac) return NextResponse.json({ error: 'Internal authentication is unavailable' }, { status: 503 });

  const body = await boundedBody(request);
  if (body === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  let payload: { request_id?: unknown; bot_id?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (payload.bot_id !== botId || typeof payload.request_id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.request_id)) {
    return NextResponse.json({ error: 'Invalid internal payload' }, { status: 400 });
  }

  const timestamp = request.headers.get(HMAC_TIMESTAMP_HEADER) ?? '';
  const signature = request.headers.get(HMAC_SIGNATURE_HEADER) ?? '';
  if (!verifyRequest(secret, body, timestamp, signature).ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  const nonceAccepted = await consumeNonce(payload.request_id);
  if (!nonceAccepted) return NextResponse.json({ error: 'Replay rejected' }, { status: 409 });

  if (!BOT_SECRET_ALLOWLIST[botId]?.includes(name)) return NextResponse.json({ error: 'Secret is not allowed for this bot' }, { status: 403 });
  try {
    const value = await loadSecret(name);
    if (value === null) return NextResponse.json({ error: 'Secret not configured' }, { status: 404 });
    return NextResponse.json({ name, value }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Secret vault is unavailable' }, { status: 503 });
  }
}
