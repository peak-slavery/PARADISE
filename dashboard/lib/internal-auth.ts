import { createSupabaseAdminClient } from './supabase/server';

let nonceWritesSinceCleanup = 0;

/** Atomically records a bot request id; duplicate ids are rejected. */
export async function consumeNonce(requestId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return false;
  const { error } = await supabase.from('internal_request_nonces').insert({ request_id: requestId });
  if (!error) {
    // Keep replay IDs long enough to cover the five-minute HMAC window without
    // allowing this serverless bookkeeping table to grow without bound. Do it
    // periodically rather than on every request to avoid write amplification.
    nonceWritesSinceCleanup += 1;
    if (nonceWritesSinceCleanup >= 100) {
      nonceWritesSinceCleanup = 0;
      const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      try {
        await supabase
          .from('internal_request_nonces')
          .delete()
          .lt('created_at', cutoff);
      } catch {
        // Cleanup is best effort; the nonce insert already established replay
        // protection for this request.
      }
    }
    return true;
  }
  if (error.code === '23505') return false;
  throw error;
}
