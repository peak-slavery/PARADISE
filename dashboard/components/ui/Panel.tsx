import type { ReactNode } from 'react';

type Surface = 'neu' | 'neu-lg' | 'glass' | 'glass-strong' | 'quiet';

const SURFACES: Record<Surface, string> = {
  neu: 'neu-raised bg-base',
  'neu-lg': 'neu-raised-lg bg-base',
  glass: 'glass glass-sheen',
  'glass-strong': 'glass-strong glass-sheen',
  quiet: 'glass-quiet glass-sheen',
};

export interface PanelProps {
  children: ReactNode;
  surface?: Surface;
  className?: string;
}

/**
 * The one panel wrapper in the app. Marketing pages pass `glass`; dashboard
 * pages pass `neu` for content and `glass` for navigation/overlays, which is
 * the mix the design language calls for.
 */
export function Panel({ children, surface = 'neu', className = '' }: PanelProps) {
  return (
    <div
      className={[
        'rounded-3xl border border-white/60',
        SURFACES[surface],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export interface PanelHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  description,
  eyebrow,
  action,
  className = '',
}: PanelHeaderProps) {
  return (
    <div
      className={[
        'flex flex-col gap-3 border-b border-ink/5 px-6 py-5 sm:flex-row sm:items-start sm:justify-between',
        className,
      ].join(' ')}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Section eyebrow + heading + lede, shared by landing sections. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'center',
  className = '',
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  const alignment = align === 'center' ? 'text-center mx-auto items-center' : 'text-left items-start';
  return (
    <div className={['flex max-w-2xl flex-col', alignment, className].join(' ')}>
      <span className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-ink">
        {eyebrow}
      </span>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {lede ? (
        <p className="mt-4 text-pretty text-base leading-relaxed text-ink-soft">{lede}</p>
      ) : null}
    </div>
  );
}
