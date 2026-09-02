import { NextResponse } from 'next/server';

import { authorizationResponse } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { listSecretMetadata } from '@/lib/secret-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  try {
    return NextResponse.json({ secrets: await listSecretMetadata() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Secret vault is unavailable' }, { status: 503 });
  }
}
