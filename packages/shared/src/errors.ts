import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

/**
 * Expected, user-facing failure. Rendered as a red embed and NOT reported to
 * Sentry — e.g. "that user is not muted", "invalid duration".
 */
export class UserError extends Error {
  override readonly name = 'UserError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * A backing service (Supabase / Mongo / Redis / an external API) is unreachable.
 * Bots degrade gracefully: reply with a "temporarily unavailable" embed instead
 * of crashing the process.
 */
export class ServiceUnavailableError extends Error {
  override readonly name = 'ServiceUnavailableError';
  constructor(public readonly service: string, cause?: unknown) {
    super(`${service} is temporarily unavailable`);
    this.cause = cause;
  }
}

/** Thrown when a guild is not whitelisted in Supabase. */
export class UnauthorizedGuildError extends Error {
  override readonly name = 'UnauthorizedGuildError';
  constructor(public readonly guildId: string) {
    super(`Guild ${guildId} is not authorized`);
  }
}

export function initSentry(env: Env): void {
  if (!env.sentryDsn) return;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: process.env.NODE_ENV ?? 'production',
    release: `${env.botId}@${env.botVersion}`,
    tracesSampleRate: 0.1,
    // Free tier: keep payloads small and never ship tokens.
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.server_name;
      return event;
    },
  });

  Sentry.setTag('bot_id', env.botId);
}

export interface ErrorContext {
  botId: string;
  command?: string;
  guildId?: string;
  userId?: string;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  Sentry.withScope((scope) => {
    scope.setTag('bot_id', ctx.botId);
    if (ctx.command) scope.setTag('command', ctx.command);
    if (ctx.guildId) scope.setContext('guild', { id: ctx.guildId });
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/**
 * Wraps an async handler so no rejected promise can ever take the process down.
 * `onError` receives the normalised error for user-facing rendering.
 */
export async function guard<T>(
  name: string,
  fn: () => Promise<T>,
  ctx: ErrorContext,
): Promise<{ ok: true; value: T } | { ok: false; error: Error; expected: boolean }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const expected = error instanceof UserError || error instanceof ServiceUnavailableError;
    if (!expected) reportError(error, { ...ctx, command: ctx.command ?? name });
    return { ok: false, error, expected };
  }
}

/** Installs process-level crash nets. A bot must survive anything. */
export function installProcessGuards(botId: string, log: { error: (o: unknown, m?: string) => void }): void {
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandledRejection');
    reportError(reason, { botId });
  });

  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaughtException');
    reportError(err, { botId });
  });

  process.on('warning', (warn) => {
    log.error({ warn: warn.message, stack: warn.stack }, 'processWarning');
  });
}
