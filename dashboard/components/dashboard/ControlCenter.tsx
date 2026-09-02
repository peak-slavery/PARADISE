'use client';

import { useEffect, useMemo, useState } from 'react';

import { BOTS } from '@/lib/bots';
import type { BotId, BotStateRow, DashboardTheme, ServerSettingsRow } from '@/lib/types';

type ComposerField = { name: string; value: string; inline: boolean };
type ComposerButton = { label: string; url: string };

const EMPTY_SETTINGS: ServerSettingsRow = {
  guild_id: '',
  theme: 'system',
  notifications_enabled: true,
  server_paused: false,
  notification_preferences: {},
  updated_by: null,
  updated_at: '',
};

const EMPTY_FIELD: ComposerField = { name: '', value: '', inline: false };
const EMPTY_BUTTON: ComposerButton = { label: '', url: '' };

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'color';
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl bg-base-sunken px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint neu-inset-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/55"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-2xl bg-base-sunken px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint neu-inset-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/55"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full neu-track ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        aria-hidden
        className={`absolute top-1 h-5 w-5 rounded-full transition-all ${checked ? 'right-1 bg-accent' : 'left-1 bg-base-raised'}`}
        style={{ boxShadow: 'var(--neu-shadow-sm)' }}
      />
    </button>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl neu-raised p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function ControlCenter({ guildId }: { guildId: string }) {
  const [settings, setSettings] = useState<ServerSettingsRow>({ ...EMPTY_SETTINGS, guild_id: guildId });
  const [states, setStates] = useState<BotStateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState({
    botId: BOTS[0]?.id ?? 'shanks',
    channelId: '',
    title: '',
    description: '',
    url: '',
    color: '#5865F2',
    thumbnail: '',
    image: '',
    authorName: '',
    authorUrl: '',
    authorIconUrl: '',
    footer: '',
  });
  const [fields, setFields] = useState<ComposerField[]>([]);
  const [buttons, setButtons] = useState<ComposerButton[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/server-settings/${guildId}`, { cache: 'no-store' }).then((response) => response.json()),
      fetch(`/api/bot-state/${guildId}`, { cache: 'no-store' }).then((response) => response.json()),
    ])
      .then(([settingsPayload, statesPayload]) => {
        if (!active) return;
        if (settingsPayload.settings) setSettings({ ...EMPTY_SETTINGS, ...settingsPayload.settings });
        if (Array.isArray(statesPayload.states)) setStates(statesPayload.states as BotStateRow[]);
      })
      .catch(() => {
        if (active) setError('Control state could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [guildId]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
  }, [settings.theme]);

  const selectedBot = useMemo(
    () => BOTS.find((bot) => bot.id === composer.botId) ?? BOTS[0],
    [composer.botId],
  );
  const selectedState = states.find((state) => state.bot_id === composer.botId);
  const previewFields = fields.filter((field) => field.name.trim() && field.value.trim());
  const previewButtons = buttons.filter((button) => button.label.trim() && button.url.trim());

  async function patchSettings(patch: Partial<ServerSettingsRow>, key: string) {
    setSaving(key);
    setError(null);
    try {
      const response = await fetch(`/api/server-settings/${guildId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => null) as { settings?: ServerSettingsRow; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to save setting.');
      if (payload?.settings) setSettings({ ...settings, ...payload.settings });
      setNotice('Saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save setting.');
    } finally {
      setSaving(null);
    }
  }

  async function patchBotState(botId: BotId, patch: { enabled?: boolean; paused?: boolean }) {
    setSaving(`bot:${botId}`);
    setError(null);
    try {
      const response = await fetch(`/api/bot-state/${guildId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bot_id: botId, ...patch }),
      });
      const payload = await response.json().catch(() => null) as { state?: BotStateRow; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to save bot state.');
      if (payload?.state) {
        setStates((current) => [...current.filter((state) => state.bot_id !== botId), payload.state as BotStateRow]);
      }
      setNotice('Saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save bot state.');
    } finally {
      setSaving(null);
    }
  }

  async function sendEmbed() {
    setSaving('send');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/embed/${guildId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bot_id: composer.botId,
          channel_id: composer.channelId,
          title: composer.title,
          description: composer.description,
          url: composer.url,
          color: composer.color,
          thumbnail: composer.thumbnail,
          image: composer.image,
          footer: composer.footer,
          author: { name: composer.authorName, url: composer.authorUrl, iconUrl: composer.authorIconUrl },
          fields,
          buttons,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Embed could not be queued.');
      setNotice('Embed queued for delivery');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Embed could not be queued.');
    } finally {
      setSaving(null);
    }
  }

  function updateComposer(key: keyof typeof composer, value: string) {
    setComposer((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function updateField(index: number, patch: Partial<ComposerField>) {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  function updateButton(index: number, patch: Partial<ComposerButton>) {
    setButtons((current) => current.map((button, buttonIndex) => buttonIndex === index ? { ...button, ...patch } : button));
  }

  return (
    <div className="mb-6 grid gap-5">
      <Section
        eyebrow="Control plane"
        title="Fleet controls"
        description="Pause this server, change the dashboard surface, or isolate one bot without trusting browser-side permissions."
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-2xl neu-inset-sm px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">Pause server</p>
                <p className="mt-0.5 text-xs text-ink-muted">All bot commands stop for this guild.</p>
              </div>
              <Toggle
                label="Pause server"
                checked={settings.server_paused}
                disabled={loading || saving === 'server'}
                onChange={(server_paused) => void patchSettings({ server_paused }, 'server')}
              />
            </div>
            <label className="flex items-center justify-between gap-4 rounded-2xl neu-inset-sm px-4 py-3">
              <span>
                <span className="block text-sm font-semibold text-ink">Theme</span>
                <span className="mt-0.5 block text-xs text-ink-muted">Saved per server.</span>
              </span>
              <select
                value={settings.theme}
                disabled={loading || saving === 'theme'}
                onChange={(event) => void patchSettings({ theme: event.target.value as DashboardTheme }, 'theme')}
                className="rounded-xl bg-base-raised px-2.5 py-2 text-xs font-semibold text-ink neu-raised-sm outline-none"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
          <div className="flex min-h-12 items-center justify-center rounded-2xl bg-base-sunken px-4 text-xs text-ink-muted neu-inset-sm">
            {loading ? 'Loading control state…' : settings.server_paused ? 'Server paused' : 'Server accepting commands'}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {BOTS.map((bot) => {
            const state = states.find((item) => item.bot_id === bot.id);
            const enabled = state?.enabled ?? true;
            const paused = state?.paused ?? false;
            return (
              <div key={bot.id} className="rounded-2xl neu-raised-sm p-3">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: bot.color, opacity: enabled && !paused ? 1 : 0.35 }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{bot.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-faint">{enabled && !paused ? 'Live' : 'Off'}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <span>{paused ? 'Paused' : enabled ? 'Enabled' : 'Disabled'}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="rounded-lg px-2 py-1 neu-press" disabled={saving === `bot:${bot.id}`} onClick={() => void patchBotState(bot.id, { paused: !paused })}>
                      {paused ? 'Resume' : 'Pause'}
                    </button>
                    <Toggle label={`Enable ${bot.name}`} checked={enabled} disabled={saving === `bot:${bot.id}`} onChange={(next) => void patchBotState(bot.id, { enabled: next })} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="Message studio"
        title="Embed composer"
        description="Compose a bounded Discord embed and queue it through the selected bot. Link buttons are intentionally non-interactive to keep the control plane safe."
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-soft">Sending bot</span>
                <select value={composer.botId} onChange={(event) => updateComposer('botId', event.target.value)} className="w-full rounded-2xl bg-base-sunken px-3.5 py-2.5 text-sm text-ink neu-inset-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/55">
                  {BOTS.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
                </select>
                {selectedState?.enabled === false || selectedState?.paused ? <span className="text-xs text-bot-moderation">Selected bot is paused or disabled.</span> : null}
              </label>
              <Input label="Channel ID" value={composer.channelId} onChange={(value) => updateComposer('channelId', value)} placeholder="123456789012345678" maxLength={20} />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
              <Input label="Title" value={composer.title} onChange={(value) => updateComposer('title', value)} placeholder="A clear announcement title" maxLength={256} />
              <Input label="Color" value={composer.color} onChange={(value) => updateComposer('color', value)} type="color" />
            </div>
            <Textarea label="Description" value={composer.description} onChange={(value) => updateComposer('description', value)} placeholder="Write the main message…" maxLength={4096} rows={5} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Embed URL" value={composer.url} onChange={(value) => updateComposer('url', value)} type="url" placeholder="https://example.com" />
              <Input label="Footer" value={composer.footer} onChange={(value) => updateComposer('footer', value)} placeholder="Ei Point control plane" maxLength={2048} />
              <Input label="Thumbnail URL" value={composer.thumbnail} onChange={(value) => updateComposer('thumbnail', value)} type="url" placeholder="https://…" />
              <Input label="Image URL" value={composer.image} onChange={(value) => updateComposer('image', value)} type="url" placeholder="https://…" />
            </div>

            <div className="rounded-2xl neu-inset-sm p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Author</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Input label="Name" value={composer.authorName} onChange={(value) => updateComposer('authorName', value)} maxLength={256} />
                <Input label="URL" value={composer.authorUrl} onChange={(value) => updateComposer('authorUrl', value)} type="url" />
                <Input label="Icon URL" value={composer.authorIconUrl} onChange={(value) => updateComposer('authorIconUrl', value)} type="url" />
              </div>
            </div>

            <div className="rounded-2xl neu-inset-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Fields</p><p className="mt-1 text-xs text-ink-muted">Up to 25 fields, each rendered as a Discord field.</p></div>
                <button type="button" disabled={fields.length >= 25} onClick={() => setFields((current) => [...current, { ...EMPTY_FIELD }])} className="btn-neu px-3 py-2 text-xs">Add field</button>
              </div>
              <div className="mt-3 grid gap-3">
                {fields.map((field, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl bg-base-raised p-3 sm:grid-cols-[1fr_1.4fr_auto_auto]">
                    <Input label="Name" value={field.name} onChange={(value) => updateField(index, { name: value })} maxLength={256} />
                    <Input label="Value" value={field.value} onChange={(value) => updateField(index, { value })} maxLength={1024} />
                    <label className="flex items-end gap-2 pb-2 text-xs text-ink-muted"><input type="checkbox" checked={field.inline} onChange={(event) => updateField(index, { inline: event.target.checked })} /> Inline</label>
                    <button type="button" onClick={() => setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))} className="mb-1 self-end rounded-lg px-2 py-2 text-xs text-bot-moderation neu-press">Remove</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl neu-inset-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Link buttons</p><p className="mt-1 text-xs text-ink-muted">Up to 5 HTTPS or HTTP links.</p></div>
                <button type="button" disabled={buttons.length >= 5} onClick={() => setButtons((current) => [...current, { ...EMPTY_BUTTON }])} className="btn-neu px-3 py-2 text-xs">Add button</button>
              </div>
              <div className="mt-3 grid gap-3">
                {buttons.map((button, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl bg-base-raised p-3 sm:grid-cols-[1fr_1.5fr_auto]">
                    <Input label="Label" value={button.label} onChange={(value) => updateButton(index, { label: value })} maxLength={80} />
                    <Input label="URL" value={button.url} onChange={(value) => updateButton(index, { url: value })} type="url" />
                    <button type="button" onClick={() => setButtons((current) => current.filter((_, buttonIndex) => buttonIndex !== index))} className="mb-1 self-end rounded-lg px-2 py-2 text-xs text-bot-moderation neu-press">Remove</button>
                  </div>
                ))}
              </div>
            </div>

            <button type="button" disabled={saving === 'send' || !composer.channelId.trim() || (!composer.title.trim() && !composer.description.trim() && previewFields.length === 0)} onClick={() => void sendEmbed()} className="btn-neu-primary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              {saving === 'send' ? 'Queuing…' : `Send with ${selectedBot?.name ?? 'bot'}`}
            </button>
          </div>

          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-3xl bg-[#313338] p-4 text-white shadow-[0_18px_40px_rgba(31,41,61,0.28)]">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b5bac1]">Live preview</p>
              <div className="rounded-md border-l-4 bg-[#2b2d31] p-3" style={{ borderLeftColor: composer.color || '#5865F2' }}>
                {composer.authorName ? <p className="text-xs font-semibold text-[#b5bac1]">{composer.authorName}</p> : null}
                {composer.title ? <p className="mt-1 text-base font-bold text-white">{composer.title}</p> : null}
                {composer.description ? <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#dbdee1]">{composer.description}</p> : null}
                {previewFields.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{previewFields.map((field, index) => <div key={index} className={field.inline ? '' : 'sm:col-span-2'}><p className="text-xs font-semibold text-white">{field.name}</p><p className="mt-0.5 whitespace-pre-wrap text-xs text-[#b5bac1]">{field.value}</p></div>)}</div> : null}
                {composer.image ? <div className="mt-3 h-32 rounded bg-[#1e1f22] p-2 text-center text-[10px] text-[#949ba4]">Image preview</div> : null}
                {composer.thumbnail ? <span className="mt-3 block text-[10px] text-[#949ba4]">Thumbnail attached</span> : null}
                {composer.footer ? <p className="mt-3 border-t border-white/10 pt-2 text-[10px] text-[#949ba4]">{composer.footer}</p> : null}
              </div>
              {previewButtons.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{previewButtons.map((button, index) => <span key={index} className="rounded bg-[#4e5058] px-3 py-1.5 text-xs font-medium">{button.label}</span>)}</div> : null}
              <p className="mt-4 text-[11px] leading-relaxed text-[#949ba4]">Messages are sent with mentions disabled. The selected bot validates the channel belongs to this guild before delivery.</p>
            </div>
          </aside>
        </div>
      </Section>

      {notice || error ? <div role={error ? 'alert' : 'status'} className={`rounded-2xl px-4 py-3 text-sm ${error ? 'bg-bot-moderation/10 text-[#8f1f22] ring-1 ring-bot-moderation/30' : 'bg-bot-levelup/20 text-[#1d7a3c] ring-1 ring-bot-levelup/35'}`}>{error ?? notice}</div> : null}
    </div>
  );
}
