import pino from 'pino';
import type { Env } from './env.js';

export type Logger = pino.Logger;

/**
 * Structured JSON logging to stdout. Render captures stdout; from there logs are
 * shipped to Sentry (errors) and MongoDB (batched, see log-sink.ts).
 * There is deliberately no console.log anywhere in the codebase.
 */
export function createLogger(env: Env): Logger {
  return pino({
    level: env.logLevel,
    base: {
      bot_id: env.botId,
      bot_version: env.botVersion,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        '*.token',
        '*.discordToken',
        '*.password',
        '*.secret',
        '*.authorization',
        'req.headers.authorization',
        '*.hmacSecret',
        '*.supabaseServiceRoleKey',
        '*.mongodbUri',
        '*.upstashToken',
        '*.braveSearchApiKey',
        '*.serpapiKey',
        '*.groqApiKey',
        '*.geminiApiKey',
        '*.openrouterApiKey',
        '*.mistralApiKey',
        '*.groqAutomodApiKey',
      ],
      censor: '[redacted]',
    },
  });
}
