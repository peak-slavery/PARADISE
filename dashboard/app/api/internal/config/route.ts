import { NextResponse, type NextRequest } from 'next/server';

import { BOTS, getBot, isBotId } from '@/lib/bots';
import { credentials } from '@/lib/demo';
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  signRequest,
  verifyRequest,
} from '@/lib/hmac';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { consumeNonce } from '@/lib/internal-auth';
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
 * Bots have no dashboard session, so they authenticate with an HMAC signature
 * instead: `hex(HMAC_SHA256(HMAC_SECRET, "<unixSeconds>.<rawBody>"))` sent as
 * `x-pe-timestamp` + `x-pe-signature`, valid inside a 300s skew window. This is
 * the same construction the bots use in `@eiflow/shared`, so one secret signs
 * traffic in both directions.
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

  let payload: { guild_id?: unknown; bot_id?: unknown; config?: unknown; request_id?: unknown };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const guildId = typeof payload.guild_id === 'string' ? payload.guild_id : '';
  const botId = typeof payload.bot_id === 'string' ? payload.bot_id : '';
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';

  if (!/^\d{17,20}$/.test(guildId) || !isBotId(botId) || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    return NextResponse.json(
      { error: 'Expected valid `guild_id`, `bot_id`, and unique `request_id`' },
      { status: 400 },
    );
  }

  const verification = verifyRequest(
    secretForBot(botId),
    rawBody,
    request.headers.get(HMAC_TIMESTAMP_HEADER),
    request.headers.get(HMAC_SIGNATURE_HEADER),
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

  // The HMAC proves which bot signed the request, not that the bot may modify
  // the supplied guild. Require a positively authorized server before using
  // the service-role client for the config write.
  const { data: server, error: serverError } = await supabase
    .from('servers')
    .select('authorized')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (serverError) {
    console.error('[internal/config] guild authorization lookup failed', { code: serverError.code });
    return NextResponse.json({ error: 'Configuration write failed' }, { status: 503 });
  }
  if (server?.authorized !== true) {
    return NextResponse.json({ error: 'Guild is not authorized' }, { status: 403 });
  }

  try {
    if (!await consumeNonce(requestId)) {
      return NextResponse.json({ error: 'Request already processed' }, { status: 409 });
    }
  } catch (error) {
    console.error('[internal/config] nonce insert failed', { error });
    return NextResponse.json({ error: 'Configuration write failed' }, { status: 500 });
  }

  const { error } = await supabase.from('bot_configs').upsert(
    {
      guild_id: guildId,
      bot_id: botId,
      config: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id,bot_id' },
  );

  if (error) {
    console.error('[internal/config] configuration write failed', { code: error.code });
    return NextResponse.json({ error: 'Configuration write failed' }, { status: 500 });
  }

  // Echo a fresh signature so a bot can verify round-trip parity in tests.
  const echoBody = JSON.stringify({ ok: true, guild_id: guildId, bot_id: botId });
  const echoTimestamp = Math.floor(Date.now() / 1000);
  const echoSignature = signRequest(secretForBot(botId), echoBody, echoTimestamp);

  return NextResponse.json(
    { ok: true, guild_id: guildId, bot_id: botId, config: clean, receivedAt: verification.timestamp },
    {
      headers: echoSignature
        ? { [HMAC_TIMESTAMP_HEADER]: String(echoTimestamp), [HMAC_SIGNATURE_HEADER]: echoSignature }
        : undefined,
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
