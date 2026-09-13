import { NextResponse, type NextRequest } from 'next/server';
import { MongoClient } from 'mongodb';

import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const token = process.env.DASHBOARD_HEALTH_TOKEN?.trim();
  return Boolean(token && request.headers.get('authorization') === `Bearer ${token}`);
}

async function withTimeout<T>(promise: PromiseLike<T>): Promise<T | false> {
  try {
    return await Promise.race([
      promise,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000).unref()),
    ]);
  } catch {
    return false;
  }
}

async function checkSupabase(): Promise<boolean> {
  const client = createSupabaseAdminClient();
  if (!client) return false;
  const result = await withTimeout(client.from('servers').select('id').limit(1).then(({ error }) => !error));
  return result === true;
}

async function checkMongo(): Promise<boolean> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return false;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 2_000,
    maxPoolSize: 1,
    minPoolSize: 0,
    tls: uri.includes('mongodb+srv://'),
  });
  try {
    const result = await withTimeout(client.connect().then(() => client.db(process.env.MONGODB_DB || 'eiflow').command({ ping: 1 })).then(() => true));
    return result === true;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function checkRedis(): Promise<boolean> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!base || !token) return false;
  try {
    const result = await withTimeout(fetch(`${base}/ping`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).then((response) => response.ok));
    return result === true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ status: 'starting' }, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const [supabase, mongo, redis] = await Promise.all([
    checkSupabase(),
    checkMongo(),
    checkRedis(),
  ]);
  const status = supabase && mongo && redis ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, db_connections: { supabase, mongo, redis } },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
