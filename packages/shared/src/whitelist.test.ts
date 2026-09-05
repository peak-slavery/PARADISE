import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { removeGuildWhitelist, writeGuildWhitelist } from './whitelist.js';

const schema = readFileSync(new URL('../../../infra/supabase/schema.sql', import.meta.url), 'utf8');

describe('whitelist mutations', () => {
  it('invalidates the shared cache after grant and revoke', async () => {
    const calls: string[] = [];
    const supabase = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: { guild_id: '123456789012345678' }, error: null };
      },
    } as never;
    const kv = { del: async (key: string) => calls.push(key) } as never;

    await writeGuildWhitelist(supabase, { guildId: '123456789012345678', type: 'full', kv });
    await removeGuildWhitelist(supabase, '123456789012345678', null, kv);

    expect(calls).toEqual([
      'set_guild_whitelist',
      'wl:active:123456789012345678',
      'revoke_guild_whitelist',
      'wl:active:123456789012345678',
    ]);
  });
});

describe('config authorization migration', () => {
  it('requires a positive active whitelist unless legacy access is explicitly allowed', () => {
    expect(schema).toContain('not p_allow_legacy');
    expect(schema).toContain("whitelist_type = 'full'");
    expect(schema).toContain("whitelist_type = 'temp' and expires_at > now()");
  });
});
