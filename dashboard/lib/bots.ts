import type { BotId, BotMeta } from './bot-meta';
export type { BotId, BotMeta };

// Only expose settings consumed by the runtimes. Enable/pause belongs to bot_states.
export const BOTS: readonly BotMeta[] = [
  {
    id: 'shanks', name: 'Shanks', tagline: 'The captain of moderation', color: '#C0392B',
    description: 'Case-tracked moderation and AI review of Discord AutoMod triggers. Create keyword rules with /automod in Discord.',
    commands: ['/warn', '/mute', '/unmute', '/ban', '/unban', '/purge', '/automod'],
    fields: [
      { key: 'automod_log_channel', label: 'AutoMod log channel ID', type: 'text', default: '', placeholder: '123456789012345678', help: 'Paste a Discord channel ID, not a channel name. Blank disables channel alerts.' },
      { key: 'automod_warnings', label: 'AI warnings for flagged messages', type: 'boolean', default: true, help: 'Review Discord AutoMod triggers with the configured safety provider. Unavailable providers never issue warnings.' },
    ],
  },
  {
    id: 'sanji', name: 'Sanji', tagline: 'The ship log', color: '#3498DB',
    description: 'A structured audit trail for messages, members, channels, roles, voice and moderation.',
    commands: ['/setlogchannel', '/logconfig', '/message', '/other'],
    fields: [
      { key: 'log_channel', label: 'Log channel ID', type: 'text', default: '', placeholder: '123456789012345678' },
      ...['messages', 'members', 'channels', 'roles', 'voice', 'moderation'].map((category) => ({ key: `events.${category}`, label: `Log ${category}`, type: 'boolean' as const, default: true })),
    ],
  },
  {
    id: 'zoro', name: 'Zoro', tagline: 'Hold the line', color: '#2ECC71',
    description: 'Raid detection, rollback, snapshots and trust scoring. Arm protection explicitly and choose how Zoro responds.',
    commands: ['/antinuke', '/whitelist', '/security', '/lockdown', '/scan', '/snapshot', '/threat', '/zoro', '/slm'],
    fields: [
      { key: 'enabled', label: 'Arm Zoro', type: 'boolean', default: false },
      { key: 'alert_channel', label: 'Incident channel ID', type: 'text', default: '', placeholder: '123456789012345678' },
      { key: 'mode', label: 'Enforcement mode', type: 'select', default: 'revert', options: [{ value: 'revert', label: 'Revert and quarantine' }, { value: 'revertOnly', label: 'Revert only' }, { value: 'notify', label: 'Notify only' }] },
      { key: 'banThreshold', label: 'Mass-ban threshold', type: 'number', default: 3, min: 2, max: 50 },
      { key: 'channelThreshold', label: 'Channel-delete threshold', type: 'number', default: 2, min: 1, max: 50 },
      { key: 'roleThreshold', label: 'Role-change threshold', type: 'number', default: 3, min: 1, max: 50 },
      { key: 'windowSeconds', label: 'Detection window', type: 'number', default: 60, min: 10, max: 3600, suffix: 's' },
      { key: 'punishment', label: 'Action on trigger', type: 'select', default: 'ban', options: [{ value: 'ban', label: 'Ban actor' }, { value: 'kick', label: 'Kick actor' }, { value: 'stripRoles', label: 'Strip roles' }, { value: 'none', label: 'No punishment' }] },
      { key: 'protectWebhooks', label: 'Watch webhooks', type: 'boolean', default: true },
      { key: 'automodSlm', label: 'AI content checks', type: 'boolean', default: true, help: 'Requires the shared CEREBRAS_API_KEY used by Zoro and Shanks.' },
      { key: 'slmThreshold', label: 'AI confidence threshold', type: 'number', default: 0.75, min: 0, max: 1, step: 0.05 },
      { key: 'lockdownOnRaid', label: 'Lock down on critical raids', type: 'boolean', default: false },
      { key: 'snapshotOnChange', label: 'Snapshot before revert', type: 'boolean', default: true },
      { key: 'trustMode', label: 'Member trust scoring', type: 'boolean', default: true },
    ],
  },
  {
    id: 'boahancock', name: 'Boa Hancock', tagline: 'A welcome to remember', color: '#FF5FA2',
    description: 'Welcome and farewell messages with live member placeholders. Leave a channel blank to disable that message.',
    commands: ['/setwelcome', '/setleave', '/testwelcome'],
    fields: [
      { key: 'welcome_channel', label: 'Welcome channel ID', type: 'text', default: '', placeholder: '123456789012345678' },
      { key: 'leave_channel', label: 'Farewell channel ID', type: 'text', default: '', placeholder: '123456789012345678' },
      { key: 'welcome_message', label: 'Welcome template', type: 'textarea', default: '', rows: 3, help: 'Up to 500 characters. {user} {username} {server} {membercount}. Blank uses the default embed.' },
      { key: 'leave_message', label: 'Farewell template', type: 'textarea', default: '', rows: 3, help: 'Up to 500 characters. Same placeholders as welcome.' },
    ],
  },
  {
    id: 'nami', name: 'Nami', tagline: 'Every message, a little progress', color: '#FF8C42',
    description: 'Cooldown-gated XP, rank cards and a persistent server leaderboard.',
    commands: ['/rank', '/leaderboard', '/setlevelchannel'],
    fields: [{ key: 'level_channel', label: 'Level-up channel ID', type: 'text', default: '', placeholder: '123456789012345678', help: 'Blank disables announcements. XP rules are fixed by the runtime.' }],
  },
  {
    id: 'luffy', name: 'Luffy', tagline: 'Play for the next adventure', color: '#C29C25',
    description: 'Draw a hand, play a round and collect rewards. Player state persists across restarts.',
    commands: ['/play', '/hand', '/score', '/deck', '/inventory'], fields: [],
  },
  {
    id: 'niko-robin', name: 'Nico Robin', tagline: 'Find the story behind the question', color: '#8E44AD',
    description: 'Web search with cached results, provider fallbacks and an optional AI summary.',
    commands: ['/search'],
    fields: [
      { key: 'resultCount', label: 'Default result count', type: 'number', default: 5, min: 1, max: 5 },
      { key: 'ephemeral', label: 'Private search replies', type: 'boolean', default: false },
    ],
  },
  {
    id: 'cyrene', name: 'Cyrene', tagline: 'Your companion beyond the horizon', color: '#B76EFF',
    description: 'Four separate AI routes: Cyrene through Groq, a neutral assistant through Mistral, image generation through Agnes and speech through OpenRouter TTS.',
    commands: ['/ask', '/cyrene', '/imagine', '/speak', '/model', '/reset'],
    fields: [
      { key: 'cyreneModel', label: 'Cyrene model (Groq)', type: 'text', default: '', placeholder: 'openai/gpt-oss-20b', help: 'Blank uses the runtime model. Model must be available to your provider account.' },
      { key: 'assistantModel', label: 'Assistant model (Mistral)', type: 'text', default: '', placeholder: 'ministral-8b-latest', help: 'Blank uses the runtime model.' },
      { key: 'ephemeral', label: 'Private AI replies', type: 'boolean', default: true },
    ],
  },
];

const BOT_INDEX: Record<string, BotMeta> = Object.fromEntries(BOTS.map((bot) => [bot.id, bot]));
export const DEFAULT_BOT_ID: BotId = 'shanks';
export function isBotId(value: string | undefined | null): value is BotId {
  return typeof value === 'string' && Object.hasOwn(BOT_INDEX, value);
}
export function getBot(id: string | undefined | null): BotMeta {
  return isBotId(id) ? BOT_INDEX[id]! : BOTS[0]!;
}
export function defaultConfigFor(bot: BotMeta): Record<string, string | number | boolean> {
  return Object.fromEntries(bot.fields.map((field) => [field.key, field.default]));
}
