import { loadSecret } from '../secret-vault';

export type SupabaseRuntimeConfig = {
  url: string;
  serviceRoleKey: string;
};

export async function createSupabaseRuntimeConfig(): Promise<SupabaseRuntimeConfig | null> {
  const [url, serviceRoleKey] = await Promise.all([
    loadSecret('supabase.runtime.url'),
    loadSecret('supabase.runtime.service_key'),
  ]);
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}
