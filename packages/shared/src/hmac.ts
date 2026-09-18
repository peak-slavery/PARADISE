import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed bot <-> dashboard transport. Every internal endpoint must reject
 * unsigned or stale requests; no bot endpoint is ever publicly open.
 */

const DEFAULT_SKEW_SEC = 300;

export interface HmacRequestContext {
  method: string;
  route: string;
  botId: string;
  requestId: string;
  guildId?: string | null;
}

function validateContext(context: HmacRequestContext): void {
  if (!/^[A-Z]+$/.test(context.method.toUpperCase())) {
    throw new TypeError('HMAC method must contain only letters');
  }
  if (!context.route.startsWith('/') || context.route.includes('?') || context.route.includes('#') || /[\r\n]/.test(context.route)) {
    throw new TypeError('HMAC route must be an absolute path without a query or fragment');
  }
  for (const [name, value] of [
    ['bot identity', context.botId],
    ['request ID', context.requestId],
  ] as const) {
    if (!value || /[\r\n]/.test(value)) throw new TypeError(`HMAC ${name} is required and must be single-line`);
  }
  if (context.guildId !== undefined && context.guildId !== null && !/^\d{17,20}$/.test(context.guildId)) {
    throw new TypeError('HMAC guild ID must be a Discord snowflake when present');
  }
}

function legacyDigest(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function contextDigest(secret: string, context: HmacRequestContext, timestamp: string, body: string): string {
  return createHmac('sha256', secret)
    .update(canonicalString(timestamp, body, context))
    .digest('hex');
}

/**
 * Canonical signing payload.
 *
 * Legacy callers use `<unixSeconds>.<rawBody>`. Internal requests use an
 * unambiguous line-delimited envelope containing method, route, bot identity,
 * request ID, optional guild ID, timestamp, and the untouched raw body.
 */
export function canonicalString(
  timestamp: number | string,
  body: string,
  context?: HmacRequestContext,
): string {
  const ts = String(timestamp);
  if (!context) return `${ts}.${body}`;

  validateContext(context);
  return [
    context.method.toUpperCase(),
    context.route,
    context.botId,
    context.requestId,
    context.guildId ?? '',
    ts,
    body,
  ].join('\n');
}

export function signRequestWithContext(
  secret: string,
  body: string,
  context: HmacRequestContext,
  timestamp: number | string = Math.floor(Date.now() / 1000),
): string {
  const ts = String(timestamp);
  return contextDigest(secret, context, ts, body);
}

/** Backward-compatible legacy signer for existing shared callers and tests. */
export function signRequest(
  secret: string,
  body: string,
  timestamp: number | string = Math.floor(Date.now() / 1000),
): {
  timestamp: string;
  signature: string;
} {
  const ts = String(timestamp);
  return { timestamp: ts, signature: legacyDigest(secret, ts, body) };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'missing_secret' | 'missing_headers' | 'stale' | 'bad_signature';
}

export function verifyRequest(
  secret: string,
  body: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  skewSec = DEFAULT_SKEW_SEC,
  context?: HmacRequestContext,
): VerifyResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  const now = Math.floor(Date.now() / 1000);

  // Require a canonical, digit-only unix timestamp. A permissive Number() parse
  // would let several distinct strings denote one signed instant.
  if (!/^\d{1,15}$/.test(timestampHeader)) {
    return { ok: false, reason: 'stale' };
  }

  const ts = Number(timestampHeader);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > skewSec) {
    return { ok: false, reason: 'stale' };
  }

  const expected = context
    ? contextDigest(secret, context, timestampHeader, body)
    : legacyDigest(secret, timestampHeader, body);
  return safeEqual(expected, signatureHeader) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
