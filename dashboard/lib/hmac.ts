import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC request signing for bot <-> dashboard REST calls.
 *
 * The wire format matches @eiflow/shared. Legacy callers use
 * `<unixSeconds>.<rawBody>`; internal requests bind method, route, bot identity,
 * request ID, optional guild ID, timestamp, and the untouched raw body.
 *
 * This module is server-only. Never import it from a client component.
 */

export const HMAC_METHOD_HEADER = 'x-pe-method';
export const HMAC_ROUTE_HEADER = 'x-pe-route';
export const HMAC_BOT_ID_HEADER = 'x-pe-bot-id';
export const HMAC_REQUEST_ID_HEADER = 'x-pe-request-id';
export const HMAC_GUILD_ID_HEADER = 'x-pe-guild-id';
export const HMAC_TIMESTAMP_HEADER = 'x-pe-timestamp';
export const HMAC_SIGNATURE_HEADER = 'x-pe-signature';

export const DEFAULT_SKEW_SECONDS = 300;

export interface HmacRequestContext {
  method: string;
  route: string;
  botId: string;
  requestId: string;
  guildId?: string | null;
}

function secretKey(): string {
  return process.env.HMAC_SECRET ?? '';
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
  return contextDigest(secret, context, String(timestamp), body);
}

/** Backward-compatible legacy signer for existing shared callers and tests. */
export function signRequest(
  secret: string,
  body: string,
  timestamp: number | string = Math.floor(Date.now() / 1000),
): { timestamp: string; signature: string } {
  const ts = String(timestamp);
  return { timestamp: ts, signature: legacyDigest(secret, ts, body) };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type VerifyFailure =
  | 'missing_secret'
  | 'missing_headers'
  | 'stale'
  | 'bad_signature';

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: VerifyFailure };

export function verifyRequest(
  secret: string,
  body: string,
  timestampHeader: string | null | undefined,
  signatureHeader: string | null | undefined,
  skewSec: number = DEFAULT_SKEW_SECONDS,
  context?: HmacRequestContext,
): VerifyResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  const now = Math.floor(Date.now() / 1000);
  if (!/^\d{1,15}$/.test(timestampHeader)) return { ok: false, reason: 'stale' };

  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > skewSec) {
    return { ok: false, reason: 'stale' };
  }

  const expected = context
    ? contextDigest(secret, context, timestampHeader, body)
    : legacyDigest(secret, timestampHeader, body);
  return safeEqual(expected, signatureHeader) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

export function verifyWithEnvSecret(
  body: string,
  timestampHeader: string | null | undefined,
  signatureHeader: string | null | undefined,
  skewSec: number = DEFAULT_SKEW_SECONDS,
  context?: HmacRequestContext,
): VerifyResult {
  return verifyRequest(secretKey(), body, timestampHeader, signatureHeader, skewSec, context);
}

export function signWithEnvSecret(
  body: string,
  timestamp: number | string = Math.floor(Date.now() / 1000),
  context?: HmacRequestContext,
) {
  const secret = secretKey();
  const signature = context
    ? signRequestWithContext(secret, body, context, timestamp)
    : signRequest(secret, body, timestamp).signature;
  if (!secret || !signature) return null;
  const headers: Record<string, string> = {
    [HMAC_METHOD_HEADER]: context?.method.toUpperCase() ?? '',
    [HMAC_ROUTE_HEADER]: context?.route ?? '',
    [HMAC_BOT_ID_HEADER]: context?.botId ?? '',
    [HMAC_REQUEST_ID_HEADER]: context?.requestId ?? '',
    [HMAC_TIMESTAMP_HEADER]: String(timestamp),
    [HMAC_SIGNATURE_HEADER]: signature,
  };
  if (context?.guildId !== undefined && context.guildId !== null) {
    headers[HMAC_GUILD_ID_HEADER] = context.guildId;
  }
  return { timestamp: String(timestamp), signature, headers };
}
