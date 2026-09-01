import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed bot <-> dashboard transport. Every internal endpoint must reject
 * unsigned or stale requests; no bot endpoint is ever publicly open.
 */

const DEFAULT_SKEW_SEC = 300;

function digest(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signRequest(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): {
  timestamp: string;
  signature: string;
} {
  const ts = String(timestamp);
  return { timestamp: ts, signature: digest(secret, ts, body) };
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
): VerifyResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  const now = Math.floor(Date.now() / 1000);

  // Require a canonical, digit-only unix timestamp.
  //
  // The signature is taken over the *raw* header string, so a permissive
  // `Number()` parse would let several distinct strings ("1e3", " 1000 ",
  // "1000.0") denote the same instant. That weakens header canonicalization
  // and makes replay reasoning unreliable, so accept exactly one form.
  if (!/^\d{1,15}$/.test(timestampHeader)) {
    return { ok: false, reason: 'stale' };
  }

  const ts = Number(timestampHeader);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > skewSec) {
    return { ok: false, reason: 'stale' };
  }

  const expected = digest(secret, timestampHeader, body);
  return safeEqual(expected, signatureHeader) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
