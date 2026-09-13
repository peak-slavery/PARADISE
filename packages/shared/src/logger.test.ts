import { describe, expect, it } from 'vitest';
import { createLogger, logOperationFields, type Env } from './index.js';

function testEnv(): Env {
  return {
    botId: '123456789012345678',
    botVersion: 'test',
    logLevel: 'trace',
  } as unknown as Env;
}

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk));
    },
  };
  return { lines, logger: createLogger(testEnv(), destination) };
}

describe('structured logger policy', () => {
  it('normalizes operation fields to production log names', () => {
    expect(logOperationFields({
      guildId: '123456789012345678',
      requestId: 'req_123',
      latencyMs: 42,
      status: 200,
      errorClass: 'TimeoutError',
    })).toEqual({
      guild_id: '123456789012345678',
      request_id: 'req_123',
      latency_ms: 42,
      status: 200,
      error_class: 'TimeoutError',
    });
  });

  it('includes service identity and ISO timestamps in every log line', () => {
    const { lines, logger } = captureLogger();
    logger.info('test message');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.service).toBe('discord-bot');
    expect(lines[0]?.bot_id).toBe('123456789012345678');
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.msg).toBe('test message');
    expect(typeof lines[0]?.time).toBe('string');
    expect(Number.isNaN(Date.parse(String(lines[0]?.time)))).toBe(false);
  });

  it('redacts credential-shaped context before transport', () => {
    const { lines, logger } = captureLogger();
    logger.info({
      request_id: 'request',
      token: 'discord-token',
      nested: { Authorization: 'Bearer token' },
    }, 'operation');

    expect(lines[0]?.token).toBe('[redacted]');
    expect((lines[0]?.nested as Record<string, unknown>)?.Authorization).toBe('[redacted]');
  });
});
