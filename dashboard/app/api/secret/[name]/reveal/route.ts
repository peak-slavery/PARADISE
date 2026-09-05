import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, boundedJson } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { getMongoDb } from '@/lib/mongo';
import { loadSecret } from '@/lib/secret-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reveal quota.
 *
 * Revealing a secret is the single highest-blast-radius action on the platform:
 * one stolen master session could otherwise drain every provider credential in
 * a few seconds. The quota is derived from the existing audit trail rather than
 * an in-process counter, because the dashboard runs serverless — per-instance
 * memory does not survive between invocations and would be trivially bypassed.
 */
const REVEAL_LIMIT = 5;
const REVEAL_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const parsed = await boundedJson<{ reason?: unknown }>(request, 4 * 1024);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (reason.length < 3) return NextResponse.json({ error: 'A reveal reason is required' }, { status: 400 });
  const { name } = await params;
  try {
    // The audit store doubles as the quota store, so the check needs no extra
    // persistence and stays correct across serverless invocations. Fail closed:
    // never reveal a secret we are unable to record.
    const db = await getMongoDb();
    if (!db) return NextResponse.json({ error: 'Reveal audit storage is unavailable' }, { status: 503 });

    const since = new Date(Date.now() - REVEAL_WINDOW_MS);
    // `limit` caps the scan — only the ceiling matters, not the exact total.
    const recent = await db.collection('logs').countDocuments(
      { action: 'secret.reveal', user_id: access.userId, created_at: { $gte: since } },
      { limit: REVEAL_LIMIT },
    );
    if (recent >= REVEAL_LIMIT) {
      return NextResponse.json(
        { error: 'Reveal rate limit exceeded' },
        { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '900' } },
      );
    }

    const value = await loadSecret(name);
    if (value === null) return NextResponse.json({ error: 'Secret not found' }, { status: 404 });

    await db.collection('logs').insertOne({
      bot_id: 'dashboard',
      guild_id: null,
      channel_id: null,
      user_id: access.userId,
      action: 'secret.reveal',
      level: 'critical',
      message: 'A secret was revealed by the master operator',
      meta: {
        secret_name: name,
        reason,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      },
      created_at: new Date(),
    });
    return NextResponse.json({ name, value }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Secret vault is unavailable' }, { status: 503 });
  }
}
