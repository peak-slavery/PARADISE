import { MongoClient, type Collection, type Db } from 'mongodb';
import {
  MONGO_INDEXES,
  secondaryMongoIndexes,
} from './mongo-indexes.js';
export { AI_CONTEXT_TTL_SECONDS, LOG_TTL_SECONDS } from './mongo-indexes.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';

/**
 * MongoDB holds the high-write, flexible-schema activity data: logs, xp, card
 * game state, inventories and AI conversation context. Kept separate from
 * Supabase so neither free tier is exhausted by the other's write volume.
 */

export interface LogDoc {
  bot_id: string;
  guild_id: string | null;
  channel_id: string | null;
  user_id: string | null;
  action: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  meta: Record<string, unknown>;
  created_at: Date;
}

export interface XpDoc {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  messages: number;
  voice_seconds: number;
  updated_at: Date;
}

export interface CardGameDoc {
  guild_id: string;
  user_id: string;
  deck: string[];
  hand: string[];
  score: number;
  games_played: number;
  games_won: number;
  updated_at: Date;
}

export interface InventoryItem {
  item_id: string;
  name: string;
  quantity: number;
}

export interface InventoryDoc {
  guild_id: string;
  user_id: string;
  items: InventoryItem[];
  updated_at: Date;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  ts: Date;
}

export interface AiContextDoc {
  /** 'ask' = general assistant, 'cyrene' = Honkai: Star Rail persona. */
  scope: 'ask' | 'cyrene';
  guild_id: string;
  user_id: string;
  messages: AiMessage[];
  updated_at: Date;
}

export interface MongoCollections {
  logs: Collection<LogDoc>;
  xp: Collection<XpDoc>;
  card_games: Collection<CardGameDoc>;
  inventories: Collection<InventoryDoc>;
  ai_context: Collection<AiContextDoc>;
}

export interface MongoHandle {
  client: MongoClient;
  db: Db;
  collections: MongoCollections;
}

/**
 * Production Mongo credentials must opt into encrypted transport. Atlas SRV
 * URIs use TLS by default; a standard mongodb:// URI must explicitly request
 * tls=true or ssl=true. Explicit false values are rejected even for SRV URIs.
 */
export function isSecureMongoUri(uri: string): boolean {
  const value = uri.trim();
  const scheme = /^(mongodb(?:\+srv)?):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return false;

  const query = value.includes('?') ? value.slice(value.indexOf('?') + 1).split('#', 1)[0] : '';
  const options = new Map<string, string>();
  for (const part of (query ?? '').split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    options.set(part.slice(0, separator).toLowerCase(), part.slice(separator + 1).toLowerCase());
  }

  if (options.get('tls') === 'false' || options.get('ssl') === 'false') return false;
  return scheme === 'mongodb+srv' || options.get('tls') === 'true' || options.get('ssl') === 'true';
}

export function buildCollections(db: Db): MongoCollections {
  return {
    logs: db.collection<LogDoc>('logs'),
    xp: db.collection<XpDoc>('xp'),
    card_games: db.collection<CardGameDoc>('card_games'),
    inventories: db.collection<InventoryDoc>('inventories'),
    ai_context: db.collection<AiContextDoc>('ai_context'),
  };
}

/**
 * Idempotent index + TTL bootstrap. Safe to call on every boot; Mongo ignores
 * index creation requests that match an existing index.
 */
export async function ensureIndexes(collections: MongoCollections): Promise<void> {
  await Promise.all(MONGO_INDEXES.map(async (index) => {
    await collections[index.collection].createIndex(index.key, { name: index.name, ...index.options });
  }));
}

/**
 * Connects with retry. Returns null if no URI is configured — callers must then
 * degrade gracefully rather than crash.
 */
export async function connectMongo(env: Env, log: Logger): Promise<MongoHandle | null> {
  if (!env.hasMongo || !env.mongodbUri) {
    log.warn('MONGODB_URI not set — activity logging disabled (degraded mode)');
    return null;
  }

  // A configured URI is a production connection: refuse plaintext MongoDB
  // rather than silently sending service data over an unencrypted transport.
  if (!isSecureMongoUri(env.mongodbUri)) {
    log.error('MONGODB_URI must use mongodb+srv:// or explicit tls=true/ssl=true — MongoDB disabled');
    return null;
  }

  const client = new MongoClient(env.mongodbUri, {
    tls: true,
    maxPoolSize: 5, // M0 free tier caps at 500 connections across everything
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await client.connect();
    } catch (err) {
      lastErr = err;
      log.warn({ err, attempt }, 'mongodb connect failed, retrying');
      await new Promise((r) => setTimeout(r, attempt * 1_000));
      continue;
    }

    const db = client.db(env.mongodbDb);
    const collections = buildCollections(db);
    try {
      await ensureIndexes(collections);
    } catch (err) {
      await client.close().catch(() => undefined);
      log.error({ err }, 'mongodb index bootstrap failed — database not ready');
      return null;
    }
    log.info({ db: env.mongodbDb }, 'mongodb connected');
    return { client, db, collections };
  }

  await client.close().catch(() => undefined);
  log.error({ err: lastErr }, 'mongodb unavailable — running in degraded mode');
  return null;
}

/**
 * Optional secondary connection used only for audit/backup logs. It is kept
 * separate from the primary data connection so backup outages cannot block
 * command execution or primary reads.
 */
export async function connectSecondaryMongo(env: Env, log: Logger): Promise<MongoHandle | null> {
  if (!env.hasSecondaryMongo || !env.mongodbSecondaryUri) {
    log.info('secondary MongoDB audit sink is not configured');
    return null;
  }
  if (!isSecureMongoUri(env.mongodbSecondaryUri)) {
    log.error('secondary MongoDB URI is not encrypted — audit backup disabled');
    return null;
  }

  const client = new MongoClient(env.mongodbSecondaryUri, {
    tls: true,
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await client.connect();
    } catch (err) {
      lastErr = err;
      log.warn({ err, attempt }, 'secondary mongodb connect failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      continue;
    }

    const db = client.db(env.mongodbSecondaryDb);
    const collections = buildCollections(db);
    try {
      await Promise.all(secondaryMongoIndexes().map(async (index) => {
        await collections.logs.createIndex(index.key, { name: index.name, ...index.options });
      }));
    } catch (err) {
      await client.close().catch(() => undefined);
      log.error({ err }, 'secondary mongodb index bootstrap failed — audit sink not ready');
      return null;
    }
    log.info({ db: env.mongodbSecondaryDb }, 'secondary mongodb audit sink connected');
    return { client, db, collections };
  }

  await client.close().catch(() => undefined);
  log.error({ err: lastErr }, 'secondary mongodb audit sink unavailable — backup logging disabled');
  return null;
}
