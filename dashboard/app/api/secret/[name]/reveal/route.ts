import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, invalidJsonResponse } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { getMongoDb } from '@/lib/mongo';
import { loadSecret } from '@/lib/secret-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  let body: { reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (reason.length < 3) return NextResponse.json({ error: 'A reveal reason is required' }, { status: 400 });
  const { name } = await params;
  try {
    const value = await loadSecret(name);
    if (value === null) return NextResponse.json({ error: 'Secret not found' }, { status: 404 });
    const db = await getMongoDb();
    if (!db) return NextResponse.json({ error: 'Reveal audit storage is unavailable' }, { status: 503 });
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
