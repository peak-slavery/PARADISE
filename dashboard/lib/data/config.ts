// Server-only: reads and writes `public.bot_configs` (RLS-scoped to guilds the
// caller owns). Never import from a `'use client'` file.

import { credentials, demoConfig } from '../demo';
import { createSupabaseServerClient } from '../supabase/server';
import { getBot } from '../bots';
import type { ConfigValues } from '../types';

export interface ConfigResult {
  /** Merged defaults + stored overrides, so the form always renders complete. */
  values: ConfigValues;
  updatedAt: string | null;
  demo: boolean;
}

function mergeConfig(
  botId: string,
  stored: Record<string, unknown>,
): ConfigValues {
  const bot = getBot(botId);
  const values: ConfigValues = {};
  for (const field of bot.fields) {
    const raw = stored[field.key];
    if (raw === undefined || raw === null) {
      values[field.key] = field.default;
      continue;
    }
    switch (field.type) {
      case 'boolean':
        values[field.key] = typeof raw === 'boolean' ? raw : raw === 'true' || raw === 1;
        break;
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        values[field.key] = Number.isFinite(num) ? num : field.default;
        break;
      }
      default:
        values[field.key] = typeof raw === 'string' ? raw : String(raw);
        break;
    }
  }
  return values;
}

/** Fixture config for a (guild, bot), with any in-session save applied. */
function demoValues(guildId: string, botId: string): ConfigValues {
  const base = demoConfig(guildId, botId);
  const override = readDemoOverride(guildId, botId);
  return mergeConfig(botId, override ? { ...base, ...override } : base);
}

export async function getBotConfig(guildId: string, botId: string): Promise<ConfigResult> {
  if (!credentials().supabase) {
    return { values: demoValues(guildId, botId), updatedAt: null, demo: true };
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return { values: demoValues(guildId, botId), updatedAt: null, demo: true };
  }

  const { data, error } = await supabase
    .from('bot_configs')
    .select('config, updated_at')
    .eq('guild_id', guildId)
    .eq('bot_id', botId)
    .maybeSingle();

  if (error) {
    return { values: mergeConfig(botId, {}), updatedAt: null, demo: false };
  }

  const row = data as { config: Record<string, unknown> | null; updated_at: string } | null;
  return {
    values: mergeConfig(botId, row?.config ?? {}),
    updatedAt: row?.updated_at ?? null,
    demo: false,
  };
}

export interface SaveResult {
  ok: boolean;
  demo: boolean;
  updatedAt: string | null;
  error?: string;
}

/**
 * Upsert on the `(guild_id, bot_id)` unique index. RLS
 * (`bot_configs_owner_rw`) rejects the write unless the caller owns the guild,
 * which is the only authorization check we need.
 */
export async function saveBotConfig(
  guildId: string,
  botId: string,
  values: ConfigValues,
): Promise<SaveResult> {
  if (!credentials().supabase) {
    saveDemoConfig(guildId, botId, values);
    return { ok: true, demo: true, updatedAt: new Date().toISOString() };
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    saveDemoConfig(guildId, botId, values);
    return { ok: true, demo: true, updatedAt: new Date().toISOString() };
  }

  const { data, error } = await supabase
    .from('bot_configs')
    .upsert(
      { guild_id: guildId, bot_id: botId, config: values, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id,bot_id' },
    )
    .select('updated_at')
    .maybeSingle();

  if (error) {
    return { ok: false, demo: false, updatedAt: null, error: error.message };
  }

  const row = data as { updated_at: string } | null;
  return { ok: true, demo: false, updatedAt: row?.updated_at ?? new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Demo persistence: in-memory so a save visibly "sticks" for the session
// without pretending to have a database.
// ---------------------------------------------------------------------------

const DEMO_OVERRIDES = new Map<string, Record<string, unknown>>();

function demoKey(guildId: string, botId: string): string {
  return `${guildId}::${botId}`;
}

function saveDemoConfig(guildId: string, botId: string, values: ConfigValues): void {
  DEMO_OVERRIDES.set(demoKey(guildId, botId), { ...values });
}

/** Read back a demo override, if one was saved this session. */
export function readDemoOverride(
  guildId: string,
  botId: string,
): Record<string, unknown> | null {
  return DEMO_OVERRIDES.get(demoKey(guildId, botId)) ?? null;
}
