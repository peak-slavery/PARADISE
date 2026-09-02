import { loadSecret } from '../secret-vault';

export type RedisSecretConfig = {
  url: string;
  token: string;
};

export async function createRedisConfig(): Promise<RedisSecretConfig | null> {
  const [url, token] = await Promise.all([
    loadSecret('redis.primary.url'),
    loadSecret('redis.primary.token'),
  ]);
  return url && token ? { url, token } : null;
}
