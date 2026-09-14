'use client';

import { useState } from 'react';

import type { BotMeta } from '@/lib/bot-meta';
import { FieldShell } from '@/components/ui/Controls';
import { IconAlert, IconSpinner } from '@/components/ui/icons';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface CommandRoleMap {
  [command: string]: string[];
}

interface StateRow {
  bot_id: string;
  feature_flags?: Record<string, unknown> | null;
}

export interface AccessControlProps {
  guildId: string;
  bot: BotMeta;
  demo: boolean;
}

function parseRoles(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{15,21}$/.test(value));
}

/**
 * Per-server command permissions.
 *
 * Each command can be restricted to a list of Discord role IDs. Empty means
 * public (any authorized member). Server owners, administrators, and the
 * operator always bypass. Stored in bot_states.feature_flags.command_roles —
 * the bots read it through their existing control-state sync.
 */
export function AccessControl({ guildId, bot, demo }: AccessControlProps) {
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preservedFlags, setPreservedFlags] = useState<Record<string, unknown>>({});

  function load(): void {
    if (demo) {
      setLoaded(true);
      return;
    }
    fetch(`/api/bot-state/${guildId}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
      .then((data: { states?: StateRow[] }) => {
        const row = (data.states ?? []).find((entry) => entry.bot_id === bot.id);
        const flags = row?.feature_flags ?? {};
        setPreservedFlags(flags);
        const map = (flags.command_roles ?? {}) as CommandRoleMap;
        const next: Record<string, string> = {};
        for (const command of bot.commands) {
          const list = map[command];
          next[command] = Array.isArray(list) ? list.join(', ') : '';
        }
        setRoles(next);
        setLoaded(true);
      })
      .catch(() => {
        setError('Could not load the current role restrictions.');
        setLoaded(true);
      });
  }

  if (!loaded) {
    if (typeof window !== 'undefined') load();
    return (
      <div className="rounded-3xl neu-inset p-6 text-sm text-ink-muted">
        <IconSpinner size={16} /> Loading access control…
      </div>
    );
  }

  function save(): void {
    const commandRoles: CommandRoleMap = {};
    for (const command of bot.commands) {
      const parsed = parseRoles(roles[command] ?? '');
      if (parsed.length > 0) commandRoles[command] = parsed;
    }
    const invalid = Object.entries(roles).find(([, raw]) =>
      raw.split(/[,\s]+/).some((value) => value.trim() && !/^\d{15,21}$/.test(value.trim())),
    );
    if (invalid) {
      setState('error');
      setError(`"${invalid[1].trim()}" is not a Discord role ID (15-21 digits).`);
      return;
    }
    setState('saving');
    setError(null);
    fetch(`/api/bot-state/${guildId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bot_id: bot.id,
        feature_flags: { ...preservedFlags, command_roles: commandRoles },
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('save failed');
        setState('saved');
      })
      .catch(() => {
        setState('error');
        setError('Could not save the role restrictions. Try again.');
      });
  }

  const restrictedCount = bot.commands.filter((command) => parseRoles(roles[command] ?? '').length > 0).length;

  return (
    <div className="rounded-3xl glass-strong glass-sheen p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-ink">Command access control</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Restrict who can run each {bot.name} command in this server. Paste Discord role IDs
            (Server Settings → Roles → Copy ID), comma-separated. Empty = public to every member.
            Server owners and administrators always keep access.
          </p>
        </div>
        {restrictedCount > 0 ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent-ink">
            {restrictedCount} restricted
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {bot.commands.map((command) => (
          <FieldShell key={command} label={`/${command}`} help={roles[command] ? 'Restricted to listed roles' : 'Public — every member'}>
            <input
              className="w-full rounded-xl neu-inset bg-base px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint"
              placeholder="e.g. 123456789012345678, 987654321098765432"
              value={roles[command] ?? ''}
              maxLength={2000}
              onChange={(event) => {
                setRoles((current) => ({ ...current, [command]: event.target.value }));
                if (state === 'saved' || state === 'error') setState('idle');
              }}
            />
          </FieldShell>
        ))}
      </div>

      {state === 'saved' ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-accent-ink">
          Role restrictions saved — the bot applies them within a minute.
        </p>
      ) : null}
      {state === 'error' && error ? (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-bot-moderation/10 px-4 py-3 text-sm text-[#8f1f22] ring-1 ring-bot-moderation/25">
          <IconAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={demo || state === 'saving'}
        onClick={save}
        className="btn-neu-primary mt-5 px-5 py-2.5 text-sm disabled:cursor-wait disabled:opacity-70"
      >
        {state === 'saving' ? (
          <>
            <IconSpinner size={15} /> Saving…
          </>
        ) : (
          'Save role restrictions'
        )}
      </button>
      {demo ? (
        <p className="mt-2 text-xs text-ink-faint">Demo mode — sign-in required to save.</p>
      ) : null}
    </div>
  );
}
