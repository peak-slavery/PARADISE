import { createRequire } from 'node:module';

const contract = createRequire(import.meta.url)('../../../../infra/mongo/indexes.cjs') as {
  readonly LOG_TTL_SECONDS: number;
  readonly AI_CONTEXT_TTL_SECONDS: number;
  readonly indexes: readonly {
    readonly collection: 'logs' | 'xp' | 'card_games' | 'inventories' | 'ai_context';
    readonly name: string;
    readonly key: Record<string, 1 | -1>;
    readonly options: { unique?: true; expireAfterSeconds?: number };
  }[];
};

export const LOG_TTL_SECONDS = contract.LOG_TTL_SECONDS;
export const AI_CONTEXT_TTL_SECONDS = contract.AI_CONTEXT_TTL_SECONDS;
export const MONGO_INDEXES = contract.indexes;

export function secondaryMongoIndexes() {
  return MONGO_INDEXES.filter((index) => index.collection === 'logs');
}

export const MONGO_INDEX_NAMES: readonly string[] = MONGO_INDEXES.map((index) => index.name);
