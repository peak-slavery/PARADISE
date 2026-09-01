import { NextResponse, type NextRequest } from 'next/server';

import { authorizeGuild, type GuildAuthorization } from '@/lib/authz';
import { LOG_LEVELS, fetchLogs } from '@/lib/data/logs';
import { isBotId } from '@/lib/bots';
import type { LogLevel } from '@/lib/types';

// The MongoDB driver needs the Node runtime, and a live stream must never be
// cached by the router cache.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
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
