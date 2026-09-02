import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, invalidJsonResponse } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { revokeSecret, rotateSecret, loadSecretRecord } from '@/lib/secret-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const providers = new Set(['mongodb', 'supabase', 'redis', 'firebase', 'cloudflare', 'core', 'other']);
const MAX_BODY_BYTES = 24 * 1024;

async function boundedJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const { name } = await params;
  try {
    const record = await loadSecretRecord(name);
    if (!record) return NextResponse.json({ error: 'Secret not found' }, { status: 404 });
    const { ciphertext: _ciphertext, iv: _iv, auth_tag: _authTag, ...metadata } = record;
    return NextResponse.json({ secret: metadata }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Secret vault is unavailable' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const { name } = await params;
  const body = await boundedJson(request);
  if (!body) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  if (Object.keys(body).length === 0) return invalidJsonResponse();
  const plaintext = typeof body.plaintext === 'string' ? body.plaintext : '';
  const provider = typeof body.provider === 'string' ? body.provider : '';
  const label = typeof body.label === 'string' ? body.label : '';
  if (!plaintext || !providers.has(provider) || !label.trim()) {
    return NextResponse.json({ error: 'Expected plaintext, provider, and label' }, { status: 400 });
  }
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};
  try {
    const secret = await rotateSecret({ name, provider: provider as Parameters<typeof rotateSecret>[0]['provider'], label, plaintext, metadata, createdBy: access.userId });
    return NextResponse.json({ secret }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message.includes('Invalid') || message.includes('required') || message.includes('exceeds') || message.includes('Private') ? message : 'Secret vault write failed' }, { status: message.includes('Invalid') || message.includes('required') || message.includes('exceeds') || message.includes('Private') ? 400 : 503 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const { name } = await params;
  try {
    await revokeSecret(name, access.userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Secret vault revoke failed' }, { status: 503 });
  }
}
