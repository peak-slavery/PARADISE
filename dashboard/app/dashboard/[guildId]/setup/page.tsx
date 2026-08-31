import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { getSetupReadiness } from '@/lib/setup';
import { getBotConfig } from '@/lib/data/config';

export const dynamic = 'force-dynamic';

const GROUP_LABELS: Record<string, string> = {
  datastore: 'Datastores',
  ai: 'AI providers',
  bot: 'Bot ↔ dashboard',
};

export default async function SetupPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const readiness = getSetupReadiness();
  const zoro = await getBotConfig(guildId, 'zoro');
  const zoroEnabled = Boolean(zoro.values.enabled);
  const alertSet = typeof zoro.values.alert_channel === 'string' && zoro.values.alert_channel.length > 0;

  const steps = [
    { label: 'Connect Supabase (bot config + security events)', done: readiness.items.find((i) => i.key === 'supabase')?.ready ?? false },
    { label: 'Connect MongoDB (trust scoring + snapshots)', done: readiness.items.find((i) => i.key === 'mongo')?.ready ?? false },
    { label: 'Connect Upstash Redis (raid sliding window)', done: readiness.items.find((i) => i.key === 'redis')?.ready ?? false },
    { label: 'Add a Mistral key for the AI assistant', done: readiness.items.find((i) => i.key === 'mistral')?.ready ?? false },
    { label: 'Add a Groq key for the Cyrene persona (gpt-oss)', done: readiness.items.find((i) => i.key === 'groqCyrene')?.ready ?? false },
    { label: 'Add a second Groq key for the AutoMod SLM', done: readiness.items.find((i) => i.key === 'groqAutomod')?.ready ?? false },
    { label: 'Set a matching HMAC_SECRET on every bot', done: readiness.items.find((i) => i.key === 'hmac')?.ready ?? false },
    { label: 'Arm Zoro in the config panel', done: zoroEnabled },
    { label: 'Set Zoro’s incident alert channel', done: alertSet },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="pb-4">
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Setup &amp; readiness</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Live status of every backend and API key the Ei Flow network depends on. These are read
          from the deployment environment — green means the running bot will use it, amber means the
          feature degrades gracefully until it is set.
        </p>
      </div>

      {readiness.demo ? (
        <div className="mb-5 rounded-2xl neu-inset px-4 py-3 text-sm text-ink-muted">
          Demo mode — fixtures are being served because Supabase or MongoDB is unconfigured. The
          readouts below reflect real environment variables and will flip to live the moment you
          deploy credentials.
        </div>
      ) : null}

      {/* Readiness grid, grouped */}
      <div className="mb-6 flex flex-col gap-5">
        {(['datastore', 'ai', 'bot'] as const).map((group) => {
          const groupItems = readiness.items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                {GROUP_LABELS[group]}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupItems.map((item) => (
                  <Panel key={item.key} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{item.label}</p>
                      <Badge tone={item.ready ? 'success' : 'warn'}>{item.ready ? 'ready' : 'missing'}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-muted">{item.detail}</p>
                    <p className="mt-3 font-mono text-[11px] text-ink-faint">{item.envVar}</p>
                  </Panel>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Model routing */}
      <Panel className="mb-6">
        <PanelHeader
          title="Model routing"
          description="How the two AI surfaces and the AutoMod SLM map to providers. Each route has its own fallback chain; a missing key pushes the route to the next provider."
        />
        <div className="divide-y divide-ink/5">
          {readiness.modelRouting.map((route) => (
            <div key={route.route} className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <code className="rounded-lg bg-base-sunken px-2 py-1 text-[12px] font-semibold text-ink">
                  {route.route}
                </code>
                <span className="text-xs text-ink-muted">
                  {route.via} · <span className="font-mono text-ink-soft">{route.model}</span>
                </span>
              </div>
              <Badge tone={route.ready ? 'success' : 'warn'}>{route.ready ? 'live' : 'no key'}</Badge>
            </div>
          ))}
        </div>
      </Panel>

      {/* First-time setup checklist */}
      <Panel>
        <PanelHeader
          title="First-time setup"
          eyebrow={`${doneCount}/${steps.length} complete`}
          description="A guided path from a fresh guild to a fully protected server. Each step links to the place you finish it."
          action={
            <Link
              href={`/dashboard/${guildId}`}
              className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              Open config
            </Link>
          }
        />
        <ol className="px-6 py-4">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-3 border-b border-ink/5 py-3 last:border-0">
              <span
                aria-hidden
                className={[
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  step.done ? 'bg-bot-levelup/20 text-[#1d7a3c]' : 'bg-base-sunken text-ink-faint',
                ].join(' ')}
              >
                {step.done ? '✓' : index + 1}
              </span>
              <span className={step.done ? 'text-sm text-ink-muted line-through decoration-ink/20' : 'text-sm text-ink'}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 border-t border-ink/5 px-6 py-4">
          <Link
            href={`/dashboard/${guildId}/security`}
            className="rounded-xl neu-press px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            View security incidents →
          </Link>
        </div>
      </Panel>
    </div>
  );
}
