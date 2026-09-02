import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from './supabase/server';

const MAX_SECRET_BYTES = 16 * 1024;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const CACHE_TTL_MS = 5 * 60_000;
const NAME_PATTERN = /^[a-z][a-z0-9_.:-]{1,127}$/;

export type SecretProvider = 'mongodb' | 'supabase' | 'redis' | 'firebase' | 'cloudflare' | 'core' | 'other';

export type SecretRecord = {
  id?: string;
  name: string;
  provider: SecretProvider;
  label: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  rotated_at?: string;
  created_by?: string | null;
  revoked_at?: string | null;
};

export type SecretMetadata = Omit<SecretRecord, 'ciphertext' | 'iv' | 'auth_tag'>;

type VaultCacheEntry = { plaintext: string; expiresAt: number };
const cache = new Map<string, VaultCacheEntry>();

function envBytes(name: string, expectedBytes: number): Buffer {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the secret vault`);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    throw new Error(`${name} must be base64`);
  }
  if (decoded.length !== expectedBytes) throw new Error(`${name} must decode to ${expectedBytes} bytes`);
  return decoded;
}

function vaultKey(): Buffer {
  const master = envBytes('SECRET_VAULT_MASTER_KEY', KEY_BYTES);
  const salt = envBytes('SECRET_VAULT_SALT', 16);
  // Node's built-in scrypt keeps this module dependency-free. The random
  // 32-byte master key and independent salt prevent accidental key reuse.
  return scryptSync(master, salt, KEY_BYTES, { N: 16_384, r: 8, p: 1 });
}

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid secret name');
}

function validatePlaintext(plaintext: string, metadata: Record<string, unknown>): void {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('Secret plaintext is required');
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_SECRET_BYTES) throw new Error('Secret plaintext exceeds 16 KiB');
  if (/-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----/.test(plaintext) && metadata.kind !== 'private-key') {
    throw new Error('Private keys require metadata.kind=private-key');
  }
}

export function sealSecret(plaintext: string, metadata: Record<string, unknown> = {}): Pick<SecretRecord, 'ciphertext' | 'iv' | 'auth_tag'> {
  validatePlaintext(plaintext, metadata);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== TAG_BYTES) throw new Error('Vault produced an invalid authentication tag');
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64'),
  };
}

export function openSecret(record: Pick<SecretRecord, 'ciphertext' | 'iv' | 'auth_tag'>): string {
  const iv = Buffer.from(record.iv, 'base64');
  const authTag = Buffer.from(record.auth_tag, 'base64');
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) throw new Error('Invalid vault record encoding');
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_SECRET_BYTES) throw new Error('Vault plaintext exceeds 16 KiB');
  return plaintext;
}

function activeQuery(client: SupabaseClient) {
  return client.from('secret_records').select('*').is('revoked_at', null);
}

export async function listSecretMetadata(client = createSupabaseAdminClient()): Promise<SecretMetadata[]> {
  if (!client) throw new Error('Supabase admin client is unavailable');
  const { data, error } = await activeQuery(client).order('name');
  if (error) throw error;
  return (data ?? []).map((record) => {
    const value = record as SecretRecord;
    const { ciphertext: _ciphertext, iv: _iv, auth_tag: _authTag, ...metadata } = value;
    return metadata;
  });
}

export async function loadSecretRecord(name: string, client = createSupabaseAdminClient()): Promise<SecretRecord | null> {
  validateName(name);
  if (!client) throw new Error('Supabase admin client is unavailable');
  const { data, error } = await activeQuery(client).eq('name', name).maybeSingle();
  if (error) throw error;
  return (data as SecretRecord | null) ?? null;
}

export async function loadSecret(name: string, client = createSupabaseAdminClient()): Promise<string | null> {
  validateName(name);
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.plaintext;
  const record = await loadSecretRecord(name, client);
  if (!record) return null;
  const plaintext = openSecret(record);
  cache.set(name, { plaintext, expiresAt: Date.now() + CACHE_TTL_MS });
  return plaintext;
}

export async function rotateSecret(input: {
  name: string;
  provider: SecretProvider;
  label: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}, client = createSupabaseAdminClient()): Promise<SecretMetadata> {
  validateName(input.name);
  if (!client) throw new Error('Supabase admin client is unavailable');
  const metadata = input.metadata ?? {};
  const sealed = sealSecret(input.plaintext, metadata);
  const now = new Date().toISOString();
  const { error: revokeError } = await client
    .from('secret_records')
    .update({ revoked_at: now })
    .eq('name', input.name)
    .is('revoked_at', null);
  if (revokeError) throw revokeError;

  const { data, error } = await client.from('secret_records').insert({
    name: input.name,
    provider: input.provider,
    label: input.label.trim().slice(0, 160),
    ...sealed,
    metadata,
    rotated_at: now,
    created_by: input.createdBy ?? null,
  }).select('id,name,provider,label,metadata,created_at,rotated_at,created_by,revoked_at').single();
  if (error || !data) throw error ?? new Error('Secret write returned no record');
  cache.delete(input.name);
  return data as SecretMetadata;
}

export async function revokeSecret(name: string, revokedBy: string | null, client = createSupabaseAdminClient()): Promise<void> {
  validateName(name);
  if (!client) throw new Error('Supabase admin client is unavailable');
  const { error } = await client.from('secret_records').update({
    revoked_at: new Date().toISOString(),
    metadata: { revoked_by: revokedBy },
  }).eq('name', name).is('revoked_at', null);
  if (error) throw error;
  cache.delete(name);
}

export function clearSecretCache(): void {
  cache.clear();
}
