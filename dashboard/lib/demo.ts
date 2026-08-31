// ---------------------------------------------------------------------------
// Demo mode
//
// The dashboard must be renderable with zero credentials. When any of
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MONGODB_URI are
// absent, the data accessors in this folder fall back to the fixtures below
// instead of opening a connection. This is the *only* place fixtures live.
//
// Everything here is server-side. `demoMode()` is safe to call from a server
// component to render a "demo data" banner.
// ---------------------------------------------------------------------------

import type {
  LogEntry,
  LogLevel,
  SecurityEventRow,
  SecuritySeverity,
  ServerRow,
  UserRow,
} from './types';

export type Backend = 'supabase' | 'mongo' | 'hmac';

export interface CredentialStatus {
  supabase: boolean;
  mongo: boolean;
  hmac: boolean;
  /** True when at least one store is unconfigured and fixtures are in use. */
  demo: boolean;
}

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Single source of truth for "are we live or are we on fixtures?".
 * Evaluated per call (not cached) so a dev can drop a `.env.local` in and
 * reload without restarting the type checker or clearing a module cache.
 */
export function credentials(): CredentialStatus {
  const supabase =
    present(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    present(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const mongo = present(process.env.MONGODB_URI);
  const hmac = present(process.env.HMAC_SECRET) || present(process.env.HMAC_SECRETS_JSON);
  return { supabase, mongo, hmac, demo: !supabase || !mongo };
}

/** True when fixtures are being served for any part of the app. */
export function demoMode(): boolean {
  return credentials().demo;
}

/** True when fixtures would be used for the named backend. */
export function useFixtures(backend: Backend): boolean {
  const status = credentials();
  if (backend === 'supabase') return !status.supabase;
  if (backend === 'mongo') return !status.mongo;
  return !status.hmac;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, fast, deterministic. Keeps fixtures stable per index. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[], fallback: T): T {
  if (items.length === 0) return fallback;
  const index = Math.floor(rand() * items.length);
  return items[index] ?? fallback;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const DEMO_USER: UserRow = {
  id: '00000000-0000-4000-8000-000000000001',
  discord_id: '184617893241159680',
  username: 'eipoint.keeper',
  avatar_url: null,
  is_owner: true,
  created_at: '2024-03-02T09:14:00.000Z',
  updated_at: '2026-08-24T17:02:00.000Z',
};

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export const DEMO_SERVERS: readonly ServerRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    guild_id: '849213847293847021',
    name: 'Ei Point Gardens',
    icon_url: null,
    owner_id: DEMO_USER.discord_id,
    authorized: true,
    created_at: '2024-03-02T09:20:00.000Z',
    updated_at: '2026-08-28T11:45:00.000Z',
  },
];

export function demoServers(): ServerRow[] {
  return DEMO_SERVERS.map((server) => ({ ...server }));
}

export function demoServer(guildId: string): ServerRow | null {
  const found = DEMO_SERVERS.find((server) => server.guild_id === guildId);
  return found ? { ...found } : null;
}

// ---------------------------------------------------------------------------
// Bot configs — light overrides so each tab reads as "already set up"
// ---------------------------------------------------------------------------

const DEMO_CONFIGS: Record<string, Record<string, Record<string, unknown>>> = {
  '849213847293847021': {
    shanks: { logChannel: '#mod-log', muteRole: 'Muted', requireReason: true, dmTargets: true, defaultMuteMinutes: 120, warnThreshold: 3, escalation: 'mute', autoMod: true, maxMentions: 6, bannedWords: 'discord.gg/\nfree nitro' },
    sanji: { defaultChannel: '#logs', messageChannel: '#message-logs', memberChannel: '#member-logs', voiceChannel: '', logEdits: true, logDeletes: true, logJoins: true, logVoice: false, storeBulk: 30, retentionDays: 60 },
    zoro: { enabled: true, alert_channel: '#security', mode: 'revert', banThreshold: 3, channelThreshold: 2, roleThreshold: 4, windowSeconds: 60, punishment: 'ban', protectWebhooks: true, automodSlm: true, slmThreshold: 0.75, lockdownOnRaid: false, snapshotOnChange: true, trustMode: true },
    boahancock: { enabled: true, channel: '#general', message: 'Welcome {user} to **{server}** — you are member #{count}.', sendLeave: true, leaveMessage: '{user} has left {server}.', embed: true, cardColor: 'pink', autoRole: 'Member', deleteAfter: 0 },
    nami: { enabled: true, announceChannel: '#levels', xpPerMessage: 15, cooldownSeconds: 60, curve: 'quadratic', baseXp: 100, noXpChannels: '#bot-commands', announceEmbed: true, leaderboardSize: 10 },
    luffy: { enabled: true, channels: '#card-games', handSize: 5, turnSeconds: 120, stake: 10, startingCredits: 100, allowTrades: true, dailyBonus: 50, rarityWeights: 'standard' },
    'niko-robin': { enabled: true, provider: 'brave', safeSearch: true, resultCount: 5, cacheTtl: 900, timeoutMs: 4000, cooldownSeconds: 10, channels: '#search', ephemeral: false },
    cyrene: { enabled: true, cyreneModel: 'openai/gpt-oss-20b', assistantModel: 'mistral-small-latest', contextMessages: 12, cooldownSeconds: 15, channels: '#ai', ephemeral: true },
  },
};

export function demoConfig(guildId: string, botId: string): Record<string, unknown> {
  const perGuild = DEMO_CONFIGS[guildId];
  const config = perGuild?.[botId];
  return config ? { ...config } : {};
}

// ---------------------------------------------------------------------------
// Logs (MongoDB `logs` fixture)
// ---------------------------------------------------------------------------

const LOG_TEMPLATES: readonly {
  bot: string;
  action: string;
  level: LogLevel;
  message: string;
}[] = [
  { bot: 'shanks', action: 'warn.issued', level: 'warn', message: 'warned @staticnoise for spam (case #482)' },
  { bot: 'shanks', action: 'mute.applied', level: 'warn', message: 'muted @vexling for 120m — repeated pings' },
  { bot: 'shanks', action: 'automod.trigger', level: 'warn', message: 'blocked phrase from @dropkick in #general' },
  { bot: 'shanks', action: 'purge.completed', level: 'info', message: 'purged 37 messages from #off-topic' },
  { bot: 'sanji', action: 'message.delete', level: 'info', message: 'message deleted in #showcase by @marrow' },
  { bot: 'sanji', action: 'message.edit', level: 'debug', message: 'message edited in #dev by @quill' },
  { bot: 'sanji', action: 'member.join', level: 'info', message: '@lantern joined the server (member #8,412)' },
  { bot: 'sanji', action: 'member.leave', level: 'info', message: '@hollow left after 214 days' },
  { bot: 'sanji', action: 'voice.session', level: 'debug', message: 'voice session closed in General — 42m' },
  { bot: 'zoro', action: 'threshold.hit', level: 'critical', message: 'mass-ban threshold hit by @brightburglar — reverted 3 bans' },
  { bot: 'zoro', action: 'channel.reverted', level: 'error', message: 'restored #announcements after unauthorized delete' },
  { bot: 'zoro', action: 'webhook.blocked', level: 'warn', message: 'webhook creation blocked in #media' },
  { bot: 'zoro', action: 'slm.flag', level: 'warn', message: 'SLM flagged evasive bad word from @dropkick (0.91)' },
  { bot: 'zoro', action: 'lockdown', level: 'critical', message: 'server lockdown engaged during mass-ban raid' },
  { bot: 'boahancock', action: 'welcome.sent', level: 'info', message: 'welcome card rendered for @fernway' },
  { bot: 'boahancock', action: 'welcome.test', level: 'debug', message: '/testwelcome preview sent to @eipoint.keeper' },
  { bot: 'nami', action: 'level.up', level: 'info', message: '@quill reached level 24 in #levels' },
  { bot: 'nami', action: 'leaderboard.built', level: 'debug', message: 'leaderboard page 1 rendered (10 rows)' },
  { bot: 'luffy', action: 'match.start', level: 'info', message: 'match started — @marrow vs @lantern (ante 10)' },
  { bot: 'luffy', action: 'match.end', level: 'info', message: '@lantern won 3–2 and banked 20 credits' },
  { bot: 'luffy', action: 'inventory.updated', level: 'debug', message: 'inventory write flushed (4 cards)' },
  { bot: 'niko-robin', action: 'query.ok', level: 'info', message: '/search "vercel edge caching" — 5 results in 812ms' },
  { bot: 'niko-robin', action: 'query.cache', level: 'debug', message: '/search served from Redis cache' },
  { bot: 'niko-robin', action: 'provider.failover', level: 'error', message: 'Brave timed out after 4000ms — failed over to DuckDuckGo' },
  { bot: 'cyrene', action: 'ask.ok', level: 'info', message: '/ask answered in 1.4s using mistral (12 context msgs)' },
  { bot: 'cyrene', action: 'cyrene.ok', level: 'info', message: '/cyrene replied in 1.1s using groq gpt-oss' },
  { bot: 'cyrene', action: 'context.reset', level: 'info', message: '/reset cleared context for @fernway' },
  { bot: 'cyrene', action: 'queue.saturated', level: 'warn', message: 'AI queue at capacity — request deferred 900ms' },
];

const DEMO_CHANNELS: readonly string[] = [
  '849213847293847101',
  '849213847293847102',
  '849213847293847103',
  '849213847293847104',
];

const DEMO_USERS: readonly string[] = [
  '184617893241159680',
  '294817264019283471',
  '501928374615263847',
  '618273940182736455',
  '726384051927364819',
  '834950162038475920',
];

/** How many fixture entries exist in the rolling pool. */
const LOG_POOL_SIZE = 90;
/** Nominal gap between fixture entries; polls land inside it and see new rows. */
const LOG_SPACING_MS = 9_000;

function buildLogEntry(guildId: string, index: number, now: number): LogEntry {
  const rand = seeded(index * 2654435761 + guildId.length * 97);
  const template = pick(rand, LOG_TEMPLATES, LOG_TEMPLATES[0]!);
  const jitter = Math.floor(rand() * 4_500);
  const createdAt = now - index * LOG_SPACING_MS - jitter;
  return {
    id: `demo-${guildId}-${index}`,
    bot_id: template.bot,
    guild_id: guildId,
    channel_id: pick(rand, DEMO_CHANNELS, DEMO_CHANNELS[0]!),
    user_id: pick(rand, DEMO_USERS, DEMO_USERS[0]!),
    action: template.action,
    level: template.level,
    message: template.message,
    meta: { fixture: true, source: 'demo' },
    created_at: new Date(createdAt).toISOString(),
  };
}

export interface DemoLogQuery {
  limit?: number;
  level?: LogLevel | 'all';
  botId?: string | null;
  /** ISO timestamp; only entries strictly newer are returned. */
  since?: string | null;
}

/**
 * A rolling pool of fixture logs anchored to `Date.now()`. Because the
 * timestamps are recomputed on every call, successive polls naturally surface
 * one or two "new" entries — which is exactly what the polling UI is testing.
 */
export function demoLogs(guildId: string, query: DemoLogQuery = {}): LogEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 200);
  const now = Date.now();
  const sinceMs = query.since ? Date.parse(query.since) : Number.NaN;

  const entries: LogEntry[] = [];
  for (let index = 0; index < LOG_POOL_SIZE; index += 1) {
    const entry = buildLogEntry(guildId, index, now);
    const createdMs = Date.parse(entry.created_at);
    if (Number.isFinite(sinceMs) && createdMs <= sinceMs) continue;
    if (query.level && query.level !== 'all' && entry.level !== query.level) continue;
    if (query.botId && entry.bot_id !== query.botId) continue;
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Security events (Supabase `security_events` fixture)
// ---------------------------------------------------------------------------

interface SecurityTemplate {
  event_type: string;
  actor_id: string;
  severity: SecuritySeverity;
  action_taken: string;
  details: Record<string, unknown>;
  /** Minutes ago. */
  ago: number;
}

const SECURITY_TEMPLATES: readonly SecurityTemplate[] = [
  {
    event_type: 'mass_ban',
    actor_id: '294817264019283471',
    severity: 'critical',
    action_taken: 'actor banned, 3 bans reverted',
    details: { count: 3, windowSeconds: 60, threshold: 3, reverted: 3 },
    ago: 42,
  },
  {
    event_type: 'channel_delete',
    actor_id: '501928374615263847',
    severity: 'high',
    action_taken: 'channel restored, roles stripped',
    details: { channel: '#announcements', count: 2, reverted: true },
    ago: 186,
  },
  {
    event_type: 'role_create',
    actor_id: '618273940182736455',
    severity: 'high',
    action_taken: 'roles deleted, actor quarantined',
    details: { count: 4, threshold: 4, names: ['@everyone-ping', 'nuke-a', 'nuke-b', 'nuke-c'] },
    ago: 512,
  },
  {
    event_type: 'webhook_create',
    actor_id: '726384051927364819',
    severity: 'medium',
    action_taken: 'webhook deleted',
    details: { channel: '#media', count: 1 },
    ago: 1_490,
  },
  {
    event_type: 'mass_kick',
    actor_id: '834950162038475920',
    severity: 'critical',
    action_taken: 'actor kicked, 5 kicks flagged',
    details: { count: 5, windowSeconds: 120, threshold: 5 },
    ago: 2_880,
  },
  {
    event_type: 'permission_escalation',
    actor_id: '294817264019283471',
    severity: 'high',
    action_taken: 'role reassigned to Administrator, logged',
    details: { role: 'Temp Mod', permission: 'ADMINISTRATOR' },
    ago: 4_320,
  },
  {
    event_type: 'invite_spam',
    actor_id: '501928374615263847',
    severity: 'low',
    action_taken: 'messages deleted',
    details: { count: 6, channels: ['#general', '#off-topic'] },
    ago: 7_400,
  },
  {
    event_type: 'bot_added',
    actor_id: '618273940182736455',
    severity: 'medium',
    action_taken: 'bot removed pending review',
    details: { bot: 'unknown-bot#4412', hasAdmin: true },
    ago: 10_080,
  },
  {
    event_type: 'mass_ban',
    actor_id: '726384051927364819',
    severity: 'medium',
    action_taken: 'below threshold, notified only',
    details: { count: 2, windowSeconds: 60, threshold: 3 },
    ago: 14_400,
  },
];

export function demoSecurityEvents(guildId: string): SecurityEventRow[] {
  const now = Date.now();
  return SECURITY_TEMPLATES.map((template, index) => ({
    id: `00000000-0000-4000-8000-00000000${String(200 + index).padStart(4, '0')}`,
    guild_id: guildId,
    event_type: template.event_type,
    actor_id: template.actor_id,
    severity: template.severity,
    details: template.details,
    action_taken: template.action_taken,
    created_at: new Date(now - template.ago * 60_000).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Mod actions (used by the moderation tab summary)
// ---------------------------------------------------------------------------

export function demoModActionCounts(guildId: string): Record<string, number> {
  const rand = seeded(guildId.length * 7717);
  return {
    warn: 40 + Math.floor(rand() * 60),
    mute: 12 + Math.floor(rand() * 30),
    ban: 3 + Math.floor(rand() * 12),
    kick: 5 + Math.floor(rand() * 20),
    purge: 2 + Math.floor(rand() * 15),
    automod: 60 + Math.floor(rand() * 140),
  };
}
