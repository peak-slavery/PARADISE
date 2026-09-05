import { describe, expect, it } from 'vitest';
import { isBotOperational } from './control.js';

describe('bot control state', () => {
  it('allows event work only when all control switches are open', () => {
    expect(isBotOperational({ enabled: true, paused: false, serverPaused: false, featureFlags: {} })).toBe(true);
    expect(isBotOperational({ enabled: false, paused: false, serverPaused: false, featureFlags: {} })).toBe(false);
    expect(isBotOperational({ enabled: true, paused: true, serverPaused: false, featureFlags: {} })).toBe(false);
    expect(isBotOperational({ enabled: true, paused: false, serverPaused: true, featureFlags: {} })).toBe(false);
  });
});
