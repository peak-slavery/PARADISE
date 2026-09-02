import { NextResponse } from 'next/server';

export function authorizationResponse(result: { status: number; error: string }) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

export function invalidJsonResponse() {
  return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
}
