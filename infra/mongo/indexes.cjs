const LOG_TTL_SECONDS = 60 * 60 * 24 * 60;
const AI_CONTEXT_TTL_SECONDS = 60 * 60 * 24 * 30;

const indexes = [
  { collection: 'logs', name: 'logs_guild_created', key: { guild_id: 1, created_at: -1 }, options: {} },
  { collection: 'logs', name: 'logs_bot_created', key: { bot_id: 1, created_at: -1 }, options: {} },
  { collection: 'logs', name: 'logs_action_created', key: { action: 1, created_at: -1 }, options: {} },
  { collection: 'logs', name: 'logs_ttl', key: { created_at: 1 }, options: { expireAfterSeconds: LOG_TTL_SECONDS } },
  { collection: 'xp', name: 'xp_guild_user', key: { guild_id: 1, user_id: 1 }, options: { unique: true } },
  { collection: 'xp', name: 'xp_leaderboard', key: { guild_id: 1, xp: -1 }, options: {} },
  { collection: 'xp', name: 'xp_level', key: { guild_id: 1, level: -1 }, options: {} },
  { collection: 'card_games', name: 'cards_guild_user', key: { guild_id: 1, user_id: 1 }, options: { unique: true } },
  { collection: 'card_games', name: 'cards_leaderboard', key: { guild_id: 1, score: -1 }, options: {} },
  { collection: 'inventories', name: 'inv_guild_user', key: { guild_id: 1, user_id: 1 }, options: { unique: true } },
  { collection: 'ai_context', name: 'ai_ctx_unique', key: { guild_id: 1, user_id: 1, scope: 1 }, options: { unique: true } },
  { collection: 'ai_context', name: 'ai_ctx_ttl', key: { updated_at: 1 }, options: { expireAfterSeconds: AI_CONTEXT_TTL_SECONDS } },
];

module.exports = {
  LOG_TTL_SECONDS,
  AI_CONTEXT_TTL_SECONDS,
  indexes,
};
