import { notFound } from 'next/navigation';

import { GuildHeader } from '@/components/dashboard/GuildHeader';
import { requireGuildAccess } from '@/lib/authz';
import { getServer } from '@/lib/data/servers';

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  // Layouts and pages render concurrently in Next, so keep this explicit
  // authorization check even though child pages repeat it before data reads.
  await requireGuildAccess(guildId);
  const server = await getServer(guildId);
  if (!server || server.authorized !== true) notFound();

  return (
    <div className="pt-1">
      <GuildHeader server={server} />
      {children}
    </div>
  );
}
