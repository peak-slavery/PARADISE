import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MONGO_INDEXES } from './mongo-indexes.js';

describe('Mongo index contract', () => {
  it('defines one canonical updated_at index for AI context', () => {
    const aiIndexes = MONGO_INDEXES.filter((index) => index.collection === 'ai_context');
    const updatedAtIndexes = aiIndexes.filter((index) => 'updated_at' in index.key);

    expect(updatedAtIndexes).toHaveLength(1);
    expect(updatedAtIndexes[0]?.name).toBe('ai_ctx_ttl');
    expect(updatedAtIndexes[0]?.options.expireAfterSeconds).toBe(60 * 60 * 24 * 30);
  });

  it('defines every required production index', () => {
    expect(MONGO_INDEXES.map((index) => index.name)).toEqual(expect.arrayContaining([
      'logs_guild_created',
      'logs_bot_created',
      'logs_action_created',
      'logs_ttl',
      'xp_guild_user',
      'xp_leaderboard',
      'xp_level',
      'cards_guild_user',
      'cards_leaderboard',
      'inv_guild_user',
      'ai_ctx_unique',
      'ai_ctx_ttl',
    ]));
  });

  it('makes the mongosh bootstrap consume the same canonical contract', () => {
    const bootstrap = readFileSync(new URL('../../../../infra/mongo/init.js', import.meta.url), 'utf8');

    expect(bootstrap).toContain("require('./indexes.cjs')");
    expect(bootstrap).toContain('const database = db.getSiblingDB(DB_NAME)');
    expect(bootstrap).toContain('for (const index of indexes)');
    expect(bootstrap).toContain('database[index.collection].createIndex');
    expect(bootstrap).toContain('database.runCommand');
    expect(bootstrap).not.toContain('const db = db.getSiblingDB');
    expect(bootstrap).not.toContain('db.logs.createIndex');
    expect(bootstrap).not.toContain('db.ai_context.createIndex');
  });
});
