import { describe, expect, it } from 'vitest';
import { BOTS, getBot, isBotId } from './bots';

describe('runtime configuration roster', () => {
  it('contains eight unique bots and rejects inherited object keys', () => {
    expect(new Set(BOTS.map((bot) => bot.id)).size).toBe(8);
    expect(isBotId('toString')).toBe(false);
  });
  it('uses the configuration keys consumed by welcome, leveling and moderation', () => {
    expect(getBot('boahancock').fields.map((field) => field.key)).toEqual(['welcome_channel', 'leave_channel', 'welcome_message', 'leave_message']);
    expect(getBot('nami').fields[0]?.key).toBe('level_channel');
    expect(getBot('shanks').fields[0]?.key).toBe('automod_log_channel');
    expect(getBot('sanji').fields.map((field) => field.key)).toContain('events.messages');
  });
});
