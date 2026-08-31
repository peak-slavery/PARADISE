import { notFound } from 'next/navigation';

import { GuildHeader } from '@/components/dashboard/GuildHeader';
import { getServer } from '@/lib/data/servers';

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const server = await getServer(guildId);

  // Either the guild doesn't exist, or RLS hid it because the caller doesn't
  // own it. Both are a 404 — never a 403, which would confirm the row exists.
  if (!server) {
    notFound();
  }

  return (
    <div className="pt-1">
      <GuildHeader server={server} />
      {children}
    </div>
  );
}
