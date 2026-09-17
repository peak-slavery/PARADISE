import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../../../infra/supabase/schema.sql', import.meta.url), 'utf8');
const trustedAccessMigration = readFileSync(
  new URL('../../../../infra/supabase/migrations/0002_trusted_guild_access.sql', import.meta.url),
  'utf8',
);

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
    expect(schema).toContain('create or replace function public.has_guild_access(p_guild_id text)');
    expect(schema).toContain('create or replace function public.is_master_user()');
    expect(schema).toContain('select public.is_master_user() or public.owns_guild(p_guild_id)');
    expect(trustedAccessMigration).toContain('select public.is_master_user() or public.has_guild_access(p_guild_id)');
    expect(schema).not.toContain("is_master boolean and a.role = 'master'");
  });

  it('forbids browser writes to guild_access and exposes only a self-scoped read', () => {
    // The trusted-relationship table is the authority for cross-guild access,
    // so a browser-writable policy here would be privilege escalation.
    expect(trustedAccessMigration).toContain('revoke all on public.guild_access from anon, authenticated');
    expect(trustedAccessMigration).toContain('alter table public.guild_access enable row level security');
    // Only a SELECT policy may exist; no insert/update/delete policy for browser roles.
    expect(trustedAccessMigration).not.toMatch(/create policy[^;]*on public\.guild_access\s+for (insert|update|delete|all)/i);
    // The single read policy must be scoped to the caller's own discord identity.
    expect(trustedAccessMigration).toMatch(/create policy guild_access_self_select on public\.guild_access[\s\S]*?u\.discord_id = guild_access\.discord_user_id/);
  });

  it('requires unrevoked trusted access rather than honouring stale relationships', () => {
    const predicate = trustedAccessMigration.slice(
      trustedAccessMigration.indexOf('function public.has_guild_access'),
      trustedAccessMigration.indexOf('grant execute on function public.has_guild_access'),
    );
    expect(predicate).toContain('a.revoked_at is null');
    expect(predicate).toContain('public.is_master_user()');
  });

  it('ships no destructive SQL in applied migrations', () => {
    // Migration 0002 runs against production data; losing guild relationships
    // or the servers table would be unrecoverable from that path.
    expect(trustedAccessMigration).not.toMatch(/\b(drop table|truncate|delete from)\b/i);
    // The backfill must be upsert-idempotent, not insert-only.
    expect(trustedAccessMigration).toContain('on conflict (guild_id, discord_user_id, access_source) do update');
  });
});
