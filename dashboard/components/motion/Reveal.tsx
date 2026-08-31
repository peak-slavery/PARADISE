'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Soft-out easing shared by every transition in the app. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Scroll-reveal wrapper. Honours `prefers-reduced-motion` by rendering the
 * final state immediately instead of animating.
 */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  duration = 0.6,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  duration?: number;
  className?: string;
  once?: boolean;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-72px' }}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Staggers a list of children by index. */
export function RevealGroup({
  children,
  className,
  step = 0.07,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  y?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-72px' }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduced ? 0 : step } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduced ? 0 : y },
        shown: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Fades content in on mount — used for page-level transitions. */
export function FadeIn({
  children,
  className,
  duration = 0.35,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
