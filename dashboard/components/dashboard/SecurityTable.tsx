'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';

import { Badge, EventTypeBadge, SeverityBadge } from '@/components/ui/Badge';
import { SegmentedControl } from '@/components/ui/Controls';
import { IconAlert, IconChevronRight } from '@/components/ui/icons';
import { absoluteTime, humanizeToken, relativeTime } from '@/lib/format';
import type { SecurityEventRow, SecuritySeverity } from '@/lib/types';

const FILTERS: readonly { value: SecuritySeverity | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** Left-edge severity stripe — readable at a glance before the text. */
const SEVERITY_COLOR: Record<SecuritySeverity, string> = {
  low: '#3BA55D',
  medium: '#FAA81A',
  high: '#E67E22',
  critical: '#ED4245',
};

export function SecurityTable({
  events,
  demo,
}: {
  events: SecurityEventRow[];
  demo: boolean;
}) {
  const [filter, setFilter] = useState<SecuritySeverity | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const tally: Record<SecuritySeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const event of events) tally[event.severity] += 1;
    return tally;
  }, [events]);

  const visible = useMemo(
    () => (filter === 'all' ? events : events.filter((event) => event.severity === filter)),
    [events, filter],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total events" value={events.length} />
        <SummaryCard label="Critical" value={counts.critical} color={SEVERITY_COLOR.critical} />
        <SummaryCard label="High" value={counts.high} color={SEVERITY_COLOR.high} />
        <SummaryCard label="Medium / low" value={counts.medium + counts.low} color={SEVERITY_COLOR.medium} />
      </div>

      <section className="overflow-hidden rounded-3xl neu-raised">
        <div className="flex flex-col gap-4 border-b border-ink/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{
                background: 'linear-gradient(140deg, #f0863c 0%, #d9661a 100%)',
                boxShadow: '3px 3px 8px rgba(230,126,34,0.35), -2px -2px 6px rgba(255,255,255,0.9)',
              }}
            >
              <IconAlert size={17} />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink">Security events</h2>
              <p className="text-xs text-ink-muted">
                Supabase <code className="font-mono">security_events</code>
                {demo ? ' · demo fixtures' : ''}
              </p>
            </div>
          </div>

          <SegmentedControl value={filter} options={FILTERS} onChange={setFilter} size="sm" />
        </div>

        {visible.length === 0 ? (
          <div className="p-4">
            <div className="rounded-2xl neu-inset px-5 py-12 text-center">
              <p className="text-sm font-semibold text-ink">No incidents</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
                {events.length === 0
                  ? 'Antinuke has not flagged anything for this guild. Events appear here the moment a threshold is hit.'
                  : 'Nothing at this severity. Widen the filter to see the rest.'}
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2 p-3 sm:p-4">
            {visible.map((event) => {
              const isOpen = expanded === event.id;
              return (
                <li key={event.id}>
                  <div
                    className="overflow-hidden rounded-2xl bg-base"
                    style={{ boxShadow: 'var(--neu-shadow-sm)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-3.5 px-3.5 py-3.5 text-left transition-colors hover:bg-base-raised"
                    >
                      <span
                        aria-hidden
                        className="mt-1 h-9 w-1 shrink-0 rounded-full"
                        style={{ background: SEVERITY_COLOR[event.severity] }}
                      />

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <EventTypeBadge eventType={event.event_type} />
                          <SeverityBadge severity={event.severity} />
                          <span className="text-[11px] text-ink-faint">
                            {relativeTime(event.created_at)}
                          </span>
                        </span>

                        <span className="mt-1.5 block text-sm font-medium text-ink">
                          {event.action_taken ?? 'No action recorded'}
                        </span>
                        <span className="mt-1 block font-mono text-[11px] text-ink-faint">
                          actor {event.actor_id}
                        </span>
                      </span>

                      <motion.span
                        animate={{ rotate: isOpen ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-1 shrink-0 text-ink-faint"
                      >
                        <IconChevronRight size={17} />
                      </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-ink/5 px-4 py-4">
                            <dl className="grid gap-3 sm:grid-cols-2">
                              <Detail label="Event id" value={event.id} mono />
                              <Detail label="Guild" value={event.guild_id} mono />
                              <Detail label="Actor" value={event.actor_id} mono />
                              <Detail
                                label="Recorded"
                                value={absoluteTime(event.created_at)}
                              />
                            </dl>

                            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                              Details
                            </p>
                            <pre className="mt-2 overflow-x-auto rounded-2xl bg-base-sunken p-3.5 text-[12px] leading-relaxed text-ink-soft neu-inset-sm">
                              {JSON.stringify(event.details, null, 2)}
                            </pre>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge tone={event.severity === 'critical' ? 'critical' : 'accent'}>
                                {humanizeToken(event.event_type)}
                              </Badge>
                              <Badge>{humanizeToken(event.severity)} severity</Badge>
                            </div>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-3xl neu-raised px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl font-semibold tracking-tight"
        style={{ color: color ?? 'var(--pe-ink)' }}
      >
        {value}
      </p>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={[
          'mt-1 break-all text-sm text-ink',
          mono ? 'font-mono text-[12.5px]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
