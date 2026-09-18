import { NextResponse, type NextRequest } from 'next/server';

import { BOTS, getBot, isBotId } from '@/lib/bots';
import { credentials } from '@/lib/demo';
import {
  DEFAULT_SKEW_SECONDS,
  HMAC_BOT_ID_HEADER,
  HMAC_GUILD_ID_HEADER,
  HMAC_METHOD_HEADER,
  HMAC_REQUEST_ID_HEADER,
  HMAC_ROUTE_HEADER,
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  signRequestWithContext,
  verifyRequest,
  type HmacRequestContext,
} from '@/lib/hmac';
import { isApprovedGuild } from '@eiflow/shared';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ConfigValues } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

function configuredBotSecrets(): Record<string, string> | null {
  const raw = process.env.HMAC_SECRETS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (
      entries.length !== BOTS.length ||
      BOTS.some(({ id }) => typeof (parsed as Record<string, unknown>)[id] !== 'string') ||
      entries.some(([, value]) => typeof value !== 'string' || !isStrongSecret(value))
    ) {
      return null;
    }
    const secrets = Object.fromEntries(entries) as Record<string, string>;
    if (new Set(Object.values(secrets)).size !== entries.length) return null;
    return secrets;
  } catch {
    return null;
  }
}

function isStrongSecret(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) || /^[A-Za-z0-9+/=_-]{43,}$/.test(value);
}

function secretForBot(botId: string): string {
  const configured = configuredBotSecrets();
  if (configured) return configured[botId] ?? '';

  // The legacy single secret remains useful for local development. Production
  // requires HMAC_SECRETS_JSON so a compromised bot cannot impersonate another.
  return process.env.NODE_ENV === 'production' ? '' : process.env.HMAC_SECRET ?? '';
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    return null;
  }

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

/**
 * Internal bot -> dashboard config sync.
 *
 * Bots have no dashboard session, so they authenticate with an HMAC signature.
 * The signature covers POST, the canonical route, bot identity, request ID,
 * guild ID, timestamp, and the untouched raw body. Replay protection is handled
 * by the database nonce consumed by the config RPC.
 *
 * The write uses the service-role client (RLS bypass) because the actor is a
 * trusted service, not a signed-in owner — which is exactly why the signature
 * check has to be airtight.
 */
export async function POST(request: NextRequest) {
  if (
    !credentials().hmac ||
    (process.env.NODE_ENV === 'production' && !configuredBotSecrets())
  ) {
    return NextResponse.json({ error: 'Internal authentication is unavailable' }, { status: 503 });
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  // The signature covers the *raw* body, so it must be read as text before any
  // JSON parsing re-serializes it.
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }
  const payload = parsed as { guild_id?: unknown; bot_id?: unknown; config?: unknown; request_id?: unknown };

  const guildId = typeof payload.guild_id === 'string' ? payload.guild_id : '';
  const botId = typeof payload.bot_id === 'string' ? payload.bot_id : '';
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';
  const headerBotId = request.headers.get(HMAC_BOT_ID_HEADER) ?? '';
  const headerGuildId = request.headers.get(HMAC_GUILD_ID_HEADER) ?? '';
  const headerRequestId = request.headers.get(HMAC_REQUEST_ID_HEADER) ?? '';
  const headerMethod = request.headers.get(HMAC_METHOD_HEADER) ?? '';
  const headerRoute = request.headers.get(HMAC_ROUTE_HEADER) ?? '';
  const route = '/api/internal/config';
  const context: HmacRequestContext = {
    method: request.method.toUpperCase(),
    route,
    botId,
    requestId,
    guildId,
  };

  if (
    !/^\d{17,20}$/.test(guildId) ||
    !isBotId(botId) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(requestId) ||
    !isApprovedGuild(guildId, process.env.EIFLOW_ENV) ||
    headerBotId !== botId ||
    headerGuildId !== guildId ||
    headerRequestId !== requestId ||
    headerMethod !== request.method ||
    headerRoute !== route
  ) {
    return NextResponse.json(
      { error: 'Expected valid, parity-matched internal request context' },
      { status: 400 },
    );
  }

  const verification = verifyRequest(
    secretForBot(botId),
    rawBody,
    request.headers.get(HMAC_TIMESTAMP_HEADER),
    request.headers.get(HMAC_SIGNATURE_HEADER),
    DEFAULT_SKEW_SECONDS,
    context,
  );
  if (!verification.ok) {
    return NextResponse.json({ error: 'Invalid signature', reason: verification.reason }, { status: 401 });
  }

  const incoming = payload.config;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return NextResponse.json({ error: 'Expected a `config` object' }, { status: 400 });
  }

  // Whitelist + coerce against the declared field schema before writing.
  const source = incoming as Record<string, unknown>;
  const bot = getBot(botId);
  const clean: ConfigValues = {};

  for (const field of bot.fields) {
    const raw = source[field.key];
    if (raw === undefined) continue;

    switch (field.type) {
      case 'boolean':
        clean[field.key] = raw === true || raw === 'true' || raw === 1;
        break;
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) continue;
        const min = field.min ?? Number.NEGATIVE_INFINITY;
        const max = field.max ?? Number.POSITIVE_INFINITY;
        clean[field.key] = Math.min(Math.max(num, min), max);
        break;
      }
      case 'select':
        if (!field.options.some((option) => option.value === raw)) continue;
        clean[field.key] = String(raw);
        break;
      default:
        clean[field.key] = typeof raw === 'string' ? raw.slice(0, 4000) : String(raw);
        break;
    }
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  const { data: applied, error } = await supabase.rpc('apply_bot_config_request', {
    p_request_id: requestId,
    p_guild_id: guildId,
    p_bot_id: botId,
    p_config: clean,
  });
  if (error) {
    if (error.message === 'guild is not authorized') {
      return NextResponse.json({ error: 'Guild is not authorized' }, { status: 403 });
    }
    console.error('[internal/config] atomic configuration write failed', { code: error.code });
    return NextResponse.json({ error: 'Configuration write failed' }, { status: 500 });
  }
  if (applied !== true) {
    return NextResponse.json({ error: 'Request already processed' }, { status: 409 });
  }

  // Echo a fresh signature so a bot can verify round-trip parity in tests.
  const echoBody = JSON.stringify({ ok: true, guild_id: guildId, bot_id: botId });
  const echoTimestamp = Math.floor(Date.now() / 1000);
  const echoContext: HmacRequestContext = { method: 'POST', route, botId, requestId, guildId };
  const echoSignature = signRequestWithContext(secretForBot(botId), echoBody, echoContext, echoTimestamp);
  const receivedAt = Number(request.headers.get(HMAC_TIMESTAMP_HEADER));

  return NextResponse.json(
    { ok: true, guild_id: guildId, bot_id: botId, config: clean, receivedAt },
    {
      headers: {
        [HMAC_METHOD_HEADER]: 'POST',
        [HMAC_ROUTE_HEADER]: route,
        [HMAC_BOT_ID_HEADER]: botId,
        [HMAC_REQUEST_ID_HEADER]: requestId,
        [HMAC_GUILD_ID_HEADER]: guildId,
        [HMAC_TIMESTAMP_HEADER]: String(echoTimestamp),
        [HMAC_SIGNATURE_HEADER]: echoSignature,
      },
    },
  );
}

export function GET() {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      hint: 'POST a signed body with x-pe-timestamp and x-pe-signature headers',
    },
    { status: 405 },
  );
}
