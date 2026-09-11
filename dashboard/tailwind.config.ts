import type { Config } from 'tailwindcss';

const token = (name: string) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

/**
 * Light-first design system for Ei Point (the Ei Flow bot network).
 *
 * Marketing surfaces -> glassmorphism (translucent + blurred).
 * Control surfaces   -> neumorphism (soft extruded, dual light/dark shadow).
 *
 * The shadow / glass primitives themselves live in `app/globals.css` under
 * `@layer utilities`; this file only carries the tokens they are built from
 * plus the brand palette for the eight bots.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Neomorphic base: a very slightly warm, very light grey. Both the
        // light and dark halves of every extruded shadow derive from it.
        base: {
          DEFAULT: token('--pe-bg'),
          raised: token('--pe-surface-raised'),
          sunken: token('--pe-surface-sunken'),
          line: token('--pe-line'),
        },
        ink: {
          DEFAULT: token('--pe-ink'),
          soft: token('--pe-ink-soft'),
          muted: token('--pe-ink-muted'),
          faint: token('--pe-ink-faint'),
        },
        accent: {
          DEFAULT: token('--pe-accent'),
          soft: token('--pe-accent-soft'),
          ink: token('--pe-accent-ink'),
        },
        // Bot brand colours
        bot: {
          moderation: '#ED4245',
          logging: '#5865F2',
          antinuke: '#E67E22',
          welcome: '#FF7EB6',
          levelup: '#57F287',
          cardgame: '#FEE75C',
          search: '#00D4AA',
          ai: '#9B59B6',
        },
        severity: {
          low: '#3BA55D',
          medium: '#FAA81A',
          high: '#E67E22',
          critical: '#ED4245',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        // Soft-extruded neumorphic surfaces (light theme: highlight top-left,
        // shadow bottom-right).
        neu: 'var(--neu-shadow)',
        'neu-sm': 'var(--neu-shadow-sm)',
        'neu-lg': 'var(--neu-shadow-lg)',
        'neu-inset': 'var(--neu-shadow-inset)',
        'neu-inset-sm': 'var(--neu-shadow-inset-sm)',
        // Glass panels: hairline border + long ambient drop.
        glass: 'var(--glass-shadow)',
        'glass-lg': 'var(--glass-shadow-lg)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-ring': {
          '0%': { opacity: '0.55', transform: 'scale(0.9)' },
          '100%': { opacity: '0', transform: 'scale(1.6)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 7s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
