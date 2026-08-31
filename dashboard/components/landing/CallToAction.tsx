'use client';

import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { Reveal } from '@/components/motion/Reveal';
import { IconArrowRight, IconDiscord } from '@/components/ui/icons';

/** Closing CTA. The panel scales up slightly as it scrolls into view. */
export function CallToAction() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end center'],
  });

  const scale = useTransform(scrollYProgress, [0, 1], [reduced ? 1 : 0.97, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [reduced ? 0 : 26, 0]);

  return (
    <section className="px-4 pb-24 pt-8 sm:px-6">
      <div ref={ref}>
        <motion.div
          style={{ scale, y }}
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2.25rem] glass-strong glass-sheen px-6 py-14 text-center sm:px-12 sm:py-20"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-mesh opacity-80"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-bot-ai/20 blur-3xl"
          />

          <Reveal>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
              Stop babysitting eight config files.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-ink-soft">
              Connect a Discord account, pick a server, and every bot is one tab
              away. Or browse the demo first — no credentials required.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="btn-neu-primary w-full px-6 py-3 text-base sm:w-auto">
                <IconDiscord size={18} />
                Sign in with Discord
              </Link>
              <Link href="/dashboard" className="btn-neu w-full px-6 py-3 text-base sm:w-auto">
                Open the demo dashboard
                <IconArrowRight size={18} />
              </Link>
            </div>
            <p className="mt-5 text-xs text-ink-faint">
              Free tier friendly — the whole stack runs on $0.
            </p>
          </Reveal>
        </motion.div>
      </div>
    </section>
  );
}
