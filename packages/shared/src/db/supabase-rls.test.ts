import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../../../infra/supabase/schema.sql', import.meta.url), 'utf8');

describe('Supabase row-level security', () => {
  it('locks privileged and internal tables away from browser roles', () => {
    for (const table of ['admin_users', 'internal_request_nonces']) {
      expect(schema).toContain(`alter table public.${table} enable row level security`);
      expect(schema).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
  });

  it('allows users to read and update only their own profile', () => {
    expect(schema).toContain('create policy users_self_select on public.users');
    expect(schema).toContain('create policy users_self_update on public.users');
    expect(schema).toContain('grant update (username, avatar_url, updated_at) on public.users to authenticated');
  });

  it('gates every guild-scoped table through owner or provisioned master access', () => {
    const gatedPolicies = [
      'servers_owner_select',
      'infra_accounts_master_all',
      'secret_records_master_all',
      'guild_whitelists_select',
      'guild_whitelists_master_write',
      'bot_states_access',
      'server_settings_access',
      'bot_configs_owner_rw',
      'mod_actions_owner_select',
      'mod_actions_owner_insert',
      'security_events_owner_select',
      'antinuke_whitelist_owner_rw',
    ];
    for (const policy of gatedPolicies) {
      expect(schema).toContain(`create policy ${policy} on public.`);
    }
  });

  it('keeps cross-guild access server-evaluated and master access database-provisioned', () => {
    expect(schema).toContain('create or replace function public.owns_guild(p_guild_id text)');
    expect(schema).toContain('create or replace function public.is_master_user()');
    expect(schema).toContain('select public.is_master_user() or public.owns_guild(p_guild_id)');
    expect(schema).not.toContain("is_master boolean and a.role = 'master'");
  });
});
