'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

import type { ServerRow, UserRow } from '@/lib/types';
import { initials } from '@/lib/format';
import {
  IconActivity,
  IconChevronRight,
  IconLayers,
  IconLock,
  IconShield,
  IconSpinner,
} from '@/components/ui/icons';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Dashboard chrome: a glass navigation rail on desktop, a slide-over sheet on
 * mobile. Content panels behind it are neumorphic, so the mix reads as glass
 * navigation on top of soft-extruded surfaces.
 */
export function DashboardShell({
  profile,
  servers,
  demo,
  children,
}: {
  profile: UserRow | null;
  servers: ServerRow[];
  demo: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Close the mobile sheet whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const activeGuildId = (() => {
    const match = /^\/dashboard\/(\d+)/.exec(pathname ?? '');
    return match?.[1] ?? null;
  })();

  return (
    <div className="min-h-screen bg-base">
      {/* Ambient wash — keeps the light surface from reading as flat grey. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-mesh opacity-70" />

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 border-b border-ink/5 bg-base/85 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight text-ink">
              Ei<span className="text-accent-ink">Point</span>
            </span>
          </Link>
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-2xl neu-press text-ink"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M4 8h16M4 16h16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px]">
        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 p-4 lg:block">
          <div className="flex h-full flex-col rounded-3xl glass glass-sheen p-4">
            <NavContent
              profile={profile}
              servers={servers}
              demo={demo}
              activeGuildId={activeGuildId}
              pathname={pathname}
              signingOut={signingOut}
              setSigningOut={setSigningOut}
            />
          </div>
        </aside>

        {/* Mobile sheet */}
        <AnimatePresence>
          {mobileOpen ? (
            <motion.div
              className="fixed inset-0 z-50 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.28, ease: EASE }}
                className="relative flex h-full w-[300px] max-w-[86vw] flex-col p-3"
              >
                <div className="flex h-full flex-col overflow-y-auto rounded-3xl glass-strong p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2">
                      <BrandMark />
                      <span className="text-sm font-semibold tracking-tight text-ink">
                        Ei<span className="text-accent-ink">Point</span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      aria-label="Close navigation"
                      onClick={() => setMobileOpen(false)}
                      className="grid h-9 w-9 place-items-center rounded-xl neu-press text-ink"
                    >
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <NavContent
                    profile={profile}
                    servers={servers}
                    demo={demo}
                    activeGuildId={activeGuildId}
                    pathname={pathname}
                    signingOut={signingOut}
                    setSigningOut={setSigningOut}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <main className="min-w-0 flex-1 px-4 pb-16 pt-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavContent({
  profile,
  servers,
  demo,
  activeGuildId,
  pathname,
  signingOut,
  setSigningOut,
  onNavigate,
}: {
  profile: UserRow | null;
  servers: ServerRow[];
  demo: boolean;
  activeGuildId: string | null;
  pathname: string | null;
  signingOut: boolean;
  setSigningOut: (next: boolean) => void;
  onNavigate?: () => void;
}) {
  const overviewActive = pathname === '/dashboard';

  return (
    <>
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mb-4 hidden items-center gap-2.5 rounded-2xl px-1 py-1 lg:flex"
      >
        <BrandMark />
        <span className="text-sm font-semibold tracking-tight text-ink">
          Ei<span className="text-accent-ink">Point</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-1">
        <NavLink
          href="/dashboard"
          active={overviewActive}
          onNavigate={onNavigate}
          icon={<IconLayers size={17} />}
          label="Your servers"
          badge={servers.length > 0 ? String(servers.length) : undefined}
        />

        <p className="mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Servers
        </p>

        {servers.length === 0 ? (
          <p className="mt-2 rounded-2xl neu-inset px-3 py-3 text-xs leading-relaxed text-ink-muted">
            No authorized servers yet. Add Ei Point to a Discord guild
            you own and it will appear here.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1">
            {servers.map((server) => {
              const isActive = activeGuildId === server.guild_id;
              const base = `/dashboard/${server.guild_id}`;
              return (
                <div key={server.id}>
                  <NavLink
                    href={base}
                    active={isActive}
                    onNavigate={onNavigate}
                    label={server.name ?? `Guild ${server.guild_id}`}
                    icon={
                      <span
                        className="grid h-full w-full place-items-center rounded-lg text-[10px] font-bold text-white"
                        style={{ background: 'linear-gradient(140deg, #6b76f5, #00d4aa)' }}
                      >
                        {initials(server.name ?? 'PE')}
                      </span>
                    }
                    trailing={server.authorized ? undefined : 'locked'}
                  />

                  {isActive ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      transition={{ duration: 0.24, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <div className="ml-[18px] mt-1 flex flex-col gap-0.5 border-l border-ink/10 pl-3">
                        <SubLink
                          href={base}
                          active={pathname === base}
                          onNavigate={onNavigate}
                          icon={<IconLayers size={15} />}
                          label="Bot config"
                        />
                        <SubLink
                          href={`${base}/logs`}
                          active={pathname === `${base}/logs`}
                          onNavigate={onNavigate}
                          icon={<IconActivity size={15} />}
                          label="Activity"
                        />
                        <SubLink
                          href={`${base}/security`}
                          active={pathname === `${base}/security`}
                          onNavigate={onNavigate}
                          icon={<IconShield size={15} />}
                          label="Security"
                        />
                        <SubLink
                          href={`${base}/setup`}
                          active={pathname === `${base}/setup`}
                          onNavigate={onNavigate}
                          icon={<IconLock size={15} />}
                          label="Setup"
                        />
                      </div>
                    </motion.div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      <div className="mt-auto pt-5">
        {demo ? (
          <div className="mb-3 rounded-2xl neu-inset p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Demo data
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              Supabase and MongoDB are unconfigured. Fixtures are being served
              and saves are session-only.
            </p>
          </div>
        ) : null}

        <div className="rounded-2xl bg-white/55 p-3 ring-1 ring-white/70">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold text-white"
              style={{ background: 'linear-gradient(140deg, #5865f2, #9b59b6)' }}
            >
              {initials(profile?.username ?? 'PE')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {profile?.username ?? 'Demo operator'}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {profile?.is_owner ? 'Owner' : 'Member'}
              </p>
            </div>
          </div>

          <form action="/auth/signout" method="post" onSubmit={() => setSigningOut(true)}>
            <button
              type="submit"
              disabled={signingOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-60"
            >
              {signingOut ? <IconSpinner size={14} /> : null}
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

function NavLink({
  href,
  active,
  label,
  icon,
  badge,
  trailing,
  onNavigate,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  trailing?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={[
        'group relative flex items-center gap-2.5 rounded-2xl px-2.5 py-2 text-sm font-medium transition-colors',
        active ? 'text-accent-ink' : 'text-ink-soft hover:text-ink',
      ].join(' ')}
    >
      {active ? (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-2xl bg-base"
          style={{ boxShadow: 'var(--neu-shadow-sm)' }}
          transition={{ type: 'spring', stiffness: 480, damping: 36 }}
        />
      ) : null}
      <span className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden">
        {icon}
      </span>
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="relative rounded-md bg-bot-antinuke/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#9c5a12]">
          {trailing}
        </span>
      ) : null}
      {badge ? (
        <span className="relative rounded-full bg-base-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function SubLink({
  href,
  active,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active ? 'bg-white/75 text-accent-ink shadow-sm' : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {icon}
      {label}
      {active ? <IconChevronRight size={13} className="ml-auto opacity-60" /> : null}
    </Link>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white"
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
  );
}
