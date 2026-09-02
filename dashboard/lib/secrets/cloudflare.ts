import { loadSecret } from '../secret-vault';

export type CloudflareConfig = {
  accountId: string;
  apiToken: string;
  r2?: { accessKeyId: string; secretAccessKey: string; endpoint: string };
  d1DatabaseId?: string;
};

export async function createCloudflareConfig(): Promise<CloudflareConfig | null> {
  const [accountId, apiToken] = await Promise.all([
    loadSecret('cloudflare.account_id'),
    loadSecret('cloudflare.api_token'),
  ]);
  if (!accountId || !apiToken) return null;
  const [accessKeyId, secretAccessKey, endpoint, d1DatabaseId] = await Promise.all([
    loadSecret('cloudflare.r2.access_key_id'),
    loadSecret('cloudflare.r2.secret_access_key'),
    loadSecret('cloudflare.r2.endpoint'),
    loadSecret('cloudflare.d1.database_id'),
  ]);
  return {
    accountId,
    apiToken,
    r2: accessKeyId && secretAccessKey && endpoint ? { accessKeyId, secretAccessKey, endpoint } : undefined,
    d1DatabaseId: d1DatabaseId ?? undefined,
  };
}
