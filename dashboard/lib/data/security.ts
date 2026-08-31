// Server-only: reads `public.security_events` (RLS: owner read-only).
// Never import from a `'use client'` file.

import { credentials, demoSecurityEvents } from '../demo';
import { createSupabaseServerClient } from '../supabase/server';
import type { SecurityEventRow, SecuritySeverity } from '../types';

export const SEVERITY_ORDER: readonly SecuritySeverity[] = ['critical', 'high', 'medium', 'low'];

export interface SecurityQuery {
  limit?: number;
  severity?: SecuritySeverity | 'all';
}

export interface SecurityResult {
  events: SecurityEventRow[];
  demo: boolean;
}

/** Antinuke incident log, newest first. */
export async function fetchSecurityEvents(
  guildId: string,
  query: SecurityQuery = {},
): Promise<SecurityResult> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

  if (!credentials().supabase) {
    const events = demoSecurityEvents(guildId);
    return { events: filterSeverity(events, query.severity).slice(0, limit), demo: true };
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    const events = demoSecurityEvents(guildId);
    return { events: filterSeverity(events, query.severity).slice(0, limit), demo: true };
  }

  let builder = supabase
    .from('security_events')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (query.severity && query.severity !== 'all') {
    builder = builder.eq('severity', query.severity);
  }

  const { data, error } = await builder;
  if (error || !data) return { events: [], demo: false };

  return { events: data as SecurityEventRow[], demo: false };
}

function filterSeverity(
  events: readonly SecurityEventRow[],
  severity: SecuritySeverity | 'all' | undefined,
): SecurityEventRow[] {
  if (!severity || severity === 'all') return [...events];
  return events.filter((event) => event.severity === severity);
}
