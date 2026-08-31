import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC request signing for bot <-> dashboard REST calls.
 *
 * Wire format mirrors the bots' `@eiflow/shared` implementation:
 *
 *   signature = hex( HMAC_SHA256(secret, `${timestamp}.${body}`) )
 *
 * Headers: `x-pe-timestamp` (unix seconds) and `x-pe-signature`.
 * Replay protection is a 300s tolerance window in either direction.
 *
 * `node:crypto` — this module is server-only. Never import it from a
 * `'use client'` component.
 */

export const HMAC_TIMESTAMP_HEADER = 'x-pe-timestamp';
export const HMAC_SIGNATURE_HEADER = 'x-pe-signature';

/** Default clock-skew tolerance, in seconds. */
export const DEFAULT_SKEW_SECONDS = 300;

function secretKey(): string {
  return process.env.HMAC_SECRET ?? '';
}

/** Canonical signing payload: `<unixSeconds>.<rawBody>`. */
export function canonicalString(timestamp: number | string, body: string): string {
  return `${String(timestamp)}.${body}`;
}

/** Produce the hex signature a bot should send. Returns `null` unconfigured. */
export function signRequest(secret: string, body: string, timestamp: number): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(canonicalString(timestamp, body)).digest('hex');
}

/** Sign with the ambient `HMAC_SECRET` — used by outgoing dashboard calls. */
export function signWithEnvSecret(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const secret = secretKey();
  const signature = signRequest(secret, body, timestamp);
  if (!signature) return null;
  return {
    timestamp: String(timestamp),
    signature,
    headers: {
      [HMAC_TIMESTAMP_HEADER]: String(timestamp),
      [HMAC_SIGNATURE_HEADER]: signature,
    } as Record<string, string>,
  };
}

export type VerifyFailure =
  | 'missing_secret'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'bad_signature';

export type VerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: VerifyFailure };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify an inbound signed request.
 *
 * Constant-time comparison, plus a length check before `timingSafeEqual`
 * (which throws on mismatched buffer lengths). `skewSec` defaults to 300s.
 */
export function verifyRequest(
  secret: string,
  body: string,
  tsHeader: string | null | undefined,
  sigHeader: string | null | undefined,
  skewSec: number = DEFAULT_SKEW_SECONDS,
): VerifyResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!tsHeader || !sigHeader) return { ok: false, reason: 'missing_headers' };

  if (!/^\d+$/.test(tsHeader)) return { ok: false, reason: 'bad_timestamp' };
  const timestamp = Number(tsHeader);
  if (!Number.isSafeInteger(timestamp)) return { ok: false, reason: 'bad_timestamp' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > skewSec) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = signRequest(secret, body, timestamp);
  if (!expected) return { ok: false, reason: 'missing_secret' };
  if (!safeEqual(expected, sigHeader)) return { ok: false, reason: 'bad_signature' };

  return { ok: true, timestamp };
}

/** Verify against the ambient `HMAC_SECRET`. */
export function verifyWithEnvSecret(
  body: string,
  tsHeader: string | null | undefined,
  sigHeader: string | null | undefined,
  skewSec: number = DEFAULT_SKEW_SECONDS,
): VerifyResult {
  return verifyRequest(secretKey(), body, tsHeader, sigHeader, skewSec);
}
