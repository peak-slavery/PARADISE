'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { BOTS } from '@/lib/bots';
import { Reveal, RevealGroup, RevealItem } from '@/components/motion/Reveal';
import { SectionHeading } from '@/components/ui/Panel';
import { BOT_ICONS, IconChevronRight } from '@/components/ui/icons';

/**
 * The eight-bot roster. Each card carries its own brand colour as a tint,
 * border glow and icon chip, and the whole grid drifts upward slightly faster
 * than the page for a gentle parallax against the section it sits in.
 */
export function BotShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  const gridY = useTransform(scrollYProgress, [0, 1], [reduced ? 0 : 44, reduced ? 0 : -44]);
  const headingX = useTransform(scrollYProgress, [0, 1], [reduced ? 0 : -18, reduced ? 0 : 18]);

  return (
    <section
      ref={sectionRef}
      id="bots"
      className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-96 bg-mesh opacity-60"
      />

      <motion.div style={{ x: headingX }} className="mx-auto max-w-2xl">
        <Reveal>
          <SectionHeading
            eyebrow="The roster"
            title="Eight bots, eight failure domains"
            lede="One shared contract, zero shared processes. Configure each independently — a change to the card game economy never risks a moderation outage."
          />
        </Reveal>
      </motion.div>

      <motion.div style={{ y: gridY }}>
        <RevealGroup
          step={0.06}
          className="mx-auto mt-14 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {BOTS.map((bot) => {
            const Icon = BOT_ICONS[bot.id];
            return (
              <RevealItem key={bot.id} className="h-full">
                <motion.article
                  whileHover={{ y: -5 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                  className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-base p-5"
                  style={{ boxShadow: 'var(--neu-shadow)' }}
                >
                  {/* Brand wash */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 -top-20 h-40 rounded-full opacity-25 blur-3xl transition-opacity duration-300 group-hover:opacity-45"
                    style={{ background: `radial-gradient(closest-side, ${bot.color}, transparent)` }}
                  />

                  <div className="relative flex items-center gap-3">
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white"
                      style={{
                        background: bot.color,
                        boxShadow: `4px 4px 10px ${bot.color}55, -3px -3px 8px rgba(255,255,255,0.92)`,
                      }}
                    >
                      <Icon size={19} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold tracking-tight text-ink">
                        {bot.name}
                      </h3>
                      <p className="truncate text-xs text-ink-muted">{bot.tagline}</p>
                    </div>
                  </div>

                  <p className="relative mt-4 flex-1 text-[13px] leading-relaxed text-ink-soft">
                    {bot.description}
                  </p>

                  <div className="relative mt-4 flex flex-wrap gap-1.5 border-t border-ink/5 pt-3.5">
                    {bot.commands.slice(0, 3).map((command) => (
                      <span
                        key={command}
                        className="rounded-lg bg-base-sunken px-2 py-1 font-mono text-[10.5px] text-ink-muted"
                        style={{ boxShadow: 'var(--neu-shadow-inset-sm)' }}
                      >
                        {command}
                      </span>
                    ))}
                    {bot.commands.length > 3 ? (
                      <span className="rounded-lg px-1.5 py-1 text-[10.5px] font-semibold text-ink-faint">
                        +{bot.commands.length - 3}
                      </span>
                    ) : null}
                  </div>
                </motion.article>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </motion.div>

      <Reveal delay={0.1} className="mx-auto mt-10 max-w-2xl text-center">
        <a
          href="#architecture"
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:text-ink"
        >
          See how the data is split
          <IconChevronRight size={16} />
        </a>
      </Reveal>
    </section>
  );
}
