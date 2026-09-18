import { NextResponse, type NextRequest } from 'next/server';
import { BOT_IDS, getAllowedRuntimeSecrets } from '@eiflow/secret-policy';

import { isBotId } from '@/lib/bots';
import { credentials } from '@/lib/demo';
import {
  HMAC_BOT_ID_HEADER,
  HMAC_GUILD_ID_HEADER,
  HMAC_METHOD_HEADER,
  HMAC_REQUEST_ID_HEADER,
  HMAC_ROUTE_HEADER,
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  verifyRequest,
} from '@/lib/hmac';
import { loadSecret } from '@/lib/secret-vault';
import { consumeNonce } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;
const NAME_PATTERN = /^[a-z][a-z0-9_.:-]{1,127}$/;

const BOT_SECRET_ALLOWLIST: Record<string, readonly string[]> = Object.fromEntries(
  BOT_IDS.map((botId) => [botId, getAllowedRuntimeSecrets(botId)]),
);

function botSecret(botId: string): string {
  const raw = process.env.HMAC_SECRETS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[botId];
      const entries = Object.entries(parsed);
      if (
        entries.length === BOT_IDS.length &&
        BOT_IDS.every((id) => typeof parsed[id] === 'string') &&
        entries.every(([, candidate]) => typeof candidate === 'string' && isStrongSecret(candidate)) &&
        new Set(Object.values(parsed)).size === entries.length &&
        typeof value === 'string'
      ) {
        return value;
      }
    } catch {
      // Fall through to the local-development secret.
    }
  }
  return process.env.NODE_ENV === 'production' ? '' : process.env.HMAC_SECRET?.trim() ?? '';
}

function isStrongSecret(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) || /^[A-Za-z0-9+/=_-]{43,}$/.test(value);
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
  const route = `/api/internal/secret/${encodeURIComponent(name)}`;
  const headerBotId = request.headers.get(HMAC_BOT_ID_HEADER) ?? '';
  const headerRequestId = request.headers.get(HMAC_REQUEST_ID_HEADER) ?? '';
  const headerMethod = request.headers.get(HMAC_METHOD_HEADER) ?? '';
  const headerRoute = request.headers.get(HMAC_ROUTE_HEADER) ?? '';
  const guildId = request.headers.get(HMAC_GUILD_ID_HEADER);
  if (
    !isBotId(headerBotId) ||
    !NAME_PATTERN.test(name) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(headerRequestId) ||
    headerMethod !== request.method ||
    headerMethod !== 'POST' ||
    headerRoute !== route ||
    guildId !== null
  ) {
    return NextResponse.json({ error: 'Invalid internal request' }, { status: 400 });
  }
  const secret = botSecret(headerBotId);
  if (
    !secret ||
    !credentials().hmac ||
    (process.env.NODE_ENV === 'production' && !process.env.HMAC_SECRETS_JSON?.trim())
  ) {
    return NextResponse.json({ error: 'Internal authentication is unavailable' }, { status: 503 });
  }

  const body = await boundedBody(request);
  if (body === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }
  const payload = parsed as { request_id?: unknown; bot_id?: unknown };
  if (
    payload.bot_id !== headerBotId ||
    payload.request_id !== headerRequestId ||
    typeof payload.request_id !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(payload.request_id)
  ) {
    return NextResponse.json({ error: 'Invalid internal payload' }, { status: 400 });
  }

  const timestamp = request.headers.get(HMAC_TIMESTAMP_HEADER) ?? '';
  const signature = request.headers.get(HMAC_SIGNATURE_HEADER) ?? '';
  const verification = verifyRequest(
    secret,
    body,
    timestamp,
    signature,
    undefined,
    {
      method: request.method,
      route,
      botId: headerBotId,
      requestId: headerRequestId,
      guildId,
    },
  );
  if (!verification.ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  const nonceAccepted = await consumeNonce(payload.request_id);
  if (!nonceAccepted) return NextResponse.json({ error: 'Replay rejected' }, { status: 409 });

  if (!BOT_SECRET_ALLOWLIST[headerBotId]?.includes(name)) return NextResponse.json({ error: 'Secret is not allowed for this bot' }, { status: 403 });
  try {
    const value = await loadSecret(name);
    if (value === null) return NextResponse.json({ error: 'Secret not configured' }, { status: 404 });
    return NextResponse.json({ name, value }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Secret vault is unavailable' }, { status: 503 });
  }
}
