import type { Metadata } from 'next';
import Link from 'next/link';

import { SignInPanel } from '@/components/auth/SignInPanel';
import { credentials } from '@/lib/demo';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the Ei Point control plane with Discord.',
};

// Session-dependent: never prerender.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const { supabase } = credentials();
  const sp = searchParams ? await searchParams : undefined;
  const rawNext = sp?.next;
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-20">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 grid-veil opacity-60" />

      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 rounded-xl px-2 py-1 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14.5 6.5L9 12l5.5 5.5" />
        </svg>
        Back to overview
      </Link>

      <SignInPanel
        configured={supabase}
        next={next}
        initialError={sp?.error}
      />
    </main>
  );
}
