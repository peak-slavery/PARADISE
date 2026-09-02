import { loadSecret } from '../secret-vault';

export type MongoSecretConfig = {
  uri: string;
  database: string;
};

export async function createMongoConfig(): Promise<MongoSecretConfig | null> {
  const uri = await loadSecret('mongodb.primary.uri');
  if (!uri) return null;
  return {
    uri,
    database: (await loadSecret('mongodb.primary.database')) ?? 'eiflow',
  };
}
