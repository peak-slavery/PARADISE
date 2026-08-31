'use client';

import { Reveal, RevealGroup, RevealItem } from '@/components/motion/Reveal';
import { SectionHeading } from '@/components/ui/Panel';

const STORES = [
  {
    name: 'Supabase',
    role: 'Source of truth',
    detail: 'Postgres with Row Level Security. Low write volume, relational, and the only place identity lives.',
    tables: ['users', 'servers', 'bot_configs', 'mod_actions', 'security_events', 'antinuke_whitelist'],
    color: '#3ECF8E',
  },
  {
    name: 'MongoDB Atlas',
    role: 'Activity firehose',
    detail: 'High write volume, flexible schema. Every log line, XP tick and card match lands here with a 60-day TTL.',
    tables: ['logs', 'xp', 'card_games', 'inventories', 'ai_context'],
    color: '#00ED64',
  },
  {
    name: 'Upstash Redis',
    role: 'Hot path',
    detail: 'Sub-millisecond counters and caches with TTL auto-expiry: rate limits, antinuke windows, search results.',
    tables: ['rate-limits', 'antinuke counters', 'search cache', 'ai cache'],
    color: '#DC2626',
  },
] as const;

export function ArchitectureSection() {
  return (
    <section id="architecture" className="relative px-4 py-20 sm:px-6 sm:py-28">
      <Reveal>
        <SectionHeading
          eyebrow="Data split"
          title="Two databases, one deliberate line"
          lede="Both free tiers cap at roughly 500MB. Keeping low-write config data out of the high-write activity store is the only reason either stays under the ceiling."
        />
      </Reveal>

      <RevealGroup
        step={0.09}
        className="mx-auto mt-14 grid max-w-6xl gap-5 lg:grid-cols-3"
      >
        {STORES.map((store) => (
          <RevealItem key={store.name} className="h-full">
            <div className="relative h-full overflow-hidden rounded-3xl glass glass-sheen p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full blur-3xl"
                style={{ background: `radial-gradient(closest-side, ${store.color}40, transparent)` }}
              />
              <div className="relative flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold tracking-tight text-ink">{store.name}</h3>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-white/80">
                  {store.role}
                </span>
              </div>
              <p className="relative mt-3 text-sm leading-relaxed text-ink-soft">{store.detail}</p>

              <ul className="relative mt-5 flex flex-wrap gap-1.5">
                {store.tables.map((table) => (
                  <li
                    key={table}
                    className="rounded-lg bg-white/65 px-2 py-1 font-mono text-[11px] text-ink-soft ring-1 ring-white/80"
                  >
                    {table}
                  </li>
                ))}
              </ul>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal delay={0.12} className="mx-auto mt-8 max-w-4xl">
        <div className="rounded-3xl neu-raised p-6 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            The rule
          </p>
          <p className="mt-3 text-pretty text-lg font-medium leading-relaxed text-ink">
            If a row is written more than once a minute per guild, it goes to
            Mongo. If a dashboard user can own it, it goes to Supabase behind
            RLS. If it expires on its own, it goes to Redis.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
