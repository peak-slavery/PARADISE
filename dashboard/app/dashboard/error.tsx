'use client';

import { motion } from 'framer-motion';
import { useEffect } from 'react';

import { IconAlert, IconRefresh } from '@/components/ui/icons';

/**
 * Route-level error boundary for the dashboard.
 *
 * A failed database call should degrade one panel, not white-screen the app —
 * this catches the render error and offers a retry that re-runs the server
 * component.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard] render error', error);
  }, [error]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-xl"
    >
      <div className="rounded-3xl glass-strong glass-sheen p-8 text-center">
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white"
          style={{
            background: 'linear-gradient(140deg, #f05659 0%, #d93a3d 100%)',
            boxShadow: '5px 5px 12px rgba(237,66,69,0.34), -3px -3px 8px rgba(255,255,255,0.9)',
          }}
        >
          <IconAlert size={22} />
        </span>

        <h2 className="mt-5 text-lg font-semibold tracking-tight text-ink">
          This panel couldn’t load
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
          A data store refused the request. It usually passes on retry — if it
          doesn’t, check that Supabase and MongoDB are reachable.
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-faint">digest {error.digest}</p>
        ) : null}

        <button type="button" onClick={reset} className="btn-neu-primary mt-6 px-5 py-2.5">
          <IconRefresh size={16} />
          Try again
        </button>
      </div>
    </motion.div>
  );
}
