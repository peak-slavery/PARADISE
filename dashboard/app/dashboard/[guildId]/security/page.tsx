import { SecurityTable } from '@/components/dashboard/SecurityTable';
import { fetchSecurityEvents } from '@/lib/data/security';

export const dynamic = 'force-dynamic';

export default async function SecurityPage({
  params,
}: {
  params: { guildId: string };
}) {
  const { events, demo } = await fetchSecurityEvents(params.guildId, { limit: 60 });

  return (
    <div className="pb-4">
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Antinuke incidents</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every threshold the antinuke bot has tripped for this guild, with the
          action it took and the raw payload it recorded. This table is read-only
          by design — it is an audit trail, not configuration.
        </p>
      </div>

      <SecurityTable events={events} demo={demo} />
    </div>
  );
}
