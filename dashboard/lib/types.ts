// ---------------------------------------------------------------------------
// Domain types for the Ei Point control plane.
//
// These mirror `infra/supabase/schema.sql` (Postgres, RLS-protected) and the
// MongoDB collections declared in `infra/mongo/init.js`. Nothing here imports
// `@eiflow/shared` — that package pulls in discord.js and must never reach a
// browser bundle.
// ---------------------------------------------------------------------------

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export type ModActionType =
  | 'warn'
  | 'mute'
  | 'unmute'
  | 'ban'
  | 'unban'
  | 'purge'
  | 'kick'
  | 'automod';

/** `public.users` — dashboard identity, 1:1 with a Supabase Auth user. */
export interface UserRow {
  id: string;
  discord_id: string;
  username: string | null;
  avatar_url: string | null;
  is_owner: boolean;
  created_at: string;
  updated_at: string;
}

/** `public.servers` — the authorization gate for the whole ecosystem. */
export interface ServerRow {
  id: string;
  guild_id: string;
  name: string | null;
  icon_url: string | null;
  owner_id: string | null;
  authorized: boolean;
  created_at: string;
  updated_at: string;
}

/** `public.bot_configs` — one JSON blob per (guild, bot). */
export interface BotConfigRow {
  id: string;
  guild_id: string;
  bot_id: string;
  config: Record<string, unknown>;
  updated_at: string;
}

/** `public.mod_actions` — append-mostly moderation audit trail. */
export interface ModActionRow {
  id: string;
  guild_id: string;
  bot_id: string;
  action: ModActionType;
  target_id: string;
  moderator_id: string;
  reason: string | null;
  duration_seconds: number | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

/** `public.security_events` — antinuke incident log. */
export interface SecurityEventRow {
  id: string;
  guild_id: string;
  event_type: string;
  actor_id: string;
  severity: SecuritySeverity;
  details: Record<string, unknown>;
  action_taken: string | null;
  created_at: string;
}

/** `public.antinuke_whitelist` — users/roles exempt from enforcement. */
export interface WhitelistRow {
  id: string;
  guild_id: string;
  target_type: 'user' | 'role';
  target_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// MongoDB — high-volume activity data
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** `logs` collection. 60-day TTL (see infra/mongo/init.js). */
export interface LogEntry {
  id: string;
  bot_id: string;
  guild_id: string;
  channel_id: string | null;
  user_id: string | null;
  action: string;
  level: LogLevel;
  message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** A page of logs returned to the client by `/api/logs/[guildId]`. */
export interface LogPage {
  entries: LogEntry[];
  /** ISO timestamp of the newest entry returned; used for incremental polling. */
  cursor: string | null;
  /** True when the data came from in-repo fixtures rather than MongoDB. */
  demo: boolean;
  /** Wall-clock time the page was produced (ISO). */
  fetchedAt: string;
}

/** `xp` collection — Level Up bot progression. */
export interface XpEntry {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  updated_at: string;
}

/** `card_games` collection. */
export interface CardGameDoc {
  guild_id: string;
  channel_id: string;
  players: string[];
  state: Record<string, unknown>;
  updated_at: string;
}

/** `inventories` collection — per-user card holdings. */
export interface InventoryDoc {
  guild_id: string;
  user_id: string;
  cards: string[];
  updated_at: string;
}

/** `ai_context` collection — rolling conversation window for the AI bot. */
export interface AiContextDoc {
  guild_id: string;
  user_id: string;
  messages: { role: 'user' | 'assistant'; content: string; at: string }[];
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Config schema plumbing
// ---------------------------------------------------------------------------

/**
 * Every bot stores a single free-form JSON blob in `bot_configs.config`.
 * These descriptors let one generic form component render (and validate) all
 * eight panels without eight bespoke screens.
 */
export type ConfigField =
  | {
      key: string;
      label: string;
      help?: string;
      type: 'boolean';
      default: boolean;
    }
  | {
      key: string;
      label: string;
      help?: string;
      type: 'number';
      default: number;
      min?: number;
      max?: number;
      step?: number;
      suffix?: string;
    }
  | {
      key: string;
      label: string;
      help?: string;
      type: 'text';
      default: string;
      placeholder?: string;
    }
  | {
      key: string;
      label: string;
      help?: string;
      type: 'textarea';
      default: string;
      placeholder?: string;
      rows?: number;
    }
  | {
      key: string;
      label: string;
      help?: string;
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    };

export type ConfigValues = Record<string, string | number | boolean>;
