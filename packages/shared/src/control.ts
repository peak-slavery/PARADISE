import type { BotControlState } from './types.js';

export function isBotOperational(state: BotControlState): boolean {
  return state.enabled && !state.paused && !state.serverPaused;
}
