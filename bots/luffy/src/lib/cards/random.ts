// ---------------------------------------------------------------------------
// Cryptographic randomness for the card economy.
//
// Pack draws, rarity selection, market jitter, and Limited Arts targeting are
// economically meaningful: a predictable sequence would let a player infer or
// steer the next drop, which is exactly the failure the drop table is designed
// to prevent. `Math.random()` is not a CSPRNG, so it must never be the default
// for these paths.
//
// The engine keeps its `rng: () => number` injection point so tests can pin
// results deterministically; these helpers are what production falls back to.
// ---------------------------------------------------------------------------

import { randomBytes, randomInt } from 'node:crypto';

/**
 * Uniform float in [0, 1) drawn from a CSPRNG.
 *
 * Uses 32 bits of entropy (2^32 discrete values), which is far finer than any
 * probability in the drop table — the rarest published outcome is 0.001%.
 */
export function secureRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 2 ** 32;
}

/**
 * Uniform integer in [0, max) drawn from a CSPRNG.
 *
 * `randomInt` rejects the biased tail rather than modulo-reducing, so every
 * value is equally likely — appropriate for sampling a definition from a pool.
 */
export function secureInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`secureInt requires a positive integer bound, got ${max}`);
  }
  return randomInt(max);
}