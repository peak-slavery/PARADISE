import { createSupabaseAdminClient } from './supabase/server';

/** Atomically records a bot request id; duplicate ids are rejected. */
export async function consumeNonce(requestId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return false;
  const { error } = await supabase.from('internal_request_nonces').insert({ request_id: requestId });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}
