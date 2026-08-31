'use client';

import { motion } from 'framer-motion';

import { Reveal, RevealGroup, RevealItem } from '@/components/motion/Reveal';
import { SectionHeading } from '@/components/ui/Panel';
import { IconActivity, IconClock, IconLayers, IconLock, IconSearch, IconSparkle } from '@/components/ui/icons';

const FEATURES = [
  {
    icon: IconLayers,
    title: 'Isolated by construction',
    body: 'Each bot is its own process, its own Discord application, its own Render account. A crash in card game never touches moderation.',
    tint: 'from-bot-logging/20 to-transparent',
  },
  {
    icon: IconClock,
    title: 'Bounded, always',
    body: 'Logs expire on a 60-day TTL. Mod actions archive at 90. Writes batch on a 30s flush instead of hitting the store per event.',
    tint: 'from-bot-search/20 to-transparent',
  },
  {
    icon: IconLock,
    title: 'RLS, not middleware',
    body: 'Row Level Security is the authorization boundary. A signed-in owner physically cannot read another guild’s rows, even by guessing an ID.',
    tint: 'from-bot-antinuke/20 to-transparent',
  },
  {
    icon: IconActivity,
    title: 'Live activity, no sockets',
    body: 'The log stream polls on a 10–15s interval with a `since` cursor. Serverless connection counts stay flat no matter how many guilds are open.',
    tint: 'from-bot-levelup/20 to-transparent',
  },
  {
    icon: IconSearch,
    title: 'Degrades, never dies',
    body: 'No Redis means in-process rate limiting. No Mongo means logging is off. No upstream provider means a graceful embed instead of a hang.',
    tint: 'from-bot-welcome/25 to-transparent',
  },
  {
    icon: IconSparkle,
    title: 'GPT-free reliability',
    body: 'AI and search run through a queue with a hard timeout, so a slow model can never block the Discord gateway event loop.',
    tint: 'from-bot-ai/20 to-transparent',
  },
] as const;

export function FeatureGrid() {
  return (
    <section id="features" className="relative px-4 py-20 sm:px-6 sm:py-28">
      <Reveal>
        <SectionHeading
          eyebrow="Why it holds up"
          title="Built for free tiers that are allowed to fall over"
          lede="Every reliability rule in the codebase exists because something on a free tier will eventually hit its ceiling. Here is what happens when it does."
        />
      </Reveal>

      <RevealGroup
        step={0.08}
        className="mx-auto mt-14 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <RevealItem key={feature.title} className="h-full">
              <motion.article
                whileHover={{ y: -6 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="group relative h-full overflow-hidden rounded-3xl glass glass-sheen p-6"
              >
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br ${feature.tint} blur-2xl`}
                />
                <span
                  className="relative grid h-11 w-11 place-items-center rounded-2xl text-accent-ink"
                  style={{
                    background: 'var(--pe-surface-raised)',
                    boxShadow: 'var(--neu-shadow-sm)',
                  }}
                >
                  <Icon size={20} />
                </span>
                <h3 className="relative mt-5 text-base font-semibold tracking-tight text-ink">
                  {feature.title}
                </h3>
                <p className="relative mt-2.5 text-sm leading-relaxed text-ink-soft">
                  {feature.body}
                </p>
              </motion.article>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}
