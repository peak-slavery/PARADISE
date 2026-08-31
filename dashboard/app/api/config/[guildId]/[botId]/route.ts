import { NextResponse, type NextRequest } from 'next/server';

import { getBot, isBotId } from '@/lib/bots';
import { getBotConfig, saveBotConfig } from '@/lib/data/config';
import { credentials } from '@/lib/demo';
import { createSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server';
import { getServer } from '@/lib/data/servers';
import type { ConfigValues } from '@/lib/types';

// Writes go through the cookie session, so this route must never be cached.
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
  if (!status.supabase) {
    return hasConfiguredEnvironment()
      ? { ok: false, status: 503, error: 'Dashboard backend is not configured' }
      : { ok: true, demo: true };
  }

  try {
    if (!(await createSupabaseServerClient())) {
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guildId: string; botId: string }> },
) {
  const { guildId, botId } = await params;

  if (!isBotId(botId)) {
    return NextResponse.json({ error: 'Unknown bot id' }, { status: 404 });
  }

  const authorization = await authorizeGuild(guildId);
  if (!authorization.ok) return authorizationResponse(authorization);

  try {
    const { values, updatedAt, demo } = await getBotConfig(guildId, botId);
    if (demo !== authorization.demo) {
      return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
    }
    return NextResponse.json({ config: values, updatedAt, demo });
  } catch {
    return NextResponse.json({ error: 'Unable to load configuration' }, { status: 503 });
  }
}

/**
 * Save a bot config.
 *
 * The incoming object is *not* trusted: only keys declared in the bot's field
 * schema survive, and each survivor is coerced to its declared type. That is
 * what makes it safe to write the result straight into a jsonb column.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ guildId: string; botId: string }> },
) {
  const { guildId, botId } = await params;

  if (!isBotId(botId)) {
    return NextResponse.json({ error: 'Unknown bot id' }, { status: 404 });
  }

  const authorization = await authorizeGuild(guildId);
  if (!authorization.ok) return authorizationResponse(authorization);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const candidate = (body as { config?: unknown } | null)?.config;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return NextResponse.json({ error: 'Expected a `config` object' }, { status: 400 });
  }

  const incoming = candidate as Record<string, unknown>;
  const bot = getBot(botId);
  const clean: ConfigValues = {};

  for (const field of bot.fields) {
    const raw = incoming[field.key];
    if (raw === undefined) continue;

    switch (field.type) {
      case 'boolean':
        clean[field.key] = raw === true || raw === 'true' || raw === 1;
        break;

      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) continue;
        const min = field.min ?? Number.NEGATIVE_INFINITY;
        const max = field.max ?? Number.POSITIVE_INFINITY;
        clean[field.key] = Math.min(Math.max(num, min), max);
        break;
      }

      case 'select': {
        const allowed = field.options.some((option) => option.value === raw);
        if (!allowed) continue;
        clean[field.key] = String(raw);
        break;
      }

      case 'text':
      case 'textarea':
      default:
        clean[field.key] = typeof raw === 'string' ? raw.slice(0, 4000) : String(raw);
        break;
    }
  }

  try {
    const result = await saveBotConfig(guildId, botId, clean);

    if (!result.ok || result.demo !== authorization.demo) {
      return NextResponse.json(
        { error: result.ok ? 'Dashboard backend is unavailable' : 'Write rejected' },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      demo: result.demo,
      updatedAt: result.updatedAt,
      config: clean,
    });
  } catch {
    return NextResponse.json({ error: 'Unable to save configuration' }, { status: 503 });
  }
}
