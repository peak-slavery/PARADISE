/**
 * The level curve. Pure functions only — no I/O, no Discord types — so the
 * whole thing is trivially unit-testable.
 *
 * XP is a single cumulative counter per member. The level is derived from it
 * deterministically, which means a level can be recomputed anywhere (in the
 * flush path, in /rank, in the dashboard) without extra state.
 */

/** Curve coefficients for `xpForLevel`. */
export const CURVE = { quadratic: 5, linear: 50, base: 100 } as const;

/** Safety rail: nobody is level 10 000, and it bounds the level-up loop. */
export const MAX_LEVEL = 999;

/** XP required to advance from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level));
  return CURVE.quadratic * n * n + CURVE.linear * n + CURVE.base;
}

/**
 * Cumulative XP required to *reach* `level` (reaching level 0 is free).
 * Closed form of sum(k = 0..n-1) xpForLevel(k).
 */
export function totalXpForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level));
  return (
    (CURVE.quadratic * (n - 1) * n * (2 * n - 1)) / 6 +
    (CURVE.linear * n * (n - 1)) / 2 +
    CURVE.base * n
  );
}

/** The level a member sits at for a given cumulative XP total. */
export function levelForXp(xp: number): number {
  const total = Math.max(0, Math.floor(xp));
  let level = 0;
  while (level < MAX_LEVEL && total >= totalXpForLevel(level + 1)) level += 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP needed to go from the current level to the next one. */
  needed: number;
  /** XP still missing before the next level. */
  remaining: number;
  /** Completion of the current level, 0–100. */
  percent: number;
}

export function levelProgress(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  const level = levelForXp(total);
  const into = total - totalXpForLevel(level);
  const needed = xpForLevel(level);
  const remaining = Math.max(0, needed - into);
  const percent = needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 100;
  return { level, into, needed, remaining, percent };
}

/** Text bar for embeds, e.g. `[▓▓▓▓▓░░░░░░░]`. */
export function progressBar(percent: number, size = 12): string {
  const filled = Math.max(0, Math.min(size, Math.round((Math.max(0, Math.min(100, percent)) / 100) * size)));
  return `[${'▓'.repeat(filled)}${'░'.repeat(size - filled)}]`;
}
