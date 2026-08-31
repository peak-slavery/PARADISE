import Link from 'next/link';

import { BOTS } from '@/lib/bots';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/#features' },
      { label: 'The bots', href: '/#bots' },
      { label: 'Architecture', href: '/#architecture' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', href: '/login' },
      { label: 'Your servers', href: '/dashboard' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-ink/5 px-4 pb-10 pt-14 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <p className="text-sm font-semibold tracking-tight text-ink">
            Ei<span className="text-accent-ink">Point</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
            Eight isolated Discord bots behind a single control plane, running
            entirely on free tiers.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {column.title}
            </p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="rounded text-sm text-ink-soft transition-colors hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Bots
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
            {BOTS.map((bot) => (
              <li key={bot.id} className="flex items-center gap-1.5 text-sm text-ink-soft">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: bot.color }}
                />
                {bot.name}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col gap-2 border-t border-ink/5 pt-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Ei Point. Not affiliated with Discord Inc.</p>
        <p>Postgres · MongoDB · Redis — all on free tiers.</p>
      </div>
    </footer>
  );
}
