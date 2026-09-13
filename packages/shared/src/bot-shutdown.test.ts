import { describe, expect, it } from 'vitest';
import { assertStartupActive, StartupCancelledError, withShutdownTimeout } from './bot.js';

describe('shutdown timeout', () => {
  it('resolves when cleanup exceeds the deadline', async () => {
    const started = Date.now();
    const outcome = await withShutdownTimeout(new Promise<void>(() => undefined), 10);
    expect(outcome).toBe('timed-out');
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('reports completion and ignores the abandoned operation rejection after a timeout', async () => {
    const abandoned = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('abandoned cleanup failed')), 20);
    });
    const outcome = await withShutdownTimeout(abandoned, 1);
    expect(outcome).toBe('timed-out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it('prevents login when shutdown begins during startup', () => {
    expect(() => assertStartupActive(true)).toThrow(StartupCancelledError);
    expect(() => assertStartupActive(false)).not.toThrow();
  });

  it('uses a stable cancellation sentinel', () => {
    const error = new StartupCancelledError('startup cancelled by shutdown');
    expect(error).toBeInstanceOf(StartupCancelledError);
    expect(error.name).toBe('StartupCancelledError');
  });
});
