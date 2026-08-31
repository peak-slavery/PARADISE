import { NextResponse, type NextRequest } from 'next/server';

import { getServer } from '@/lib/data/servers';
import { LOG_LEVELS, fetchLogs } from '@/lib/data/logs';
import { credentials } from '@/lib/demo';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';
import { isBotId } from '@/lib/bots';
import type { LogLevel } from '@/lib/types';

// The MongoDB driver needs the Node runtime, and a live stream must never be
// cached by the router cache.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function hasConfiguredEnvironment(): boolean {
  return [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.MONGODB_URI,
    process.env.HMAC_SECRET,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

type GuildAuthorization =
  | { ok: true; demo: boolean }
  | { ok: false; status: 401 | 404 | 503; error: string };

async function authorizeGuild(guildId: string): Promise<GuildAuthorization> {
  if (!isDiscordSnowflake(guildId)) {
    return { ok: false, status: 404, error: 'Guild not found' };
  }

  const status = credentials();
  if (!status.supabase || !status.mongo) {
    return hasConfiguredEnvironment()
      ? { ok: false, status: 503, error: 'Dashboard backend is not configured' }
      : { ok: true, demo: true };
  }

  try {
    if (!createSupabaseServerClient()) {
      return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
    }

    const user = await getCurrentUser();
    if (!user) return { ok: false, status: 401, error: 'Authentication required' };

    const server = await getServer(guildId);
    if (!server) return { ok: false, status: 404, error: 'Guild not found' };
  } catch {
    return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
  }

  return { ok: true, demo: false };
}

function authorizationResponse(result: Exclude<GuildAuthorization, { ok: true }>) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/**
 * One page of guild activity, newest first.
 *
 * The client polls this every 10–15s and passes `since=<ISO>` so each poll
 * transfers only rows that arrived after the previous one. Polling is
 * deliberate: a WebSocket per open dashboard tab would exhaust serverless
 * connection limits long before bandwidth became a problem.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { guildId: string } },
) {
  const { guildId } = params;
  const query = request.nextUrl.searchParams;

  const rawLimit = query.get('limit');
  const parsedLimit = rawLimit === null ? Number.NaN : Number(rawLimit);
  const limit = Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 200)
    : 60;

  const rawLevel = query.get('level');
  const level: LogLevel | 'all' =
    rawLevel && (LOG_LEVELS as readonly string[]).includes(rawLevel)
      ? (rawLevel as LogLevel)
      : 'all';

  const rawBotId = query.get('bot');
  if (rawBotId !== null && rawBotId.length > 0 && !isBotId(rawBotId)) {
    return NextResponse.json({ error: 'Unknown bot id' }, { status: 404 });
  }
  const botId = rawBotId && rawBotId.length > 0 ? rawBotId : null;
  const since = query.get('since');

  const authorization = await authorizeGuild(guildId);
  if (!authorization.ok) return authorizationResponse(authorization);

  try {
    const page = await fetchLogs(guildId, {
      limit,
      level,
      botId,
      since: since && since.length > 0 ? since : null,
    });

    if (page.demo !== authorization.demo) {
      return NextResponse.json(
        { error: 'Dashboard backend is unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    return NextResponse.json(page, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load logs' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
