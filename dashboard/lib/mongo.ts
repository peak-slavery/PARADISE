import { MongoClient, type Db } from 'mongodb';

import { credentials } from './demo';

/**
 * Server-only MongoDB access.
 *
 * The URI is read exclusively from `process.env` inside this module (never
 * inlined into a client bundle — no `NEXT_PUBLIC_` prefix) and the promise is
 * cached on `globalThis` so the dev server's hot reload doesn't open a new
 * pool on every edit.
 */

const GLOBAL_KEY = '__eiflowMongoClientPromise';

type GlobalWithMongo = typeof globalThis & {
  [GLOBAL_KEY]?: Promise<MongoClient>;
};

const globalForMongo = globalThis as GlobalWithMongo;

/**
 * Live Mongo credentials must use encrypted transport. Atlas SRV URIs imply
 * TLS; a standard mongodb:// URI must explicitly request tls=true or ssl=true.
 * Explicit false values are rejected even for SRV URIs.
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

export function mongoDbName(): string {
  return process.env.MONGODB_DB || 'eiflow';
}

/** Returns `null` when `MONGODB_URI` is unset — callers use fixtures instead. */
export function getMongoClient(): Promise<MongoClient> | null {
  if (!credentials().mongo) return null;
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  const existing = globalForMongo[GLOBAL_KEY];
  if (existing) return existing;

  // A configured URI is a live connection: reject plaintext MongoDB rather
  // than allowing service data to travel over an unencrypted transport.
  if (!isSecureMongoUri(uri)) {
    throw new Error('MONGODB_URI must use mongodb+srv:// or explicit tls=true/ssl=true');
  }

  const client = new MongoClient(uri, {
    tls: true,
    // Serverless-friendly: fail fast rather than holding a request open.
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 5,
  });

  const promise = client.connect().catch((error: unknown) => {
    // Clear the cache so the next request retries instead of permanently
    // rejecting with the same stale error.
    delete globalForMongo[GLOBAL_KEY];
    throw error;
  });

  globalForMongo[GLOBAL_KEY] = promise;
  return promise;
}

/** Convenience wrapper; still `null` when Mongo is unconfigured. */
export async function getMongoDb(): Promise<Db | null> {
  const clientPromise = getMongoClient();
  if (!clientPromise) return null;
  const client = await clientPromise;
  return client.db(mongoDbName());
}
