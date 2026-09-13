import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { gainedDangerousPermissions } from './enforce.js';
import { DEFAULT_CONFIG, EMERGENCY_CONFIG, thresholdFor } from './store.js';

describe('antinuke adversarial logic', () => {
  it('detects only newly gained dangerous permissions', () => {
    const before = BigInt(PermissionFlagsBits.ManageGuild).toString();
    const after = BigInt(PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator).toString();

    expect(gainedDangerousPermissions(before, after)).toEqual(['Administrator']);
    expect(gainedDangerousPermissions(after, after)).toEqual([]);
    expect(gainedDangerousPermissions(null, 'invalid')).toEqual([]);
  });

  it('uses the configured threshold for mass membership and structural actions', () => {
    const config = {
      ...DEFAULT_CONFIG,
      banThreshold: 3,
      channelThreshold: 2,
      roleThreshold: 4,
    };

    expect(thresholdFor(config, 'member_ban')).toBe(3);
    expect(thresholdFor(config, 'member_kick')).toBe(3);
    expect(thresholdFor(config, 'channel_delete')).toBe(2);
    expect(thresholdFor(config, 'role_delete')).toBe(4);
  });

  it('fails safe to notification-only detection when configuration storage is unavailable', () => {
    expect(EMERGENCY_CONFIG.enabled).toBe(true);
    expect(EMERGENCY_CONFIG.mode).toBe('notify');
    expect(EMERGENCY_CONFIG.punishment).toBe('none');
    expect(thresholdFor(EMERGENCY_CONFIG, 'member_ban')).toBe(1);
    expect(thresholdFor(EMERGENCY_CONFIG, 'channel_delete')).toBe(1);
  });
});
