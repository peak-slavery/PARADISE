/** Small shared formatters. Pure — safe on both server and client. */

const UNITS: readonly { limit: number; seconds: number; label: string }[] = [
  { limit: 60, seconds: 1, label: 's' },
  { limit: 3600, seconds: 60, label: 'm' },
  { limit: 86400, seconds: 3600, label: 'h' },
  { limit: 2592000, seconds: 86400, label: 'd' },
  { limit: 31536000, seconds: 2592000, label: 'mo' },
  { limit: Number.POSITIVE_INFINITY, seconds: 31536000, label: 'y' },
];

/** `3m ago` / `in 2h`. Falls back to an absolute date past ~1 year. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';

  const deltaSec = Math.round((ms - now) / 1000);
  const future = deltaSec > 0;
  const abs = Math.abs(deltaSec);

  if (abs < 10) return future ? 'in a moment' : 'just now';

  for (const unit of UNITS) {
    if (abs < unit.limit) {
      const value = Math.floor(abs / unit.seconds);
      const text = `${value}${unit.label}`;
      return future ? `in ${text}` : `${text} ago`;
    }
  }
  return new Date(ms).toISOString().slice(0, 10);
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Stable absolute timestamp for log rows. */
export function absoluteTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return DATE_TIME.format(new Date(ms));
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Turn a raw event type like `mass_ban` into `Mass Ban`. */
export function humanizeToken(token: string): string {
  const words = token.split(/[_\-.]+/).filter((part) => part.length > 0);
  if (words.length === 0) return token;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Deterministic two-letter monogram used when a guild has no icon. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) {
    const only = words[0] ?? '';
    return only.slice(0, 2).toUpperCase();
  }
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}
