import type { Metadata } from 'next';

import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { getMasterStatus, getProfile, getServers } from '@/lib/data/servers';

export const metadata: Metadata = {
  title: 'Servers',
  description: 'Configure every Ei Flow bot, per server.',
};

// Every page under /dashboard depends on the caller's session.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ servers, demo }, profile, master] = await Promise.all([
    getServers(),
    getProfile(),
    getMasterStatus(),
  ]);

  return (
    <DashboardShell
      profile={profile?.user ?? null}
      servers={servers}
      demo={demo || profile?.demo === true}
      isMaster={master}
    >
      {children}
    </DashboardShell>
  );
}
