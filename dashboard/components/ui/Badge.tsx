import type { ReactNode } from 'react';

import type { LogLevel, SecuritySeverity } from '@/lib/types';
import { humanizeToken } from '@/lib/format';

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'critical' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-base-sunken text-ink-soft ring-ink/10',
  accent: 'bg-accent/10 text-accent-ink ring-accent/25',
  info: 'bg-bot-logging/10 text-bot-logging ring-bot-logging/25',
  success: 'bg-bot-levelup/20 text-[#1d7a3c] ring-bot-levelup/30',
  warn: 'bg-bot-cardgame/30 text-[#8a6510] ring-bot-cardgame/50',
  danger: 'bg-bot-moderation/10 text-[#b32a2d] ring-bot-moderation/30',
  critical: 'bg-bot-moderation/20 text-[#8f1f22] ring-bot-moderation/40',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
        TONES[tone],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<SecuritySeverity, Tone> = {
  low: 'neutral',
  medium: 'warn',
  high: 'danger',
  critical: 'critical',
};

/** Colour + dot keyed to the `security_severity` enum. */
export function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {severity}
    </Badge>
  );
}

const LEVEL_TONE: Record<LogLevel, Tone> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warn',
  error: 'danger',
  critical: 'critical',
};

export function LevelBadge({ level }: { level: LogLevel }) {
  return <Badge tone={LEVEL_TONE[level]}>{level}</Badge>;
}

export function EventTypeBadge({ eventType }: { eventType: string }) {
  return <Badge tone="accent">{humanizeToken(eventType)}</Badge>;
}
