import { redirect } from 'next/navigation';

import { authorizeMaster } from '@/lib/authz';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminControlPanel } from '@/components/dashboard/AdminControlPanel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const access = await authorizeMaster();
  if (!access.ok) redirect('/dashboard');
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <div className="rounded-3xl neu-raised p-6 text-sm text-ink-muted">Admin storage is unavailable.</div>;

  const [{ data: servers }, { data: whitelists }, { data: users }] = await Promise.all([
    supabase.from('servers').select('guild_id,name,owner_id,authorized,created_at').order('created_at', { ascending: false }),
    supabase.from('guild_whitelists').select('guild_id,whitelist_type,expires_at,note,created_at').is('removed_at', null).order('created_at', { ascending: false }),
    supabase.from('users').select('id,discord_id,username,is_master,created_at').order('created_at', { ascending: false }).limit(100),
  ]);

  return <AdminControlPanel servers={servers ?? []} whitelists={whitelists ?? []} users={users ?? []} />;
}
