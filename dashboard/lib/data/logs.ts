// Server-only: reads the MongoDB `logs` collection (60-day TTL).
// Never import from a `'use client'` file.

import { demoLogs } from '../demo';
import { getMongoDb } from '../mongo';
import type { LogEntry, LogLevel, LogPage } from '../types';

export const LOG_COLLECTION = 'logs';

export interface LogQuery {
  limit?: number;
  level?: LogLevel | 'all';
  botId?: string | null;
  /** ISO timestamp; only entries strictly newer are returned. */
  since?: string | null;
}

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'critical'];

function defaultLimit(): number {
  return 60;
}

/**
 * Newest-first page of guild activity.
 *
 * Deliberately a plain request/response fetch, not a WebSocket: the dashboard
 * runs serverless and holding N live streams open per guild would exhaust
 * connection limits long before it hit any throughput ceiling. The client
 * polls every 10–15s and passes `since` so each poll transfers only new rows.
 */
export async function fetchLogs(guildId: string, query: LogQuery = {}): Promise<LogPage> {
  const limit = Math.min(Math.max(query.limit ?? defaultLimit(), 1), 200);
  const level = query.level ?? 'all';
  const since = query.since ?? null;

  const db = await getMongoDb();
  if (!db) {
    const entries = demoLogs(guildId, { limit, level, botId: query.botId, since });
    return {
      entries,
      cursor: entries[0]?.created_at ?? null,
      demo: true,
      fetchedAt: new Date().toISOString(),
    };
  }

  const filter: Record<string, unknown> = { guild_id: guildId };
  if (level !== 'all') filter.level = level;
  if (query.botId) filter.bot_id = query.botId;
  if (since) {
    const sinceMs = Date.parse(since);
    if (Number.isFinite(sinceMs)) {
      filter.created_at = { $gt: new Date(sinceMs) };
    }
  }

  const docs = await db
    .collection(LOG_COLLECTION)
    .find(filter, { limit })
    .sort({ created_at: -1 })
    .toArray();

  const entries: LogEntry[] = docs.map((doc) => {
    const record = doc as unknown as Record<string, unknown>;
    const createdAt = record.created_at;
    return {
      id: record._id ? String(record._id) : `${guildId}-${String(createdAt ?? '')}`,
      bot_id: String(record.bot_id ?? ''),
      guild_id: String(record.guild_id ?? guildId),
      channel_id: record.channel_id ? String(record.channel_id) : null,
      user_id: record.user_id ? String(record.user_id) : null,
      action: String(record.action ?? ''),
      level: normalizeLevel(record.level),
      message: String(record.message ?? ''),
      meta: (record.meta && typeof record.meta === 'object'
        ? (record.meta as Record<string, unknown>)
        : {}),
      created_at: createdAt instanceof Date
        ? createdAt.toISOString()
        : new Date(String(createdAt ?? Date.now())).toISOString(),
    };
  });

  return {
    entries,
    cursor: entries[0]?.created_at ?? null,
    demo: false,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeLevel(value: unknown): LogLevel {
  const text = String(value ?? 'info').toLowerCase();
  const match = LOG_LEVELS.find((level) => level === text);
  return match ?? 'info';
}
