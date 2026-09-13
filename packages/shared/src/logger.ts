import pino from 'pino';
import type { Env } from './env.js';

export type Logger = pino.Logger;

export interface LogOperationFields {
  guildId?: string;
  requestId?: string;
  latencyMs?: number;
  status?: number | string;
  errorClass?: string;
}

const redactSensitiveLogValue = (value: unknown): unknown => (typeof value === 'string' ? '[redacted]' : value);
const sensitiveLogSerializers = Object.fromEntries(
  [
    'token',
    'discordToken',
    'password',
    'secret',
    'authorization',
    'Authorization',
    'hmacSecret',
    'supabaseServiceRoleKey',
    'mongodbUri',
    'upstashToken',
    'braveSearchApiKey',
    'serpapiKey',
    'groqApiKey',
    'geminiApiKey',
    'openrouterApiKey',
    'mistralApiKey',
    'apiKey',
    'vaultMasterKey',
    'cookie',
    'Cookie',
  ].map((key) => [key, redactSensitiveLogValue]),
);

export function logOperationFields(fields: LogOperationFields): Record<string, unknown> {
  return {
    guild_id: fields.guildId,
    request_id: fields.requestId,
    latency_ms: fields.latencyMs,
    status: fields.status,
    error_class: fields.errorClass,
  };
}

/**
 * Structured JSON logging to stdout. Render captures stdout; from there logs are
 * shipped to Sentry (errors) and MongoDB (batched, see log-sink.ts).
 * There is deliberately no console.log anywhere in the codebase.
 */
export function createLogger(env: Env, destination?: pino.DestinationStream): Logger {
  return pino({
    level: env.logLevel,
    base: {
      service: 'discord-bot',
      bot_id: env.botId,
      bot_version: env.botVersion,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: sensitiveLogSerializers,
    redact: {
      paths: [
        '*.token',
        '*.discordToken',
        '*.password',
        '*.secret',
        '*.authorization',
        '*.Authorization',
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
        '*.apiKey',
        '*.vaultMasterKey',
        '*.cookie',
        '*.Cookie',
      ],
      censor: '[redacted]',
    },
  }, destination);
}
