'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { BOT_ICONS, IconAlert, IconDiscord, IconSpinner } from '@/components/ui/icons';
import { BOTS } from '@/lib/bots';

type Phase = 'idle' | 'redirecting' | 'error';

export function SignInPanel({
  configured,
  next,
  initialError,
}: {
  configured: boolean;
  next: string;
  initialError?: string;
}) {
  const [phase, setPhase] = useState<Phase>(initialError ? 'error' : 'idle');
  const [message, setMessage] = useState<string | null>(
    initialError ? friendlyError(initialError) : null,
  );

  async function signInWithDiscord() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPhase('error');
      setMessage('Supabase is not configured. Use the demo dashboard below.');
      return;
    }

    setPhase('redirecting');
    setMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        scopes: 'identify email guilds',
      },
      });

      if (error) {
        setPhase('error');
        setMessage('Discord sign-in could not start. Check that Discord is enabled in Supabase Authentication and the callback URL is allowed.');
      }
    } catch {
      setPhase('error');
      setMessage('The authentication service could not be reached. Please try again.');
    }
    // On success the browser navigates away; nothing else to do.
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-mesh opacity-90 blur-xl"
      />

      <div className="relative overflow-hidden rounded-[2rem] glass-strong glass-sheen p-8">
        <span
          className="grid h-12 w-12 place-items-center rounded-2xl text-white"
          style={{
            background: 'linear-gradient(140deg, #5865f2 0%, #404eed 100%)',
            boxShadow: '6px 6px 14px rgba(88,101,242,0.4), -4px -4px 10px rgba(255,255,255,0.9)',
          }}
        >
          <IconDiscord size={24} />
        </span>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">
          Welcome aboard.
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
          Sign in with Discord to reach your command deck. Access is limited to
          authorized servers linked to your account.
        </p>

        <button
          type="button"
          onClick={signInWithDiscord}
          disabled={!configured || phase === 'redirecting'}
          aria-busy={phase === 'redirecting'}
          className="btn-neu-primary mt-7 w-full px-5 py-3 text-base disabled:cursor-wait disabled:opacity-80"
        >
          {phase === 'redirecting' ? (
            <>
              <IconSpinner size={17} />
              Redirecting to Discord…
            </>
          ) : (
            <>
              <IconDiscord size={18} />
              Continue with Discord
            </>
          )}
        </button>

        {message ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-2xl bg-bot-moderation/10 px-4 py-3 text-sm text-[#8f1f22] ring-1 ring-bot-moderation/25"
          >
            <IconAlert size={17} className="mt-0.5 shrink-0" />
            <span>{message}</span>
          </motion.p>
        ) : null}

        {!configured ? (
          <div className="mt-5 rounded-2xl neu-inset p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Demo mode
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              No Supabase credentials are set, so Discord OAuth is unavailable.
              Every dashboard page renders against in-repo fixtures instead.
            </p>
            <Link href="/dashboard" className="btn-neu mt-4 w-full px-4 py-2.5">
              Browse the demo dashboard
            </Link>
          </div>
        ) : null}

        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          By signing in you’ll see every authorized Ei Point guild where you
          are verified as the owner or an administrator.
        </p>
      </div>

      {/* The eight bots, as a quiet reassurance strip. */}
      <div className="mt-5 flex items-center justify-center gap-2">
        {BOTS.map((bot) => {
          const Icon = BOT_ICONS[bot.id];
          return (
            <span
              key={bot.id}
              title={bot.name}
              className="grid h-8 w-8 place-items-center rounded-xl text-white opacity-70 transition-opacity hover:opacity-100"
              style={{ background: bot.color }}
            >
              <Icon size={15} />
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

function friendlyError(raw: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  switch (decoded) {
    case 'missing_code':
      return 'Discord did not return an authorization code. Try again.';
    case 'not_configured':
      return 'Supabase is not configured, so sign-in is unavailable.';
    case 'exchange_failed':
      return 'Your sign-in session expired or could not be verified. Start again from this browser.';
    case 'access_denied':
      return 'Discord sign-in was cancelled. You can try again when ready.';
    default:
      return 'Discord sign-in failed. Please try again.';
  }
}
