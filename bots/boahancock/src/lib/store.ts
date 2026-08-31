import type { CommandContext } from '@eiflow/shared';
import { escapeMarkdown, escapeMentions, readBotConfig, sanitizeText, writeBotConfig } from '@eiflow/shared';

/**
 * Welcome/leave configuration lives in Supabase `bot_configs` with
 * `bot_id = welcome`. This bot has no high-write data, so it never touches
 * MongoDB directly beyond the shared batched log sink.
 */

export type MessageKind = 'welcome' | 'leave';

/**
 * A `type`, not an `interface`: `readBotConfig` constrains its generic to
 * `Record<string, unknown>` and TypeScript only grants implicit index
 * signatures to type aliases.
 */
export type WelcomeConfig = {
  welcome_channel: string | null;
  welcome_message: string | null;
  leave_channel: string | null;
  leave_message: string | null;
};

export const DEFAULT_WELCOME_MESSAGE = 'Welcome {user} to {server}! You are member #{membercount}.';
export const DEFAULT_LEAVE_MESSAGE = '{username} left {server}. We are now {membercount} members.';

export const DEFAULT_CONFIG: WelcomeConfig = {
  welcome_channel: null,
  welcome_message: null,
  leave_channel: null,
  leave_message: null,
};

/** Discord caps embed descriptions at 4096; 500 leaves room for placeholders. */
export const MAX_TEMPLATE_LENGTH = 500;
const MAX_RENDERED_LENGTH = 1000;

export const PLACEHOLDER_HELP = '{user} {username} {server} {membercount}';

export function getConfig(ctx: CommandContext): Promise<WelcomeConfig> {
  return readBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, DEFAULT_CONFIG);
}

export async function setConfig(ctx: CommandContext, patch: Partial<WelcomeConfig>): Promise<boolean> {
  const current = await getConfig(ctx);
  return writeBotConfig(ctx.services.supabase, ctx.guildId, ctx.services.env.botId, {
    ...current,
    ...patch,
  });
}

export function defaultTemplate(kind: MessageKind): string {
  return kind === 'welcome' ? DEFAULT_WELCOME_MESSAGE : DEFAULT_LEAVE_MESSAGE;
}

/** The template that will actually be rendered, falling back to the default. */
export function templateFor(config: WelcomeConfig, kind: MessageKind): string {
  const stored = kind === 'welcome' ? config.welcome_message : config.leave_message;
  return stored && stored.length > 0 ? stored : defaultTemplate(kind);
}

/**
 * A stored message means the admin wants their own wording sent as plain
 * content. No stored message means we send our own branded embed instead.
 */
export function isCustom(config: WelcomeConfig, kind: MessageKind): boolean {
  const stored = kind === 'welcome' ? config.welcome_message : config.leave_message;
  return typeof stored === 'string' && stored.length > 0;
}

export function channelFor(config: WelcomeConfig, kind: MessageKind): string | null {
  return kind === 'welcome' ? config.welcome_channel : config.leave_channel;
}

/** Persists one side of the greeting config. `message === null` resets to default. */
export async function saveTemplate(
  ctx: CommandContext,
  kind: MessageKind,
  channelId: string,
  message: string | null,
): Promise<boolean> {
  return setConfig(
    ctx,
    kind === 'welcome'
      ? { welcome_channel: channelId, welcome_message: message }
      : { leave_channel: channelId, leave_message: message },
  );
}

export interface TemplateVars {
  userId: string;
  username: string;
  serverName: string;
  memberCount: number;
}

/**
 * Renders a stored template.
 *
 * Order matters: the template is sanitised and mention-escaped FIRST, so a
 * template can never smuggle `@everyone`, `@here` or a raw `<@id>` ping into a
 * channel. Only then are the placeholders substituted — `{user}` is a trusted
 * snowflake mention, every other value is escaped again on the way in.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const safe = escapeMentions(sanitizeText(template, MAX_TEMPLATE_LENGTH));

  const values: Record<string, string> = {
    user: `<@${vars.userId}>`,
    username: escapeMarkdown(sanitizeText(vars.username, 64)),
    server: escapeMarkdown(sanitizeText(vars.serverName, 100)),
    membercount: String(Math.max(0, Math.floor(vars.memberCount))),
  };

  return safe
    .replace(/\{(user|username|server|membercount)\}/gi, (match, name: string) => values[name.toLowerCase()] ?? match)
    .slice(0, MAX_RENDERED_LENGTH);
}
