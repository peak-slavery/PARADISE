'use client';

import { useState } from 'react';

type Server = { guild_id: string; name: string; owner_id: string | null; authorized: boolean; created_at: string };
type Whitelist = { guild_id: string; whitelist_type: string; expires_at: string | null; note: string | null; created_at: string };
type User = { id: string; discord_id: string; username: string | null; is_master: boolean; created_at: string };

export function AdminControlPanel({ servers, whitelists, users }: { servers: Server[]; whitelists: Whitelist[]; users: User[] }) {
  const [rows, setRows] = useState(whitelists);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function setWhitelist(guildId: string, type: 'full' | 'temp' | 'unauthorised') {
    setBusy(guildId);
    setMessage(null);
    try {
      const expiresAt = type === 'temp' ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : null;
      const response = await fetch('/api/guild-whitelist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guild_id: guildId, whitelist_type: type, expires_at: expiresAt, note: 'Dashboard admin action' }),
      });
      const payload = await response.json().catch(() => null) as { whitelist?: Whitelist; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to update whitelist');
      if (payload?.whitelist) setRows((current) => [payload.whitelist as Whitelist, ...current.filter((row) => row.guild_id !== guildId)]);
      setMessage(`Updated ${guildId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update whitelist');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">Master control</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Authorization desk</h1><p className="mt-1 text-sm text-ink-muted">Review every guild and grant full or temporary command access.</p></div>
        <span className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">Master only</span>
      </div>
      {message ? <div role="status" className="rounded-2xl bg-base-raised px-4 py-3 text-sm text-ink-muted neu-inset-sm">{message}</div> : null}

      <section className="rounded-3xl neu-raised p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Guild authorization</h2>
        <div className="mt-4 grid gap-3">
          {servers.map((server) => {
            const whitelist = rows.find((row) => row.guild_id === server.guild_id);
            return <div key={server.guild_id} className="grid gap-3 rounded-2xl neu-inset-sm p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{server.name}</p><p className="mt-1 font-mono text-xs text-ink-faint">{server.guild_id}</p><p className="mt-1 text-xs text-ink-muted">{whitelist?.whitelist_type ?? 'unauthorised'}{whitelist?.expires_at ? ` · expires ${new Date(whitelist.expires_at).toLocaleString()}` : ''}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy === server.guild_id} onClick={() => void setWhitelist(server.guild_id, 'full')} className="btn-neu px-3 py-2 text-xs">Full</button>
                <button type="button" disabled={busy === server.guild_id} onClick={() => void setWhitelist(server.guild_id, 'temp')} className="btn-neu px-3 py-2 text-xs">Temp 24h</button>
                <button type="button" disabled={busy === server.guild_id} onClick={() => void setWhitelist(server.guild_id, 'unauthorised')} className="rounded-xl px-3 py-2 text-xs text-bot-moderation neu-press">Revoke</button>
              </div>
            </div>;
          })}
          {!servers.length ? <p className="text-sm text-ink-muted">No guild records found.</p> : null}
        </div>
      </section>

      <section className="rounded-3xl neu-raised p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Users</h2>
        <div className="mt-4 grid gap-2">
          {users.map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl neu-inset-sm px-4 py-3"><div><p className="text-sm font-semibold text-ink">{user.username ?? 'Unknown user'}</p><p className="font-mono text-xs text-ink-faint">{user.discord_id}</p></div><span className="text-xs text-ink-muted">{user.is_master ? 'Master' : 'Operator'}</span></div>)}
        </div>
      </section>
    </div>
  );
}
