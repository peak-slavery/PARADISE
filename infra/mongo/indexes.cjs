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

  // Luffy collectible card economy
  { collection: 'card_definitions', name: 'carddef_id', key: { definition_id: 1 }, options: { unique: true } },
  { collection: 'card_definitions', name: 'carddef_rank', key: { rank: 1, definition_id: 1 }, options: {} },
  { collection: 'card_definitions', name: 'carddef_category', key: { category: 1, rank: 1 }, options: {} },
  { collection: 'card_definitions', name: 'carddef_series', key: { series: 1 }, options: {} },

  { collection: 'card_instances', name: 'cardinst_id', key: { instance_id: 1 }, options: { unique: true } },
  { collection: 'card_instances', name: 'cardinst_owner', key: { owner_guild_id: 1, owner_user_id: 1, status: 1, acquired_at: -1 }, options: {} },
  { collection: 'card_instances', name: 'cardinst_definition', key: { definition_id: 1, status: 1 }, options: {} },

  { collection: 'card_packs', name: 'cardpack_id', key: { pack_id: 1 }, options: { unique: true } },
  { collection: 'card_packs', name: 'cardpack_active', key: { active: 1, release_starts_at: 1, release_ends_at: 1 }, options: {} },

  { collection: 'card_player_currency', name: 'cardcur_guild_user', key: { guild_id: 1, user_id: 1 }, options: { unique: true } },

  { collection: 'card_trades', name: 'cardtrade_id', key: { trade_id: 1 }, options: { unique: true } },
  { collection: 'card_trades', name: 'cardtrade_initiator', key: { guild_id: 1, initiator_id: 1, status: 1, created_at: -1 }, options: {} },
  { collection: 'card_trades', name: 'cardtrade_recipient', key: { guild_id: 1, recipient_id: 1, status: 1, created_at: -1 }, options: {} },
  { collection: 'card_trades', name: 'cardtrade_expiry', key: { status: 1, expires_at: 1 }, options: {} },

  { collection: 'card_acquisitions', name: 'cardacq_user', key: { guild_id: 1, user_id: 1, acquired_at: -1 }, options: {} },
  { collection: 'card_acquisitions', name: 'cardacq_instance', key: { instance_id: 1 }, options: {} },

  { collection: 'card_transactions', name: 'cardtxn_user', key: { guild_id: 1, user_id: 1, created_at: -1 }, options: {} },
  { collection: 'card_transactions', name: 'cardtxn_reason', key: { reason: 1, created_at: -1 }, options: {} },
];

module.exports = {
  LOG_TTL_SECONDS,
  AI_CONTEXT_TTL_SECONDS,
  indexes,
};
