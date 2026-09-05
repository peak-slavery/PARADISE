import { NextRequest, NextResponse } from 'next/server';

import { authorizationResponse, boundedJson } from '@/lib/api-response';
import { authorizeMaster } from '@/lib/authz';
import { validateJsonbObject } from '@/lib/jsonb';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const providers = new Set(['mongodb', 'redis', 'supabase']);

export async function GET() {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.from('infra_accounts').select('id,provider,account_name,region,secret_ref,endpoint,enabled,metadata,created_at,updated_at').order('provider').order('account_name');
  if (error) return NextResponse.json({ error: 'Unable to load infrastructure accounts' }, { status: 503 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await authorizeMaster();
  if (!access.ok) return authorizationResponse(access);
  const parsed = await boundedJson<{ provider?: unknown; account_name?: unknown; region?: unknown; secret_ref?: unknown; endpoint?: unknown; enabled?: unknown; metadata?: unknown }>(request, 16 * 1024);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (typeof body.provider !== 'string' || !providers.has(body.provider)) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  if (typeof body.account_name !== 'string' || body.account_name.length < 1 || body.account_name.length > 80) return NextResponse.json({ error: 'Invalid account_name' }, { status: 400 });
  if (typeof body.secret_ref !== 'string' || body.secret_ref.length < 1 || body.secret_ref.length > 160) return NextResponse.json({ error: 'Invalid secret_ref' }, { status: 400 });
  if (body.endpoint !== undefined && body.endpoint !== null && typeof body.endpoint !== 'string') return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  let metadataValue: Record<string, unknown> = {};
  if (body.metadata !== undefined && body.metadata !== null) {
    const meta = validateJsonbObject(body.metadata);
    if (!meta.ok) return NextResponse.json({ error: `Invalid metadata: ${meta.reason}` }, { status: 400 });
    metadataValue = meta.value ?? {};
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Dashboard backend is unavailable' }, { status: 503 });
  const { data, error } = await supabase.from('infra_accounts').insert({ provider: body.provider, account_name: body.account_name, region: typeof body.region === 'string' ? body.region : null, secret_ref: body.secret_ref, endpoint: typeof body.endpoint === 'string' ? body.endpoint : null, enabled: body.enabled !== false, metadata: metadataValue }).select('id,provider,account_name,region,secret_ref,endpoint,enabled,metadata,created_at,updated_at').single();
  if (error) return NextResponse.json({ error: 'Unable to create infrastructure account' }, { status: 503 });
  return NextResponse.json({ account: data }, { status: 201 });
}
