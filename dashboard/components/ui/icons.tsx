import type { ComponentType, SVGProps } from 'react';

import type { BotId } from '@/lib/bot-meta';

/**
 * Inline icon set. Drawn rather than pulled from a package so the bundle
 * stays on the declared dependency list and every glyph inherits
 * `currentColor` for free.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.8-7 9.5-4.1-1.7-7-5.3-7-9.5V6l7-3z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
  );
}

export function IconScroll(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 4h9a3 3 0 013 3v13H9a3 3 0 01-3-3V4z" />
      <path d="M6 17a3 3 0 013-3h9" />
      <path d="M9.5 8h5.5M9.5 11.5h5.5" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5" />
      <path d="M12 14.6v2.2" />
    </svg>
  );
}

export function IconWave(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 14.5c1.6 0 2-6 3.6-6s1.8 8 3.4 8 1.9-9 3.5-9 2 5 3.6 5 1.7-3 2.9-3" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 19.5V5" />
      <path d="M4.5 19.5h15" />
      <path d="M8 16V11M12.5 16V7.5M17 16v-3.5" />
    </svg>
  );
}

export function IconCards(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="6" width="9" height="12" rx="2" />
      <path d="M8.5 9.5h9.5a2.5 2.5 0 012.5 2.5v6a2.5 2.5 0 01-2.5 2.5H11a2.5 2.5 0 01-2.5-2.5V9.5" />
      <path d="M11 13.5h6" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.5 15.5L20 20" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8L12 3.5z" />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </svg>
  );
}

export function IconDiscord(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={props.size ?? 20}
      height={props.size ?? 20}
      aria-hidden
      {...props}
    >
      <path d="M19.3 5.34A16.1 16.1 0 0015.4 4.2l-.28.56a12 12 0 013.4 1.02 11.6 11.6 0 00-9.05 0A12 12 0 0112.9 4.76L12.6 4.2a16.1 16.1 0 00-3.9 1.14C5.9 9.03 5.16 13.4 5.5 17.7a15.9 15.9 0 004.83 2.44l.6-1.02c-.85-.3-1.65-.7-2.38-1.2l.53-.4a11.4 11.4 0 008.84 0l.53.4c-.73.5-1.53.9-2.38 1.2l.6 1.02a15.9 15.9 0 004.83-2.44c.4-4.97-.68-9.3-2.57-12.36zM9.7 15.3c-.95 0-1.73-.87-1.73-1.94 0-1.07.76-1.94 1.73-1.94.98 0 1.76.88 1.74 1.94 0 1.07-.77 1.94-1.74 1.94zm4.6 0c-.95 0-1.73-.87-1.73-1.94 0-1.07.76-1.94 1.73-1.94.98 0 1.76.88 1.74 1.94 0 1.07-.76 1.94-1.74 1.94z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12.8l4.2 4.2L19 7.2" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h14.5" />
      <path d="M13.5 6.5l6 5.5-6 5.5" />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4.5l8.5 15h-17l8.5-15z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.8V12l3 1.9" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l8.5 4.3-8.5 4.3L3.5 7.8 12 3.5z" />
      <path d="M3.5 12.2l8.5 4.3 8.5-4.3" />
      <path d="M3.5 16.4l8.5 4.3 8.5-4.3" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 12h3.6l2.3-6 3.2 12 2.4-6h5" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 6.5v4.2h-4.2" />
      <path d="M19.4 11.2A7.6 7.6 0 105.8 8.9" />
      <path d="M4 17.5v-4.2h4.2" />
    </svg>
  );
}

export function IconSpinner({ size = 16, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={['animate-spin', className].filter(Boolean).join(' ')}
      aria-hidden
      {...rest}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.4" />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Maps a bot id to its glyph. */
export const BOT_ICONS: Record<BotId, ComponentType<IconProps>> = {
  shanks: IconShield,
  sanji: IconScroll,
  zoro: IconLock,
  boahancock: IconWave,
  nami: IconChart,
  luffy: IconCards,
  'niko-robin': IconSearch,
  cyrene: IconSparkle,
};
