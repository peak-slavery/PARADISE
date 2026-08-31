'use client';

import Link from 'next/link';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useEffect, useState } from 'react';

import { IconDiscord } from '@/components/ui/icons';

const NAV = [
  { href: '#bots', label: 'Bots' },
  { href: '#features', label: 'Features' },
  { href: '#architecture', label: 'Architecture' },
] as const;

/**
 * Sticky marketing nav. Transparent over the hero, then condenses into a
 * frosted glass bar once the user scrolls past ~32px.
 */
export function SiteHeader() {
  const { scrollY } = useScroll();
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setCondensed(latest > 32);
  });

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <motion.div
        initial={false}
        animate={{
          paddingTop: condensed ? 10 : 18,
          paddingBottom: condensed ? 10 : 18,
        }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="px-4 sm:px-6"
      >
        <div
          className={[
            'mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-3xl px-4 py-2.5 transition-all duration-300 sm:px-5',
            condensed ? 'glass-strong glass-sheen' : 'border border-transparent',
          ].join(' ')}
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-xl px-1 py-1 text-sm font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-xl text-white"
              style={{
                background: 'linear-gradient(140deg, #6b76f5 0%, #00d4aa 100%)',
                boxShadow: '4px 4px 10px rgba(88,101,242,0.35), -3px -3px 8px rgba(255,255,255,0.9)',
              }}
            >
              <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3.2l7.4 4v9.6l-7.4 4-7.4-4V7.2l7.4-4z" />
                <path d="M12 12.2l7.4-4" />
                <path d="M12 12.2v8.6" />
                <path d="M12 12.2L4.6 7.2" />
              </svg>
            </span>
            Ei<span className="text-accent-ink">Point</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-xl px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-white/70 hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Link
              href="/login"
              className="rounded-2xl px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="btn-neu-primary px-4 py-2"
            >
              Open dashboard
            </Link>
          </div>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-2xl neu-press text-ink md:hidden"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="mx-4 mt-1 rounded-3xl glass-strong p-4 md:hidden"
          >
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-white/70 hover:text-ink"
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-ink/5 pt-3">
              <Link href="/login" className="btn-neu" onClick={() => setMenuOpen(false)}>
                <IconDiscord size={17} />
                Sign in with Discord
              </Link>
              <Link href="/dashboard" className="btn-neu-primary" onClick={() => setMenuOpen(false)}>
                Open dashboard
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
