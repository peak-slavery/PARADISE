'use client';

import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { BOTS } from '@/lib/bots';
import { BOT_ICONS, IconArrowRight, IconDiscord } from '@/components/ui/icons';

const STATS = [
  { value: '8', label: 'independent bots' },
  { value: '3', label: 'datastores, split by write volume' },
  { value: '0', label: 'shared failure domains' },
] as const;

/**
 * Parallax hero.
 *
 * Four layers move at different rates against `useScroll` progress: the mesh
 * backdrop barely moves, the grid drifts, the copy lifts and fades, and the
 * floating control-plane mock travels furthest. `useReducedMotion` collapses
 * every transform to zero so the layout is identical, just static.
 */
export function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  // Hooks must run unconditionally; `reduced` only scales the output.
  const meshY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 90]);
  const gridY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 160]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 240]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.75], [1, reduced ? 1 : 0]);
  const copyScale = useTransform(scrollYProgress, [0, 1], [1, reduced ? 1 : 0.94]);
  const panelY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -70]);
  const orbAY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -150]);
  const orbBY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 120]);

  return (
    <section
      ref={containerRef}
      className="relative isolate overflow-hidden px-4 pb-24 pt-32 sm:px-6 sm:pt-40"
    >
      {/* Layer 0 — mesh gradient */}
      <motion.div
        aria-hidden
        style={{ y: meshY }}
        className="pointer-events-none absolute inset-0 -z-10 bg-mesh"
      />

      {/* Layer 1 — grid veil, masked so it fades out toward the fold */}
      <motion.div
        aria-hidden
        style={{ y: gridY }}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px] grid-veil mask-fade-b opacity-70"
      />

      {/* Layer 2 — parallax orbs */}
      <motion.div
        aria-hidden
        style={{ y: orbAY }}
        className="pointer-events-none absolute -left-24 top-10 -z-10 h-72 w-72 rounded-full blur-3xl"
      >
        <div className="h-full w-full rounded-full bg-bot-logging/20" />
      </motion.div>
      <motion.div
        aria-hidden
        style={{ y: orbBY }}
        className="pointer-events-none absolute -right-20 top-52 -z-10 h-80 w-80 rounded-full blur-3xl"
      >
        <div className="h-full w-full rounded-full bg-bot-search/20" />
      </motion.div>

      {/* Layer 3 — copy */}
      <motion.div
        style={{ y: copyY, opacity: copyOpacity, scale: copyScale }}
        className="mx-auto max-w-4xl text-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full glass px-3.5 py-1.5 text-xs font-semibold text-accent-ink">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="absolute h-2 w-2 rounded-full bg-bot-levelup/60 animate-pulse-ring" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-levelup" />
          </span>
          Eight bots · one control plane · free tiers only
        </span>

        <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-6xl lg:text-7xl">
          Run a whole Discord{' '}
          <span className="text-gradient-brand">bot fleet</span> from one calm
          control plane.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-soft sm:text-lg">
          Ei Point splits eight independent bots across their own
          processes, their own accounts and their own deploy pipelines — then
          gives you a single place to configure every one of them. Config lives
          in Postgres. Activity lives in Mongo. Nothing shares a failure domain.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login" className="btn-neu-primary w-full px-6 py-3 text-base sm:w-auto">
            <IconDiscord size={18} />
            Sign in with Discord
          </Link>
          <Link href="#bots" className="btn-neu w-full px-6 py-3 text-base sm:w-auto">
            Meet the bots
            <IconArrowRight size={18} />
          </Link>
        </div>

        <p className="mt-4 text-xs text-ink-faint">
          No invite required to look around — the dashboard boots with demo data.
        </p>
      </motion.div>

      {/* Layer 4 — floating control-plane mock (travels fastest, opposite way) */}
      <motion.div style={{ y: panelY }} className="mx-auto mt-16 max-w-5xl">
        <div className="relative">
          <div className="absolute -inset-x-8 -bottom-8 -top-6 -z-10 rounded-[2.5rem] bg-gradient-to-b from-white/60 to-transparent blur-2xl" />
          <div className="glass-strong glass-sheen overflow-hidden rounded-[2rem] p-2">
            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="h-2.5 w-2.5 rounded-full bg-bot-moderation/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-bot-cardgame/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-bot-levelup/80" />
              <span className="ml-3 rounded-lg bg-white/70 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                eipoint.app/dashboard/849213847293847021
              </span>
            </div>

            <div className="mt-2 grid gap-2 p-2 sm:grid-cols-[168px_1fr]">
              {/* Bot rail */}
              <div className="rounded-2xl bg-white/55 p-2 ring-1 ring-white/70">
                {BOTS.map((bot, index) => {
                  const Icon = BOT_ICONS[bot.id];
                  return (
                    <div
                      key={bot.id}
                      className={[
                        'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium',
                        index === 0
                          ? 'bg-white text-ink shadow-[0_2px_10px_-4px_rgba(31,41,61,0.25)]'
                          : 'text-ink-muted',
                      ].join(' ')}
                    >
                      <span
                        aria-hidden
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
                        style={{ background: bot.color }}
                      >
                        <Icon size={14} />
                      </span>
                      {bot.name}
                    </div>
                  );
                })}
              </div>

              {/* Config surface */}
              <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-white/80">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      Moderation
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">Ei Point Gardens</p>
                  </div>
                  <span className="rounded-full bg-bot-levelup/25 px-2.5 py-1 text-[11px] font-semibold text-[#1d7a3c]">
                    Saved
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    { label: 'Log channel', value: '#mod-log', type: 'field' },
                    { label: 'Mute role', value: 'Muted', type: 'field' },
                    { label: 'Warn threshold', value: '3 warns', type: 'field' },
                    { label: 'Default mute', value: '120 min', type: 'field' },
                    { label: 'Require a reason', value: true, type: 'toggle' },
                    { label: 'DM the target', value: true, type: 'toggle' },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between gap-3 rounded-xl bg-base-sunken px-3 py-2.5"
                      style={{ boxShadow: 'var(--neu-shadow-inset-sm)' }}
                    >
                      <span className="text-xs font-medium text-ink-soft">{row.label}</span>
                      {row.type === 'toggle' ? (
                        <span className="flex h-5 w-9 items-center rounded-full bg-gradient-to-br from-[#6b76f5] to-[#4a56e0] p-0.5">
                          <span className="ml-auto h-4 w-4 rounded-full bg-white shadow" />
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-ink">{row.value as string}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map((stat) => (
          <div key={stat.label} className="rounded-3xl glass-quiet px-5 py-4 text-center">
            <dt className="sr-only">{stat.label}</dt>
            <dd>
              <span className="block text-2xl font-semibold tracking-tight text-ink">
                {stat.value}
              </span>
              <span className="mt-1 block text-xs leading-snug text-ink-muted">{stat.label}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
