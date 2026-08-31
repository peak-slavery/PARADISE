'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';

import { BOTS } from '@/lib/bots';
import type { BotId } from '@/lib/bot-meta';
import { BOT_ICONS } from '@/components/ui/icons';
import { DEFAULT_BOT_ID } from '@/lib/bots';

/**
 * The eight-bot tab strip.
 *
 * A `?tab=` query param (rather than a nested route) keeps the config screen a
 * single server component, so switching tabs doesn't remount the shell or lose
 * scroll position. Framer Motion's `layoutId` slides the active pill between
 * tabs; each pill is tinted with the bot's brand colour.
 */
export function BotTabs({ guildId, active }: { guildId: string; active: BotId }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="rounded-3xl glass glass-sheen p-2">
      <div
        role="tablist"
        aria-label="Bots"
        className="no-scrollbar flex gap-1 overflow-x-auto"
      >
        {BOTS.map((bot) => {
          const isActive = bot.id === active;
          const Icon = BOT_ICONS[bot.id];

          const params = new URLSearchParams(searchParams?.toString() ?? '');
          if (bot.id === DEFAULT_BOT_ID) {
            params.delete('tab');
          } else {
            params.set('tab', bot.id);
          }
          const query = params.toString();
          const href = `${pathname ?? `/dashboard/${guildId}`}${query ? `?${query}` : ''}`;

          return (
            <Link
              key={bot.id}
              href={href}
              role="tab"
              aria-selected={isActive}
              scroll={false}
              className={[
                'relative flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-colors duration-200',
                isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {isActive ? (
                <motion.span
                  layoutId="bot-tab-active"
                  className="absolute inset-0 rounded-2xl bg-base"
                  style={{
                    boxShadow: 'var(--neu-shadow-sm)',
                    borderTop: `2px solid ${bot.color}`,
                  }}
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                />
              ) : null}

              <span
                aria-hidden
                className="relative grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
                style={{
                  background: bot.color,
                  opacity: isActive ? 1 : 0.55,
                  boxShadow: isActive ? `2px 2px 6px ${bot.color}66` : 'none',
                }}
              >
                <Icon size={14} />
              </span>
              <span className="relative whitespace-nowrap">{bot.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
