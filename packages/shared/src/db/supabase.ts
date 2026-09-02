import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env.js';

/**
 * Supabase is the source of truth for identity, server authorization, bot
 * configuration, moderation records and security events. Relational + RLS.
 *
 * NOTE: every row shape below is a `type`, not an `interface`. supabase-js
 * constrains Row/Insert/Update to `Record<string, unknown>` and TypeScript only
 * grants implicit index signatures to type aliases — using interfaces makes the
 * client silently resolve every query result to `never`.
 */

export type ServerRow = {
  id: string;
  guild_id: string;
  name: string | null;
  icon_url: string | null;
  owner_id: string | null;
  authorized: boolean;
  created_at: string;
  updated_at: string;
};

export type BotConfigRow = {
  id: string;
  guild_id: string;
  bot_id: string;
  config: Record<string, unknown>;
  updated_at: string;
};

export type ModActionRow = {
  id: string;
  guild_id: string;
  bot_id: string;
  action: string;
  target_id: string;
  moderator_id: string;
  reason: string | null;
  duration_seconds: number | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
};

export type SecurityEventRow = {
  id: string;
  guild_id: string;
  event_type: string;
  actor_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
  action_taken: string | null;
  created_at: string;
};

export type AntinukeWhitelistRow = {
  id: string;
  guild_id: string;
  target_type: 'user' | 'role';
  target_id: string;
  created_at: string;
};

export type InternalRequestNonceRow = {
  request_id: string;
  created_at: string;
};

export type BotStateRow = {
  id: string;
  guild_id: string;
  bot_id: string;
  enabled: boolean;
  paused: boolean;
  feature_flags: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

export type ServerSettingsRow = {
  guild_id: string;
  theme: 'light' | 'dark' | 'system';
  notifications_enabled: boolean;
  server_paused: boolean;
  notification_preferences: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

export type GuildWhitelistRow = {
  id: string;
  guild_id: string;
  whitelist_type: 'full' | 'temp' | 'unauthorised';
  expires_at: string | null;
  note: string | null;
  added_by: string | null;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
};

export type SecretRecordRow = {
  id: string;
  name: string;
  provider: 'mongodb' | 'supabase' | 'redis' | 'firebase' | 'cloudflare' | 'core' | 'other';
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  metadata: Record<string, unknown>;
  created_at: string;
  rotated_at: string;
  created_by: string | null;
  revoked_at: string | null;
};

export type ServersInsert = {
  guild_id: string;
  name?: string | null;
  icon_url?: string | null;
  owner_id?: string | null;
  authorized?: boolean;
};

export type BotConfigsInsert = {
  guild_id: string;
  bot_id: string;
  config?: Record<string, unknown>;
};

export type ModActionsInsert = {
  guild_id: string;
  bot_id: string;
  action: string;
  target_id: string;
  moderator_id: string;
  reason?: string | null;
  duration_seconds?: number | null;
  active?: boolean;
  expires_at?: string | null;
};

export type SecurityEventsInsert = {
  guild_id: string;
  event_type: string;
  actor_id: string;
  severity?: SecurityEventRow['severity'];
  details?: Record<string, unknown>;
  action_taken?: string | null;
};

export type AntinukeWhitelistInsert = {
  guild_id: string;
  target_type: AntinukeWhitelistRow['target_type'];
  target_id: string;
};

export type Database = {
  public: {
    Tables: {
      servers: {
        Row: ServerRow;
        Insert: ServersInsert;
        Update: Partial<ServersInsert>;
        Relationships: [];
      };
      bot_configs: {
        Row: BotConfigRow;
        Insert: BotConfigsInsert;
        Update: Partial<BotConfigsInsert>;
        Relationships: [];
      };
      bot_states: {
        Row: BotStateRow;
        Insert: Partial<BotStateRow> & Pick<BotStateRow, 'guild_id' | 'bot_id'>;
        Update: Partial<BotStateRow>;
        Relationships: [];
      };
      server_settings: {
        Row: ServerSettingsRow;
        Insert: Partial<ServerSettingsRow> & Pick<ServerSettingsRow, 'guild_id'>;
        Update: Partial<ServerSettingsRow>;
        Relationships: [];
      };
      guild_whitelists: {
        Row: GuildWhitelistRow;
        Insert: Omit<GuildWhitelistRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<GuildWhitelistRow>;
        Relationships: [];
      };
      secret_records: {
        Row: SecretRecordRow;
        Insert: Omit<SecretRecordRow, 'id' | 'created_at' | 'rotated_at'> & { id?: string; created_at?: string; rotated_at?: string };
        Update: Partial<SecretRecordRow>;
        Relationships: [];
      };
      mod_actions: {
        Row: ModActionRow;
        Insert: ModActionsInsert;
        Update: Partial<ModActionsInsert>;
        Relationships: [];
      };
      security_events: {
        Row: SecurityEventRow;
        Insert: SecurityEventsInsert;
        Update: Partial<SecurityEventsInsert>;
        Relationships: [];
      };
      antinuke_whitelist: {
        Row: AntinukeWhitelistRow;
        Insert: AntinukeWhitelistInsert;
        Update: Partial<AntinukeWhitelistInsert>;
        Relationships: [];
      };
      internal_request_nonces: {
        Row: InternalRequestNonceRow;
        Insert: { request_id: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type TypedSupabase = SupabaseClient<Database>;

export function createSupabase(env: Env): TypedSupabase | null {
  if (!env.hasSupabase || !env.supabaseUrl || !env.supabaseServiceRoleKey) return null;

  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-bot-id': env.botId } },
  });
}

/**
 * Reads a per-guild, per-bot config blob. Returns `fallback` on any failure so
 * bots keep working with defaults when Supabase is unreachable.
 */
export async function readBotConfig<T extends Record<string, unknown>>(
  db: TypedSupabase | null,
  guildId: string,
  botId: string,
  fallback: T,
): Promise<T> {
  if (!db) return fallback;
  try {
    const { data, error } = await db
      .from('bot_configs')
      .select('config')
      .eq('guild_id', guildId)
      .eq('bot_id', botId)
      .maybeSingle();
    if (error || !data) return fallback;
    return { ...fallback, ...(data.config as Partial<T>) };
  } catch {
    return fallback;
  }
}

/** Reads config while preserving whether the backing store was reachable. */
export async function readBotConfigWithStatus<T extends Record<string, unknown>>(
  db: TypedSupabase | null,
  guildId: string,
  botId: string,
  fallback: T,
): Promise<{ config: T; available: boolean }> {
  if (!db) return { config: fallback, available: false };
  try {
    const { data, error } = await db
      .from('bot_configs')
      .select('config')
      .eq('guild_id', guildId)
      .eq('bot_id', botId)
      .maybeSingle();
    if (error) return { config: fallback, available: false };
    return { config: { ...fallback, ...((data?.config ?? {}) as Partial<T>) }, available: true };
  } catch {
    return { config: fallback, available: false };
  }
}

export async function writeBotConfig(
  db: TypedSupabase | null,
  guildId: string,
  botId: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  if (!db) return false;
  const { error } = await db
    .from('bot_configs')
    .upsert({ guild_id: guildId, bot_id: botId, config }, { onConflict: 'guild_id,bot_id' });
  return !error;
}
