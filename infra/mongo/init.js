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
const { LOG_TTL_SECONDS, indexes } = require('./indexes.cjs');

const database = db.getSiblingDB(DB_NAME);

// --- Collections -----------------------------------------------------------
['logs', 'xp', 'card_games', 'inventories', 'ai_context'].forEach((name) => {
  if (!database.getCollectionNames().includes(name)) {
    database.createCollection(name);
    print(`created collection: ${name}`);
  } else {
    print(`collection exists: ${name}`);
  }
});

for (const index of indexes) {
  database[index.collection].createIndex(index.key, { name: index.name, ...index.options });
}

// --- Document validators (cheap safety net, validationLevel: moderate) ------
database.runCommand({
  collMod: 'logs',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['bot_id', 'action', 'level', 'message', 'created_at'],
      properties: {
        bot_id: { bsonType: 'string' },
        action: { bsonType: 'string' },
        level: { enum: ['debug', 'info', 'warn', 'error', 'critical'] },
        message: { bsonType: 'string' },
        created_at: { bsonType: 'date' },
      },
    },
  },
  validationLevel: 'moderate',
  // Reject malformed audit records instead of accepting them silently.
  validationAction: 'error',
});

print(`\nEi Point MongoDB "${DB_NAME}" initialised.`);
print(`logs TTL: ${LOG_TTL_SECONDS / 86400} days`);
