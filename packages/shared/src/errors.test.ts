import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessGuards } from './errors.js';

describe('process guards', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('terminates after an uncaught exception is reported', () => {
    const fatal = vi.fn();
    const cleanup = installProcessGuards('test-bot', { error: vi.fn() }, fatal);
    cleanups.push(cleanup);

    const error = new Error('uncaught');
    process.emit('uncaughtException', error);

    expect(fatal).toHaveBeenCalledOnce();
  });

  it('terminates after an unhandled rejection is reported', () => {
    const fatal = vi.fn();
    const cleanup = installProcessGuards('test-bot', { error: vi.fn() }, fatal);
    cleanups.push(cleanup);

    process.emit('unhandledRejection', new Error('rejected'), Promise.resolve());

    expect(fatal).toHaveBeenCalledOnce();
  });
});
