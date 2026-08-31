/**
 * Ei Point — MongoDB Atlas (M0 free tier) bootstrap
 *
 * High-write, flexible-schema activity data lives here:
 *   logs        — structured log stream (TTL: 60 days)
 *   xp          — level-up state (chat + voice)
 *   card_games  — per-user deck/hand/score
 *   inventories — per-user items
 *   ai_context  — conversation history, scoped 'ask' | 'cyrene'
 *
 * Run once:   mongosh "$MONGODB_URI" infra/mongo/init.js
 * Or rely on: packages/shared/src/db/mongo.ts ensureIndexes(), which creates the
 * exact same indexes idempotently on every bot boot.
 */

const DB_NAME = process.env.MONGODB_DB || 'eiflow';
const LOG_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

const db = db.getSiblingDB(DB_NAME);

// --- Collections -----------------------------------------------------------
['logs', 'xp', 'card_games', 'inventories', 'ai_context'].forEach((name) => {
  if (!db.getCollectionNames().includes(name)) {
    db.createCollection(name);
    print(`created collection: ${name}`);
  } else {
    print(`collection exists: ${name}`);
  }
});

// --- logs: query by guild + time, expire automatically ---------------------
db.logs.createIndex({ guild_id: 1, created_at: -1 }, { name: 'logs_guild_created' });
db.logs.createIndex({ bot_id: 1, created_at: -1 }, { name: 'logs_bot_created' });
db.logs.createIndex({ action: 1, created_at: -1 }, { name: 'logs_action_created' });
// The TTL index is what keeps the 512MB M0 cap from ever being reached.
db.logs.createIndex({ created_at: 1 }, { name: 'logs_ttl', expireAfterSeconds: LOG_TTL_SECONDS });

// --- xp --------------------------------------------------------------------
db.xp.createIndex({ guild_id: 1, user_id: 1 }, { name: 'xp_guild_user', unique: true });
db.xp.createIndex({ guild_id: 1, xp: -1 }, { name: 'xp_leaderboard' });
db.xp.createIndex({ guild_id: 1, level: -1 }, { name: 'xp_level' });

// --- card_games ------------------------------------------------------------
db.card_games.createIndex({ guild_id: 1, user_id: 1 }, { name: 'cards_guild_user', unique: true });
db.card_games.createIndex({ guild_id: 1, score: -1 }, { name: 'cards_leaderboard' });

// --- inventories -----------------------------------------------------------
db.inventories.createIndex({ guild_id: 1, user_id: 1 }, { name: 'inv_guild_user', unique: true });

// --- ai_context ------------------------------------------------------------
db.ai_context.createIndex({ guild_id: 1, user_id: 1, scope: 1 }, { name: 'ai_ctx_unique', unique: true });
db.ai_context.createIndex({ updated_at: 1 }, { name: 'ai_ctx_updated' });

// --- Document validators (cheap safety net, validationLevel: moderate) ------
db.runCommand({
  collMod: 'logs',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['bot_id', 'action', 'level', 'message', 'created_at'],
      properties: {
        bot_id: { bsonType: 'string' },
        action: { bsonType: 'string' },
        level: { enum: ['debug', 'info', 'warn', 'error'] },
        message: { bsonType: 'string' },
        created_at: { bsonType: 'date' },
      },
    },
  },
  validationLevel: 'moderate',
  validationAction: 'warn',
});

print(`\nEi Point MongoDB "${DB_NAME}" initialised.`);
print(`logs TTL: ${LOG_TTL_SECONDS / 86400} days`);
