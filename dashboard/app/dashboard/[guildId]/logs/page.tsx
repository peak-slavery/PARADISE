import { LogStream } from '@/components/dashboard/LogStream';
import { fetchLogs } from '@/lib/data/logs';

export const dynamic = 'force-dynamic';

export default async function LogsPage({
  params,
}: {
  params: { guildId: string };
}) {
  // Seed the stream server-side so the first paint already has content; the
  // client then takes over polling with a `since` cursor.
  const page = await fetchLogs(params.guildId, { limit: 60 });

  return (
    <div className="pb-4">
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Live activity</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every log line the eight bots write for this guild, newest first. The
          list refreshes on a 12-second poll rather than a WebSocket: a
          persistent socket per open tab would blow through serverless
          connection limits, and a 12-second delay is invisible for audit data.
        </p>
      </div>

      <LogStream guildId={params.guildId} initialEntries={page.entries} />
    </div>
  );
}
