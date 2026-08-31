'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';

import type { BotMeta } from '@/lib/bot-meta';
import type { ConfigValues } from '@/lib/types';
import {
  FieldShell,
  NeuNumberInput,
  NeuSelect,
  NeuTextarea,
  NeuTextInput,
  NeuToggle,
} from '@/components/ui/Controls';
import {
  IconAlert,
  IconCheck,
  IconRefresh,
  IconSpinner,
} from '@/components/ui/icons';
import { relativeTime } from '@/lib/format';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ConfigFormProps {
  guildId: string;
  bot: BotMeta;
  initialValues: ConfigValues;
  updatedAt: string | null;
  demo: boolean;
}

/**
 * One generic form renders all eight config panels.
 *
 * The panel's shape comes from `bot.fields` in `lib/bots.ts`, so adding a
 * setting to any bot is a one-line change there and needs no migration — the
 * config column is jsonb.
 */
export function ConfigForm({ guildId, bot, initialValues, updatedAt, demo }: ConfigFormProps) {
  const [values, setValues] = useState<ConfigValues>(initialValues);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const baseline = useMemo(() => JSON.stringify(initialValues), [initialValues]);
  const dirty = JSON.stringify(values) !== baseline;

  function set(key: string, value: string | number | boolean) {
    setValues((current) => ({ ...current, [key]: value }));
    if (state === 'saved' || state === 'error') setState('idle');
  }

  function resetToDefaults() {
    const next: ConfigValues = {};
    for (const field of bot.fields) {
      next[field.key] = field.default;
    }
    setValues(next);
    setState('idle');
    setError(null);
  }

  async function save() {
    setState('saving');
    setError(null);

    try {
      const response = await fetch(`/api/config/${guildId}/${bot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: values }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      setState('saved');
      setSavedAt(new Date().toISOString());
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Unknown error');
    }
  }

  return (
    <motion.div
      key={bot.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-5 lg:grid-cols-[1fr_268px]"
    >
      {/* --- Config surface ----------------------------------------------- */}
      <section className="overflow-hidden rounded-3xl neu-raised">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {bot.name} config
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
              {bot.tagline}
            </h2>
          </div>
          <span
            className="rounded-full px-3 py-1 text-[11px] font-semibold text-white"
            style={{ background: bot.color }}
          >
            {bot.id}
          </span>
        </header>

        <div className="grid gap-5 p-6 sm:grid-cols-2">
          {bot.fields.map((field) => {
            const id = `${bot.id}-${field.key}`;
            const raw = values[field.key];

            switch (field.type) {
              case 'boolean':
                return (
                  <div key={field.key} className="sm:col-span-1">
                    <FieldShell label={field.label} help={field.help} inline>
                      <NeuToggle
                        label={field.label}
                        checked={raw === true}
                        onChange={(next) => set(field.key, next)}
                      />
                    </FieldShell>
                  </div>
                );

              case 'number':
                return (
                  <div key={field.key} className="sm:col-span-1">
                    <FieldShell label={field.label} help={field.help} htmlFor={id}>
                      <NeuNumberInput
                        id={id}
                        value={typeof raw === 'number' ? raw : Number(raw ?? 0)}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        suffix={field.suffix}
                        onChange={(next) => set(field.key, next)}
                      />
                    </FieldShell>
                  </div>
                );

              case 'textarea':
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <FieldShell label={field.label} help={field.help} htmlFor={id}>
                      <NeuTextarea
                        id={id}
                        value={typeof raw === 'string' ? raw : ''}
                        rows={field.rows}
                        placeholder={field.placeholder}
                        onChange={(next) => set(field.key, next)}
                      />
                    </FieldShell>
                  </div>
                );

              case 'select':
                return (
                  <div key={field.key} className="sm:col-span-1">
                    <FieldShell label={field.label} help={field.help} htmlFor={id}>
                      <NeuSelect
                        id={id}
                        value={typeof raw === 'string' ? raw : field.default}
                        options={field.options}
                        onChange={(next) => set(field.key, next)}
                      />
                    </FieldShell>
                  </div>
                );

              case 'text':
              default:
                return (
                  <div key={field.key} className="sm:col-span-1">
                    <FieldShell label={field.label} help={field.help} htmlFor={id}>
                      <NeuTextInput
                        id={id}
                        value={typeof raw === 'string' ? raw : ''}
                        placeholder={field.placeholder}
                        onChange={(next) => set(field.key, next)}
                      />
                    </FieldShell>
                  </div>
                );
            }
          })}
        </div>
      </section>

      {/* --- Save rail ----------------------------------------------------- */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-3xl glass glass-sheen p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Changes
          </p>

          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            {dirty
              ? 'You have unsaved edits on this panel.'
              : 'Everything on this panel matches what is stored.'}
          </p>

          <div className="mt-4 rounded-2xl neu-inset p-3">
            <p className="text-xs text-ink-muted">Last saved</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {savedAt
                ? relativeTime(savedAt)
                : updatedAt
                  ? relativeTime(updatedAt)
                  : 'Never'}
            </p>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={state === 'saving' || !dirty}
            className="btn-neu-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-55"
          >
            {state === 'saving' ? (
              <>
                <IconSpinner size={16} />
                Saving…
              </>
            ) : (
              <>
                <IconCheck size={16} />
                Save changes
              </>
            )}
          </button>

          <button
            type="button"
            onClick={resetToDefaults}
            disabled={state === 'saving'}
            className="btn-neu mt-2.5 w-full"
          >
            <IconRefresh size={16} />
            Reset to defaults
          </button>

          <AnimatePresence initial={false}>
            {state === 'saved' ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                role="status"
                className="mt-4 flex items-start gap-2 rounded-2xl bg-bot-levelup/20 px-3.5 py-2.5 text-sm text-[#1d7a3c] ring-1 ring-bot-levelup/35"
              >
                <IconCheck size={16} className="mt-0.5 shrink-0" />
                <span>
                  Saved{demo ? ' to demo memory (session only)' : ''}.
                </span>
              </motion.p>
            ) : null}

            {state === 'error' ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-2xl bg-bot-moderation/10 px-3.5 py-2.5 text-sm text-[#8f1f22] ring-1 ring-bot-moderation/30"
              >
                <IconAlert size={16} className="mt-0.5 shrink-0" />
                <span>{error ?? 'Could not save.'}</span>
              </motion.p>
            ) : null}
          </AnimatePresence>

          <div className="mt-5 border-t border-ink/5 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Commands
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {bot.commands.map((command) => (
                <li
                  key={command}
                  className="rounded-lg bg-base-sunken px-2 py-1 font-mono text-[11px] text-ink-soft"
                  style={{ boxShadow: 'var(--neu-shadow-inset-sm)' }}
                >
                  {command}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            Stored as a single jsonb blob in{' '}
            <code className="font-mono">bot_configs.config</code> keyed on{' '}
            <code className="font-mono">(guild_id, bot_id)</code>. RLS permits
            writes only for guilds you own.
          </p>
        </div>
      </aside>
    </motion.div>
  );
}
