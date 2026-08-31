'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BOTS, getBot } from '@/lib/bots';
import type { BotId } from '@/lib/bot-meta';
import { LevelBadge } from '@/components/ui/Badge';
import { SegmentedControl } from '@/components/ui/Controls';
import { BOT_ICONS, IconActivity, IconRefresh, IconSpinner } from '@/components/ui/icons';
import { absoluteTime, relativeTime } from '@/lib/format';
import type { LogEntry, LogLevel, LogPage } from '@/lib/types';

/** Poll cadence. Slow enough to stay well inside free-tier request budgets. */
const POLL_INTERVAL_MS = 12_000;
/** Cap the in-memory buffer so a long-lived tab can't grow without bound. */
const MAX_ENTRIES = 200;

type LevelFilter = LogLevel | 'all';

const LEVEL_OPTIONS: readonly { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'critical', label: 'Critical' },
];

export function LogStream({ guildId, initialEntries }: { guildId: string; initialEntries: LogEntry[] }) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [botId, setBotId] = useState<BotId | 'all'>('all');
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string>(() => new Date().toISOString());

  const cursorRef = useRef<string | null>(initialEntries[0]?.created_at ?? null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (mode: 'poll' | 'replace') => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);

      try {
        const params = new URLSearchParams({ limit: '60' });
        if (level !== 'all') params.set('level', level);
        if (botId !== 'all') params.set('bot', botId);
        if (mode === 'poll' && cursorRef.current) params.set('since', cursorRef.current);

        const response = await fetch(`/api/logs/${guildId}?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);

        const page = (await response.json()) as LogPage & { error?: string };
        setError(page.error ?? null);
        setLastSync(new Date().toISOString());

        if (page.entries.length > 0) {
          cursorRef.current = page.entries[0]?.created_at ?? cursorRef.current;
          setEntries((current) => {
            if (mode === 'replace') return page.entries;
            // `since` is exclusive, so every returned row is genuinely new.
            const seen = new Set(current.map((entry) => entry.id));
            const fresh = page.entries.filter((entry) => !seen.has(entry.id));
            if (fresh.length === 0) return current;
            return [...fresh, ...current].slice(0, MAX_ENTRIES);
          });
        } else if (mode === 'replace') {
          setEntries([]);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not reach the log API');
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [botId, guildId, level],
  );

  // Re-query from scratch whenever a filter changes.
  useEffect(() => {
    cursorRef.current = null;
    void load('replace');
    // `load` is recreated when filters change, which is exactly when we want
    // to refetch; eslint's exhaustive-deps would otherwise loop on `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, botId]);

  // The polling loop. Deliberately a repeated timeout rather than an interval,
  // so a slow response can't stack requests on top of each other.
  useEffect(() => {
    if (!live) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (document.visibilityState === 'visible') {
        await load('poll');
      }
      if (!cancelled) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, load]);

  return (
    <section className="overflow-hidden rounded-3xl neu-raised">
      {/* Filter bar — glass, sitting on top of the neumorphic content panel. */}
      <div className="flex flex-col gap-4 border-b border-ink/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{
                background: 'linear-gradient(140deg, #00d4aa 0%, #0aa88a 100%)',
                boxShadow: '3px 3px 8px rgba(0,212,170,0.35), -2px -2px 6px rgba(255,255,255,0.9)',
              }}
            >
              <IconActivity size={17} />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink">Activity stream</h2>
              <p className="text-xs text-ink-muted">
                MongoDB <code className="font-mono">logs</code> · polls every {POLL_INTERVAL_MS / 1000}s
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-ink-faint sm:inline">
              synced {relativeTime(lastSync)}
            </span>
            <button
              type="button"
              onClick={() => setLive((value) => !value)}
              aria-pressed={live}
              className={[
                'inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold neu-press',
                live ? 'text-[#1d7a3c]' : 'text-ink-muted',
              ].join(' ')}
            >
              <span className="relative grid h-2 w-2 place-items-center">
                {live ? (
                  <span className="absolute h-2 w-2 rounded-full bg-bot-levelup/60 animate-pulse-ring" />
                ) : null}
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: live ? '#57F287' : '#9AA5B5' }}
                />
              </span>
              {live ? 'Live' : 'Paused'}
            </button>
            <button
              type="button"
              onClick={() => void load('replace')}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-ink-soft neu-press disabled:opacity-60"
            >
              {loading ? <IconSpinner size={14} /> : <IconRefresh size={14} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl value={level} options={LEVEL_OPTIONS} onChange={setLevel} size="sm" />

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={botId === 'all'} onClick={() => setBotId('all')} label="All bots" />
            {BOTS.map((bot) => {
              const Icon = BOT_ICONS[bot.id];
              return (
                <FilterChip
                  key={bot.id}
                  active={botId === bot.id}
                  onClick={() => setBotId(bot.id)}
                  label={bot.name}
                  color={bot.color}
                  icon={<Icon size={12} />}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Stream */}
      <div className="max-h-[640px] overflow-y-auto p-3 sm:p-4">
        {error ? (
          <p
            role="alert"
            className="m-2 flex items-start gap-2 rounded-2xl bg-bot-moderation/10 px-4 py-3 text-sm text-[#8f1f22] ring-1 ring-bot-moderation/30"
          >
            {error}
          </p>
        ) : null}

        {entries.length === 0 ? (
          <div className="rounded-2xl neu-inset px-5 py-12 text-center">
            <p className="text-sm font-semibold text-ink">No activity yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
              Nothing matches the current filters. Logs arrive as the bots work —
              this list fills in on its own while the tab is open.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: -10, scale: 0.995 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <LogRow entry={entry} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  color,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all duration-200',
        active ? 'text-ink' : 'text-ink-muted hover:text-ink',
      ].join(' ')}
      style={
        active
          ? {
              background: 'var(--pe-surface)',
              boxShadow: 'var(--neu-shadow-sm)',
              borderTop: `2px solid ${color ?? '#5865F2'}`,
            }
          : undefined
      }
    >
      {icon ? (
        <span
          aria-hidden
          className="grid h-4 w-4 place-items-center rounded text-white"
          style={{ background: color ?? '#5865F2', opacity: active ? 1 : 0.6 }}
        >
          {icon}
        </span>
      ) : null}
      {label}
    </button>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const bot = getBot(entry.bot_id);
  const Icon = BOT_ICONS[bot.id];

  return (
    <article className="flex items-start gap-3 rounded-2xl neu-hover px-3.5 py-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: bot.color, boxShadow: `2px 2px 6px ${bot.color}55` }}
      >
        <Icon size={14} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {bot.name}
          </span>
          <span className="font-mono text-[11px] text-ink-faint">{entry.action}</span>
          <LevelBadge level={entry.level} />
        </div>

        <p className="mt-1 break-words text-sm leading-relaxed text-ink">{entry.message}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
          <time dateTime={entry.created_at} title={absoluteTime(entry.created_at)}>
            {relativeTime(entry.created_at)}
          </time>
          {entry.channel_id ? <span>channel {entry.channel_id}</span> : null}
          {entry.user_id ? <span>user {entry.user_id}</span> : null}
        </div>
      </div>
    </article>
  );
}
