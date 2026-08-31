import type { Collection } from 'mongodb';

/**
 * Mongo document shapes owned by Zoro.
 *
 * `@eiflow/shared` exposes a fixed `MongoCollections` map (logs, xp,
 * card_games, inventories, ai_context). Zoro needs two more: `member_trust` and
 * `guild_snapshots`. Rather than editing the shared package — which every other
 * bot depends on — we reach the `Db` through `Collection.db` and register our
 * own typed collections. No new dependency, no shared-code churn.
 *
 * Every shape is an `interface` on purpose: they are only ever used as Mongo
 * type parameters, never as generic `Record<string, unknown>` arguments.
 */

/* ------------------------------------------------------------------ */
/* Trust                                                              */
/* ------------------------------------------------------------------ */

/**
 * Persisted per-member trust. We store *counters*, not a bare score, so the
 * score can be recomputed with time decay without rewriting history.
 */
export interface MemberTrustDoc {
  guild_id: string;
  user_id: string;
  /** Messages observed that produced no incident (clean-behaviour credit). */
  clean_messages: number;
  incidents_low: number;
  incidents_medium: number;
  incidents_high: number;
  incidents_critical: number;
  /** Guild-join timestamp, used for the tenure component. Null when unknown. */
  joined_at: Date | null;
  last_incident_at: Date | null;
  /** Last computed score, cached so reads do not need to recompute. */
  score: number;
  updated_at: Date;
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                          */
/* ------------------------------------------------------------------ */

export interface SnapshotOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

export interface SnapshotRole {
  id: string;
  name: string;
  color: number;
  permissions: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
}

export interface SnapshotChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  overwrites: SnapshotOverwrite[];
}

export interface SnapshotGuildSettings {
  name: string;
  verification_level: number;
  default_message_notifications: number;
  explicit_content_filter: number;
  afk_channel_id: string | null;
  afk_timeout: number;
  system_channel_id: string | null;
  rules_channel_id: string | null;
}

export interface GuildSnapshotPayload {
  guild: SnapshotGuildSettings;
  roles: SnapshotRole[];
  channels: SnapshotChannel[];
}

export interface GuildSnapshotDoc {
  guild_id: string;
  reason: string;
  created_by: string | null;
  created_at: Date;
  payload: GuildSnapshotPayload;
}

export interface ZoroCollections {
  member_trust: Collection<MemberTrustDoc>;
  guild_snapshots: Collection<GuildSnapshotDoc>;
}
