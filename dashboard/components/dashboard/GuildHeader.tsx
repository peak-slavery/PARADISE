'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

import { Badge } from '@/components/ui/Badge';
import { IconActivity, IconLayers, IconShield } from '@/components/ui/icons';
import { initials } from '@/lib/format';
import type { ServerRow } from '@/lib/types';

const LINKS = [
  { suffix: '', label: 'Bot config', icon: IconLayers },
  { suffix: '/logs', label: 'Activity', icon: IconActivity },
  { suffix: '/security', label: 'Security', icon: IconShield },
] as const;

/** Server identity bar with the three top-level sections for a guild. */
export function GuildHeader({ server }: { server: ServerRow }) {
  const pathname = usePathname();
  const base = `/dashboard/${server.guild_id}`;

  return (
    <div className="mb-6">
      <div className="flex flex-col gap-5 rounded-3xl glass glass-sheen p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-base font-bold text-white"
            style={{
              background: 'linear-gradient(140deg, #6b76f5 0%, #00d4aa 100%)',
              boxShadow: '5px 5px 12px rgba(88,101,242,0.32), -4px -4px 10px rgba(255,255,255,0.92)',
            }}
          >
            {initials(server.name ?? 'PE')}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                {server.name ?? `Guild ${server.guild_id}`}
              </h1>
              {server.authorized ? (
                <Badge tone="success">Authorized</Badge>
              ) : (
                <Badge tone="danger">
                  Not authorized — bots will leave this guild
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-ink-faint">
              guild_id {server.guild_id}
              {server.owner_id ? ` · owner ${server.owner_id}` : ''}
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-1 rounded-2xl neu-inset-sm p-1">
          {LINKS.map((link) => {
            const href = `${base}${link.suffix}`;
            const isActive =
              link.suffix === ''
                ? pathname === base
                : (pathname ?? '').startsWith(href);
            const Icon = link.icon;

            return (
              <Link
                key={link.label}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors duration-200',
                  isActive ? 'text-accent-ink' : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {isActive ? (
                  <motion.span
                    layoutId="guild-section-active"
                    className="absolute inset-0 rounded-xl bg-base"
                    style={{ boxShadow: 'var(--neu-shadow-sm)' }}
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  />
                ) : null}
                <Icon size={16} className="relative" />
                <span className="relative whitespace-nowrap">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
