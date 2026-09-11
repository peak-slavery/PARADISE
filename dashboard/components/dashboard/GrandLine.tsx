'use client';

import Link from 'next/link';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';

export function GrandLine({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(x, { stiffness: 90, damping: 22 });
  const rotateY = useSpring(y, { stiffness: 90, damping: 22 });
  return (
    <section className={`grand-line ${compact ? 'grand-line-compact' : ''}`} aria-label="Grand Line command deck">
      <div className="grand-line-copy">
        <p className="voyage-label">Paradise Engine / Grand Line operations</p>
        {compact ? <h2>Your crew.<br /><em>Your course.</em></h2> : <h1>A great crew.<br />An open sea.<br /><em>You at the helm.</em></h1>}
        <p className="voyage-description">Eight specialists. One command deck. Keep your Discord waters safe, your crew connected, and the next adventure in sight.</p>
        <div className="flex flex-wrap items-center gap-4 pt-6">
          <Link href={compact ? '#servers' : '/login'} className="btn-neu-primary">{compact ? 'Choose your server' : 'Take the helm'} <span aria-hidden>&rarr;</span></Link>
          {!compact ? <Link href="#bots" className="voyage-text-link">Meet the crew</Link> : <span className="voyage-label">Authorized waters only</span>}
        </div>
      </div>
      <div className="log-pose-scene" onPointerMove={(event) => {
        if (reduced || event.pointerType !== 'mouse') return;
        const rect = event.currentTarget.getBoundingClientRect();
        x.set((0.5 - (event.clientY - rect.top) / rect.height) * 14);
        y.set(((event.clientX - rect.left) / rect.width - 0.5) * 18);
      }} onPointerLeave={() => { x.set(0); y.set(0); }} aria-hidden="true">
        <span className="chart-coordinate chart-coordinate-top">N 22&deg; 14&apos; / EAST BLUE</span>
        <div className="chart-orbit chart-orbit-outer" />
        <div className="chart-orbit chart-orbit-inner" />
        <motion.div className="log-pose" style={{ rotateX, rotateY }}>
          <div className="pose-ring pose-ring-one" />
          <div className="pose-ring pose-ring-two" />
          <div className="pose-globe">
            <div className="pose-meridian" />
            <div className="pose-equator" />
            <div className="pose-needle" />
            <div className="pose-center" />
            <span className="pose-north">N</span>
          </div>
          <div className="pose-base" />
          <div className="pose-shadow" />
        </motion.div>
        <svg className="voyage-ship" viewBox="0 0 240 220" fill="none">
          <path d="M32 162Q110 176 212 149L185 190Q116 215 54 192Z" fill="#713d2d" stroke="#cdad70" strokeWidth="3" />
          <path d="M118 26V171M176 79V168" stroke="#614730" strokeWidth="5" />
          <path d="M113 38Q49 65 51 138Q82 129 113 141Z" fill="#f3e6c7" stroke="#c7a96a" strokeWidth="2" />
          <path d="M126 43Q174 71 164 135L126 140Z" fill="#eddfba" stroke="#c7a96a" strokeWidth="2" />
          <path d="M181 89Q222 103 212 143L181 148Z" fill="#eee0bf" />
          <path d="M119 25L149 33L119 42Z" fill="#972f32" />
          <circle cx="88" cy="95" r="13" fill="#493c30" />
          <ellipse cx="88" cy="88" rx="20" ry="4" fill="#d1a849" />
          <path d="M77 87Q78 68 98 87" fill="#d1a849" />
          <circle cx="83" cy="95" r="3" fill="#f3e6c7" /><circle cx="93" cy="95" r="3" fill="#f3e6c7" />
          <path d="M73 113L105 122M104 113L73 123" stroke="#493c30" strokeWidth="4" />
          <circle cx="74" cy="181" r="5" fill="#d1a849" /><circle cx="102" cy="184" r="5" fill="#d1a849" /><circle cx="130" cy="184" r="5" fill="#d1a849" /><circle cx="158" cy="179" r="5" fill="#d1a849" />
          <path d="M12 206Q50 193 88 206T170 206T235 206" stroke="#65948e" strokeWidth="2" />
        </svg>
        <span className="chart-coordinate chart-coordinate-bottom">LOG POSE / FOLLOW YOUR OWN NORTH</span>
      </div>
      <div className="voyage-manifest"><span>01 / MODERATION &amp; DEFENSE</span><span>02 / COMMUNITY &amp; PLAY</span><span>03 / SEARCH &amp; AI</span></div>
    </section>
  );
}
