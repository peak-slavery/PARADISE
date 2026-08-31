import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/PageHeader';
import { RevealGroup, RevealItem } from '@/components/motion/Reveal';
import { Badge } from '@/components/ui/Badge';
import { IconActivity, IconChevronRight, IconShield } from '@/components/ui/icons';
import { getServers } from '@/lib/data/servers';
import { initials, relativeTime } from '@/lib/format';

export default async function ServersPage() {
  const { servers, demo } = await getServers();

  return (
    <>
      <PageHeader
        eyebrow="Control plane"
        title="Your servers"
        description="Every guild you own that Ei Point is authorized for. Pick one to configure all eight bots, watch its activity stream or review antinuke incidents."
      />

      {demo ? (
        <div className="mb-5 rounded-3xl neu-inset p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Demo data
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            No database credentials are configured, so these servers are
            in-repo fixtures. Set <code className="font-mono text-[13px]">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
            <code className="font-mono text-[13px]">SUPABASE_SERVICE_ROLE_KEY</code> and{' '}
            <code className="font-mono text-[13px]">MONGODB_URI</code> in{' '}
            <code className="font-mono text-[13px]">dashboard/.env.local</code> to switch to live
            data.
          </p>
        </div>
      ) : null}

      {servers.length === 0 ? (
        <div className="rounded-3xl neu-raised p-10 text-center">
          <p className="text-sm font-semibold text-ink">No servers yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
            Invite any Ei Flow bot to a Discord server you own. The bot
            registers the guild on join and it will appear here once
            authorized.
          </p>
        </div>
      ) : (
        <RevealGroup
          step={0.07}
          className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {servers.map((server) => {
            const base = `/dashboard/${server.guild_id}`;
            return (
              <RevealItem key={server.id} className="h-full">
                <Link
                  href={base}
                  className="group flex h-full flex-col rounded-3xl neu-hover p-5"
                >
                  <div className="flex items-start gap-3.5">
                    <span
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white"
                      style={{
                        background: 'linear-gradient(140deg, #6b76f5 0%, #00d4aa 100%)',
                        boxShadow: '4px 4px 10px rgba(88,101,242,0.3), -3px -3px 8px rgba(255,255,255,0.9)',
                      }}
                    >
                      {initials(server.name ?? 'PE')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold tracking-tight text-ink">
                        {server.name ?? `Guild ${server.guild_id}`}
                      </h2>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
                        {server.guild_id}
                      </p>
                    </div>
                    <IconChevronRight
                      size={17}
                      className="mt-1 shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {server.authorized ? (
                      <Badge tone="success">Authorized</Badge>
                    ) : (
                      <Badge tone="danger">Not authorized</Badge>
                    )}
                    <span className="text-[11px] text-ink-faint">
                      updated {relativeTime(server.updated_at)}
                    </span>
                  </div>

                  <div className="mt-auto flex items-center gap-3 pt-5 text-xs font-medium text-ink-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-base-sunken px-2.5 py-1.5">
                      <IconShield size={14} />
                      Security
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-base-sunken px-2.5 py-1.5">
                      <IconActivity size={14} />
                      Activity
                    </span>
                  </div>
                </Link>
              </RevealItem>
            );
          })}
        </RevealGroup>
      )}
    </>
  );
}
