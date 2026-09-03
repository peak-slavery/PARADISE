import { NextResponse } from 'next/server';

export function authorizationResponse(result: { status: number; error: string }) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

export function invalidJsonResponse() {
  return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
}

/** Read a JSON request without allowing an oversized body to reach JSON.parse. */
export async function boundedJson<T>(request: Request, maxBytes: number): Promise<T | NextResponse> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) return invalidJsonResponse();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidJsonResponse();
    return value as T;
  } catch {
    return invalidJsonResponse();
  }
}
