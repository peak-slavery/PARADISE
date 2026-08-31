/**
 * Input hygiene for every slash-command parameter.
 *
 * Slash command values are attacker-controlled: they can contain newlines,
 * zero-width characters, fake mentions or 4KB of junk designed to break embeds
 * or poison log output. Everything that reaches an embed, a database or a
 * downstream API passes through here first.
 */

/** Strips control chars, bidi/zero-width overrides, and collapses whitespace. */
export function sanitizeText(input: string, maxLength = 512): string {
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Neutralises mass-mention payloads before echoing user input back. */
export function escapeMentions(input: string): string {
  return input.replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@!?&?(\d{5,25})>/g, (m) => m.replace('@', '@\u200b'));
}

/** Reason text is stored and re-displayed, so it is both sanitised and escaped. */
export function sanitizeReason(input: string | null | undefined, maxLength = 512): string {
  if (!input) return 'No reason provided';
  const clean = sanitizeText(input, maxLength);
  return clean.length === 0 ? 'No reason provided' : escapeMentions(clean);
}

/** Validates a Discord snowflake. */
export function isSnowflake(value: string): boolean {
  return /^\d{15,25}$/.test(value);
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86_400,
  day: 86_400,
  days: 86_400,
  w: 604_800,
  week: 604_800,
  weeks: 604_800,
};

/**
 * Parses durations like "30s", "10m", "2h", "7d", "1w".
 * Returns null when unparseable so callers can raise a UserError.
 */
export function parseDuration(input: string): number | null {
  const match = /^(\d{1,6})\s*([a-z]{1,7})$/i.exec(sanitizeText(input, 16).toLowerCase());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = DURATION_UNITS[match[2] as string];
  if (!unit || !Number.isFinite(amount)) return null;
  return amount * unit;
}

export const MAX_TIMEOUT_SECONDS = 28 * 86_400; // Discord caps timeouts at 28 days

/** Human-readable duration, e.g. "2h 30m". */
export function formatDuration(seconds: number): string {
  const units: Array<[string, number]> = [
    ['d', 86_400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let remaining = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value > 0) parts.push(`${value}${label}`);
    remaining -= value * size;
    if (parts.length === 3) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}

/** Strips markdown so user text can be embedded safely. */
export function escapeMarkdown(input: string): string {
  return input.replace(/([\\`*_[\]{}()#+\-.!|>~])/g, '\\$1');
}
