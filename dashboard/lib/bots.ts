import type { BotId, BotMeta } from './bot-meta';

// Re-exported so components can import the roster and the id type together.
export type { BotId, BotMeta };

/**
 * The eight independent bots of the Ei Flow network. Each is a separate render
 * service with its own Discord application; the dashboard only ever talks to
 * shared stores (Supabase for config, Mongo for activity), never to a bot
 * process directly.
 *
 * Bot `id` values are the authoritative `bot_id` column in Postgres and must
 * match `BOT_ID` in each bot's `.env`. They were renamed from their original
 * internal codenames to character names (Shanks, Sanji, Zoro, …) — do not
 * change them without also updating every bot's `.env` and the schema.
 */
export const BOTS: readonly BotMeta[] = [
  {
    id: 'shanks',
    name: 'Shanks',
    tagline: 'Warn, mute, ban, purge',
    description:
      'Case-tracked moderation with an append-only audit trail, timed mutes that expire on their own, and automod rules that stay out of the way.',
    color: '#C0392B',
    commands: ['/warn', '/mute', '/ban', '/purge', '/automod'],
    fields: [
      {
        key: 'logChannel',
        label: 'Log channel',
        type: 'text',
        default: '',
        placeholder: '#mod-log',
        help: 'Every action is posted here as an embed.',
      },
      {
        key: 'muteRole',
        label: 'Mute role',
        type: 'text',
        default: '',
        placeholder: 'Muted',
        help: 'Applied on /mute, removed on /unmute and at expiry.',
      },
      { key: 'requireReason', label: 'Require a reason', type: 'boolean', default: true },
      { key: 'dmTargets', label: 'DM the target', type: 'boolean', default: true },
      {
        key: 'defaultMuteMinutes',
        label: 'Default mute length',
        type: 'number',
        default: 60,
        min: 1,
        max: 40320,
        suffix: 'min',
      },
      {
        key: 'warnThreshold',
        label: 'Warn threshold',
        type: 'number',
        default: 3,
        min: 2,
        max: 10,
        suffix: 'warns',
        help: 'Reaching this many active warns escalates the case.',
      },
      {
        key: 'escalation',
        label: 'Escalation action',
        type: 'select',
        default: 'mute',
        options: [
          { value: 'none', label: 'Notify only' },
          { value: 'mute', label: 'Auto-mute' },
          { value: 'kick', label: 'Auto-kick' },
          { value: 'ban', label: 'Auto-ban' },
        ],
      },
      { key: 'autoMod', label: 'Enable automod', type: 'boolean', default: true },
      {
        key: 'maxMentions',
        label: 'Max mentions per message',
        type: 'number',
        default: 5,
        min: 2,
        max: 50,
      },
      {
        key: 'bannedWords',
        label: 'Blocked phrases',
        type: 'textarea',
        default: '',
        rows: 4,
        placeholder: 'one phrase per line',
        help: 'Case-insensitive substring match.',
      },
    ],
  },
  {
    id: 'sanji',
    name: 'Sanji',
    tagline: 'Full server audit trail',
    description:
      'Structured message, member and moderation logging with per-category channel routing and batched writes that never block the gateway.',
    color: '#3498DB',
    commands: ['/setlogchannel', '/logconfig', '/messagelogs', '/otherlogs'],
    fields: [
      {
        key: 'defaultChannel',
        label: 'Default channel',
        type: 'text',
        default: '',
        placeholder: '#logs',
        help: 'Fallback for any category left unset.',
      },
      {
        key: 'messageChannel',
        label: 'Message logs',
        type: 'text',
        default: '',
        placeholder: '#message-logs',
      },
      {
        key: 'memberChannel',
        label: 'Member logs',
        type: 'text',
        default: '',
        placeholder: '#member-logs',
      },
      {
        key: 'voiceChannel',
        label: 'Voice logs',
        type: 'text',
        default: '',
        placeholder: '#voice-logs',
      },
      { key: 'logEdits', label: 'Log message edits', type: 'boolean', default: true },
      { key: 'logDeletes', label: 'Log message deletes', type: 'boolean', default: true },
      { key: 'logJoins', label: 'Log joins and leaves', type: 'boolean', default: true },
      { key: 'logVoice', label: 'Log voice activity', type: 'boolean', default: false },
      { key: 'storeBulk', label: 'Bulk-delete buffer window', type: 'number', default: 30, min: 5, max: 300, suffix: 's' },
      {
        key: 'retentionDays',
        label: 'Retention',
        type: 'number',
        default: 60,
        min: 1,
        max: 60,
        suffix: 'days',
        help: 'Matches the MongoDB TTL on the logs collection.',
      },
    ],
  },
  {
    id: 'zoro',
    name: 'Zoro',
    tagline: 'Antinuke — advanced server protection',
    description:
      'Extremely advanced server protection: raid detection, SLM-assisted bad-word AutoMod, server lockdown, role/channel snapshots with rollback, and per-member trust scoring. Destructive actions are reverted and the actor quarantined inside a configurable window.',
    color: '#2ECC71',
    commands: ['/antinuke', '/whitelist', '/security', '/lockdown', '/scan', '/snapshot', '/threat', '/zoro', '/slm'],
    fields: [
      { key: 'enabled', label: 'Arm Zoro', type: 'boolean', default: false },
      {
        key: 'alert_channel',
        label: 'Incident channel',
        type: 'text',
        default: '',
        placeholder: '#security',
        help: 'Where raid alerts and rollback reports are posted.',
      },
      {
        key: 'mode',
        label: 'Enforcement mode',
        type: 'select',
        default: 'revert',
        options: [
          { value: 'revert', label: 'Revert and quarantine' },
          { value: 'revertOnly', label: 'Revert only' },
          { value: 'notify', label: 'Notify only' },
        ],
      },
      {
        key: 'banThreshold',
        label: 'Mass-ban threshold',
        type: 'number',
        default: 3,
        min: 2,
        max: 50,
        suffix: 'bans',
      },
      {
        key: 'channelThreshold',
        label: 'Channel-delete threshold',
        type: 'number',
        default: 2,
        min: 1,
        max: 50,
        suffix: 'deletes',
      },
      {
        key: 'roleThreshold',
        label: 'Role-create threshold',
        type: 'number',
        default: 3,
        min: 1,
        max: 50,
        suffix: 'roles',
      },
      {
        key: 'windowSeconds',
        label: 'Detection window',
        type: 'number',
        default: 60,
        min: 10,
        max: 3600,
        suffix: 's',
        help: 'Counter window; Redis-backed with an in-process fallback.',
      },
      {
        key: 'punishment',
        label: 'Action on trigger',
        type: 'select',
        default: 'ban',
        options: [
          { value: 'ban', label: 'Ban the actor' },
          { value: 'kick', label: 'Kick the actor' },
          { value: 'stripRoles', label: 'Strip roles' },
          { value: 'none', label: 'Revert only' },
        ],
      },
      { key: 'protectWebhooks', label: 'Watch webhook creation', type: 'boolean', default: true },
      {
        key: 'automodSlm',
        label: 'SLM bad-word AutoMod',
        type: 'boolean',
        default: true,
        help: 'Use a small language model to catch evasive bad words that static lists miss.',
      },
      {
        key: 'slmThreshold',
        label: 'SLM confidence',
        type: 'number',
        default: 0.75,
        min: 0,
        max: 1,
        step: 0.05,
        help: 'Minimum confidence before the SLM flags a message (0–1).',
      },
      {
        key: 'lockdownOnRaid',
        label: 'Auto-lockdown on critical raid',
        type: 'boolean',
        default: false,
        help: 'Revoke create/send permissions fleet-wide when a critical raid is detected.',
      },
      {
        key: 'snapshotOnChange',
        label: 'Snapshot before revert',
        type: 'boolean',
        default: true,
        help: 'Capture roles and channels so a revert can be rolled back if needed.',
      },
      {
        key: 'trustMode',
        label: 'Trust scoring',
        type: 'boolean',
        default: true,
        help: 'Track a per-member trust score; low-trust actors trip faster.',
      },
    ],
  },
  {
    id: 'boahancock',
    name: 'Boa Hancock',
    tagline: 'Greet and farewell',
    description:
      'Rendered welcome and leave cards with live placeholder substitution, plus a `/testwelcome` preview that never pings real members.',
    color: '#FF5FA2',
    commands: ['/setwelcome', '/setleave', '/testwelcome'],
    fields: [
      { key: 'enabled', label: 'Enable welcome messages', type: 'boolean', default: true },
      { key: 'channel', label: 'Welcome channel', type: 'text', default: '', placeholder: '#general' },
      {
        key: 'message',
        label: 'Welcome message',
        type: 'textarea',
        default: 'Welcome {user} to **{server}** — you are member #{count}.',
        rows: 4,
        help: 'Placeholders: {user} {server} {count}',
      },
      { key: 'sendLeave', label: 'Enable leave messages', type: 'boolean', default: false },
      {
        key: 'leaveMessage',
        label: 'Leave message',
        type: 'textarea',
        default: '{user} has left {server}.',
        rows: 3,
      },
      { key: 'embed', label: 'Post as embed', type: 'boolean', default: true },
      {
        key: 'cardColor',
        label: 'Card accent',
        type: 'select',
        default: 'pink',
        options: [
          { value: 'pink', label: 'Pink' },
          { value: 'blurple', label: 'Blurple' },
          { value: 'green', label: 'Green' },
          { value: 'gold', label: 'Gold' },
        ],
      },
      { key: 'autoRole', label: 'Auto-role on join', type: 'text', default: '', placeholder: 'Member' },
      { key: 'deleteAfter', label: 'Auto-delete after', type: 'number', default: 0, min: 0, max: 600, suffix: 's', help: '0 keeps the message.' },
    ],
  },
  {
    id: 'nami',
    name: 'Nami',
    tagline: 'XP, ranks, leaderboards',
    description:
      'Cooldown-gated XP with a level curve that keeps early ranks fast and late ranks earned, plus a paginated leaderboard and rank cards.',
    color: '#FF8C42',
    commands: ['/rank', '/leaderboard', '/setlevelchannel'],
    fields: [
      { key: 'enabled', label: 'Track XP', type: 'boolean', default: true },
      { key: 'announceChannel', label: 'Level-up channel', type: 'text', default: '', placeholder: '#levels' },
      { key: 'xpPerMessage', label: 'XP per message', type: 'number', default: 15, min: 1, max: 100 },
      { key: 'cooldownSeconds', label: 'Cooldown', type: 'number', default: 60, min: 5, max: 3600, suffix: 's' },
      { key: 'curve', label: 'Level curve', type: 'select', default: 'quadratic', options: [
        { value: 'linear', label: 'Linear' },
        { value: 'quadratic', label: 'Quadratic' },
        { value: 'cubic', label: 'Cubic' },
      ] },
      { key: 'baseXp', label: 'XP for level 2', type: 'number', default: 100, min: 10, max: 10000 },
      { key: 'noXpChannels', label: 'No-XP channels', type: 'textarea', default: '', rows: 3, placeholder: '#bot-commands', help: 'One channel per line.' },
      { key: 'announceEmbed', label: 'Announce with embed', type: 'boolean', default: true },
      { key: 'leaderboardSize', label: 'Leaderboard size', type: 'number', default: 10, min: 5, max: 50 },
    ],
  },
  {
    id: 'luffy',
    name: 'Luffy',
    tagline: 'Collectible duels',
    description:
      'Draft a hand, challenge another member, and bank wins into a persistent inventory. Every game state lives in Mongo so a redeploy never loses a match.',
    color: '#F1C40F',
    commands: ['/play', '/hand', '/score', '/deck', '/inventory'],
    fields: [
      { key: 'enabled', label: 'Enable card game', type: 'boolean', default: true },
      { key: 'channels', label: 'Allowed channels', type: 'textarea', default: '', rows: 3, placeholder: '#card-games', help: 'One channel per line. Empty allows all.' },
      { key: 'handSize', label: 'Hand size', type: 'number', default: 5, min: 3, max: 10 },
      { key: 'turnSeconds', label: 'Turn timer', type: 'number', default: 120, min: 30, max: 900, suffix: 's' },
      { key: 'stake', label: 'Ante per match', type: 'number', default: 10, min: 0, max: 1000, suffix: 'credits' },
      { key: 'startingCredits', label: 'Starting credits', type: 'number', default: 100, min: 0, max: 100000 },
      { key: 'allowTrades', label: 'Allow trades', type: 'boolean', default: true },
      { key: 'dailyBonus', label: 'Daily bonus', type: 'number', default: 50, min: 0, max: 10000 },
      { key: 'rarityWeights', label: 'Rarity weighting', type: 'select', default: 'standard', options: [
        { value: 'flat', label: 'Flat' },
        { value: 'standard', label: 'Standard' },
        { value: 'topHeavy', label: 'Top heavy' },
      ] },
    ],
  },
  {
    id: 'niko-robin',
    name: 'Niko Robin',
    tagline: 'Web results in chat',
    description:
      'Provider-fanned web search with a Redis result cache, a hard timeout, and a graceful embed when every upstream is down.',
    color: '#8E44AD',
    commands: ['/search'],
    fields: [
      { key: 'enabled', label: 'Enable search', type: 'boolean', default: true },
      { key: 'provider', label: 'Primary provider', type: 'select', default: 'brave', options: [
        { value: 'brave', label: 'Brave Search' },
        { value: 'serpapi', label: 'SerpAPI' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
      ] },
      { key: 'safeSearch', label: 'Safe search', type: 'boolean', default: true },
      { key: 'resultCount', label: 'Results per query', type: 'number', default: 5, min: 1, max: 10 },
      { key: 'cacheTtl', label: 'Cache TTL', type: 'number', default: 900, min: 0, max: 86400, suffix: 's' },
      { key: 'timeoutMs', label: 'Upstream timeout', type: 'number', default: 4000, min: 500, max: 15000, suffix: 'ms' },
      { key: 'cooldownSeconds', label: 'Per-user cooldown', type: 'number', default: 10, min: 0, max: 600, suffix: 's' },
      { key: 'channels', label: 'Allowed channels', type: 'textarea', default: '', rows: 3, placeholder: '#search' },
      { key: 'ephemeral', label: 'Reply ephemerally', type: 'boolean', default: false },
    ],
  },
  {
    id: 'cyrene',
    name: 'Cyrene',
    tagline: 'Two-model AI companion',
    description:
      'Two isolated model routes: /cyrene speaks as Cyrene via Groq gpt-oss, /ask is a neutral assistant via Mistral. Each has its own fallback chain and conversation memory.',
    color: '#B76EFF',
    commands: ['/ask', '/cyrene', '/model', '/reset'],
    fields: [
      { key: 'enabled', label: 'Enable assistant', type: 'boolean', default: true },
      {
        key: 'cyreneModel',
        label: 'Cyrene model (Groq)',
        type: 'text',
        default: 'openai/gpt-oss-20b',
        placeholder: 'openai/gpt-oss-20b',
        help: 'Persona route — override the env CYRENE_MODEL for this guild.',
      },
      {
        key: 'assistantModel',
        label: 'Assistant model (Mistral)',
        type: 'text',
        default: 'mistral-small-latest',
        placeholder: 'mistral-small-latest',
        help: 'Assistant route — override the env ASSISTANT_MODEL for this guild.',
      },
      { key: 'contextMessages', label: 'Context window', type: 'number', default: 10, min: 0, max: 50, suffix: 'msgs' },
      { key: 'cooldownSeconds', label: 'Per-user cooldown', type: 'number', default: 15, min: 0, max: 600, suffix: 's' },
      { key: 'channels', label: 'Allowed channels', type: 'textarea', default: '', rows: 3, placeholder: '#ai' },
      { key: 'ephemeral', label: 'Reply ephemerally', type: 'boolean', default: true },
    ],
  },
] as const;

const BOT_INDEX: Record<string, BotMeta> = Object.fromEntries(
  BOTS.map((bot) => [bot.id, bot]),
);

const BOT_IDS: readonly BotId[] = BOTS.map((bot) => bot.id);

export const DEFAULT_BOT_ID: BotId = 'shanks';

/** Type guard for the `[botId]` / `?tab=` route segments. */
export function isBotId(value: string | undefined | null): value is BotId {
  return typeof value === 'string' && (BOT_IDS as readonly string[]).includes(value);
}

/** Look up a bot by id, falling back to the first entry for unknown ids. */
export function getBot(id: string | undefined | null): BotMeta {
  if (typeof id === 'string') {
    const found = BOT_INDEX[id];
    if (found) return found;
  }
  const fallback = BOTS[0];
  if (!fallback) {
    throw new Error('BOTS roster is empty');
  }
  return fallback;
}

/** Build the config object a bot should start from, before any overrides. */
export function defaultConfigFor(bot: BotMeta): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of bot.fields) {
    out[field.key] = field.default;
  }
  return out;
}
