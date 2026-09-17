-- =============================================================================
-- Ei Point / Ei Flow — Supabase (Postgres) schema
-- Source of truth for: identity, server authorization, bot config, moderation
-- records and security events. Low write volume, relational, RLS-protected.
--
-- Compatibility entrypoint: applies every migration in filename order.
--
-- Prefer migration-aware execution with a persistent migration ledger:
--   npm run migrate:supabase
--
-- The runner applies files from infra/supabase/migrations in lexical order,
-- records them in the ledger, and stops on the first failed migration.
--
-- High-volume activity data (logs, xp, card games, inventories, ai context)
-- lives in MongoDB — see infra/mongo/init.js. Do NOT put it here; each free
-- tier caps at ~500MB and the split is what keeps both under the ceiling.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type security_severity as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mod_action_type as enum ('warn', 'mute', 'unmute', 'ban', 'unban', 'purge', 'kick', 'automod');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- users — linked 1:1 to Supabase Auth identities (Discord OAuth)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  discord_id  text not null unique,
  username    text,
  avatar_url  text,
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- `is_master` is provisioned by a trusted migration/service-role path. The
-- browser role cannot change it; see the protected trigger below.
alter table public.users add column if not exists is_master boolean not null default false;
alter table public.users enable row level security;

create table if not exists public.admin_users (
  user_id uuid primary key references public.users(id) on delete cascade,
  role text not null check (role in ('master', 'operator', 'support')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.admin_users add column if not exists updated_at timestamptz not null default now();

alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

comment on table public.users is 'Dashboard identities. discord_id mirrors the Discord OAuth subject.';

-- Supabase Auth creates the identity row before dashboard authorization runs. The
-- trigger provisions the RLS-visible profile atomically; service-role SQL remains
-- available for repairing identities whose provider metadata is incomplete.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_id text;
begin
  provider_id := coalesce(
    nullif(new.raw_user_meta_data ->> 'provider_id', ''),
    nullif(new.raw_user_meta_data ->> 'sub', ''),
    'auth:' || new.id::text
  );

  insert into public.users (id, discord_id, username, avatar_url)
  values (
    new.id,
    provider_id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set username = excluded.username,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to service_role;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- One-time IDs for privileged bot-to-dashboard requests. The primary key makes
-- replay rejection atomic across serverless instances.
create table if not exists public.internal_request_nonces (
  request_id text primary key check (length(request_id) between 16 and 128),
  created_at timestamptz not null default now()
);
drop function if exists public.apply_bot_config_request(text, text, text, jsonb);
drop function if exists public.apply_bot_config_request(text, text, text, jsonb, boolean);

create or replace function public.apply_bot_config_request(
  p_request_id text,
  p_guild_id text,
  p_bot_id text,
  p_config jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_nonce_count integer;
begin
  if not exists (select 1 from public.servers where guild_id = p_guild_id and authorized = true)
     or exists (
       select 1
       from public.guild_whitelists
       where guild_id = p_guild_id
         and removed_at is null
         and (
           whitelist_type = 'unauthorised'
           or (whitelist_type = 'temp' and (expires_at is null or expires_at <= now()))
         )
     )
     or not exists (
       select 1
       from public.guild_whitelists
       where guild_id = p_guild_id
         and removed_at is null
         and (
           whitelist_type = 'full'
           or (whitelist_type = 'temp' and expires_at > now())
         )
     ) then
    raise exception 'guild is not authorized';
  end if;

  insert into public.internal_request_nonces(request_id)
  values (p_request_id)
  on conflict (request_id) do nothing;
  get diagnostics inserted_nonce_count = row_count;
  if inserted_nonce_count = 0 then
    return false;
  end if;

  insert into public.bot_configs(guild_id, bot_id, config, updated_at)
  values (p_guild_id, p_bot_id, p_config, now())
  on conflict (guild_id, bot_id) do update
    set config = excluded.config, updated_at = excluded.updated_at;
  return true;
end;
$$;

revoke all on function public.apply_bot_config_request(text, text, text, jsonb) from public;
grant execute on function public.apply_bot_config_request(text, text, text, jsonb) to service_role;

create or replace function public.prevent_user_authority_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.id <> old.id
     or new.discord_id <> old.discord_id
     or new.is_owner <> old.is_owner
     or new.is_master <> old.is_master
     or new.created_at <> old.created_at then
    raise exception 'protected user fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists users_protect_authority on public.users;
create trigger users_protect_authority
  before update on public.users
  for each row execute function public.prevent_user_authority_changes();

-- ---------------------------------------------------------------------------
-- servers — the authorization gate. A guild the bot is not authorized for is
-- left immediately on guildCreate (see packages/shared/src/server-lock.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  guild_id    text not null unique,
  name        text,
  icon_url    text,
  owner_id    text,
  authorized  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists servers_owner_id_idx on public.servers (owner_id);
create index if not exists servers_authorized_idx on public.servers (authorized) where authorized = true;

comment on column public.servers.authorized is 'Server-lock gate. false => every bot auto-leaves the guild.';

-- ---------------------------------------------------------------------------
-- guild_access — trusted dashboard relationships populated only by server-side
-- Discord verification or bot audit-log attribution. Browser roles cannot write.
-- ---------------------------------------------------------------------------
create table if not exists public.guild_access (
  id                uuid primary key default gen_random_uuid(),
  guild_id          text not null references public.servers(guild_id) on delete cascade,
  discord_user_id   text not null check (discord_user_id ~ '^\\d{17,20}$'),
  access_source     text not null check (access_source in ('owner', 'administrator', 'inviter')),
  verified_at       timestamptz not null default now(),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (guild_id, discord_user_id, access_source)
);

create index if not exists guild_access_user_idx
  on public.guild_access (discord_user_id, guild_id)
  where revoked_at is null;
create index if not exists guild_access_guild_idx
  on public.guild_access (guild_id)
  where revoked_at is null;

comment on table public.guild_access is 'Server-verified owner, administrator, or bot-inviter relationships; browser writes are forbidden.';

-- ---------------------------------------------------------------------------
-- bot_configs — one JSON blob per (guild, bot). Flexible so adding a setting to
-- any of the 8 bots never requires a migration.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_configs (
  id          uuid primary key default gen_random_uuid(),
  guild_id    text not null,
  bot_id      text not null,
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create unique index if not exists bot_configs_guild_bot_idx on public.bot_configs (guild_id, bot_id);
create index if not exists bot_configs_bot_idx on public.bot_configs (bot_id);

-- ---------------------------------------------------------------------------
-- mod_actions — append-mostly. Archive rows older than 90 days to Mongo
-- (see infra/cron/archive.sql) to keep this table bounded.
-- ---------------------------------------------------------------------------
create table if not exists public.mod_actions (
  id               uuid primary key default gen_random_uuid(),
  guild_id         text not null,
  bot_id           text not null,
  action           mod_action_type not null,
  target_id        text not null,
  moderator_id     text not null,
  reason           text,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  active           boolean not null default true,
  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists mod_actions_guild_created_idx on public.mod_actions (guild_id, created_at desc);
create index if not exists mod_actions_target_idx on public.mod_actions (guild_id, target_id, created_at desc);
create index if not exists mod_actions_active_idx on public.mod_actions (guild_id, active) where active = true;
create index if not exists mod_actions_expires_idx on public.mod_actions (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- security_events — antinuke incident log
-- ---------------------------------------------------------------------------
create table if not exists public.security_events (
  id            uuid primary key default gen_random_uuid(),
  guild_id      text not null,
  event_type    text not null,
  actor_id      text not null,
  severity      security_severity not null default 'medium',
  details       jsonb not null default '{}'::jsonb,
  action_taken  text,
  created_at    timestamptz not null default now()
);

create index if not exists security_events_guild_created_idx on public.security_events (guild_id, created_at desc);
create index if not exists security_events_severity_idx on public.security_events (guild_id, severity, created_at desc);

-- ---------------------------------------------------------------------------
-- antinuke_whitelist — users/roles exempt from antinuke enforcement
-- ---------------------------------------------------------------------------
create table if not exists public.antinuke_whitelist (
  id           uuid primary key default gen_random_uuid(),
  guild_id     text not null,
  target_type  text not null check (target_type in ('user', 'role')),
  target_id    text not null,
  created_at   timestamptz not null default now()
);

create unique index if not exists antinuke_whitelist_unique_idx
  on public.antinuke_whitelist (guild_id, target_type, target_id);
create index if not exists antinuke_whitelist_guild_idx on public.antinuke_whitelist (guild_id);

-- =============================================================================
-- Row Level Security
-- Bots connect with the service role key and bypass RLS entirely. These
-- policies govern the *dashboard*, so a logged-in user can only ever see and
-- mutate servers they own.
-- =============================================================================

alter table public.users              enable row level security;
alter table public.servers            enable row level security;
alter table public.bot_configs        enable row level security;
alter table public.mod_actions        enable row level security;
alter table public.security_events    enable row level security;
alter table public.antinuke_whitelist enable row level security;
alter table public.internal_request_nonces enable row level security;
revoke all on public.internal_request_nonces from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Control-plane administration and multi-account metadata
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists is_master boolean not null default false;

create table if not exists public.infra_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mongodb', 'redis', 'supabase')),
  account_name text not null check (length(account_name) between 1 and 80),
  region text,
  secret_ref text not null check (length(secret_ref) between 1 and 160),
  endpoint text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_name)
);

create table if not exists public.bot_states (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.servers(guild_id) on delete cascade,
  bot_id text not null check (bot_id in ('cyrene', 'luffy', 'zoro', 'nami', 'sanji', 'shanks', 'niko-robin', 'boahancock')),
  enabled boolean not null default true,
  paused boolean not null default false,
  feature_flags jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (guild_id, bot_id)
);

create table if not exists public.server_settings (
  guild_id text primary key references public.servers(guild_id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  notifications_enabled boolean not null default true,
  server_paused boolean not null default false,
  notification_preferences jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- secret_records — encrypted provider credentials and bootstrap metadata
-- ---------------------------------------------------------------------------
-- Plaintext credentials never belong in this table. The dashboard seals them
-- with AES-256-GCM before writing, and only the server-side vault module can
-- decrypt them with SECRET_VAULT_MASTER_KEY.
create table if not exists public.secret_records (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  provider     text not null check (provider in ('mongodb', 'supabase', 'redis', 'firebase', 'cloudflare', 'core', 'other')),
  label        text not null check (length(label) between 1 and 160),
  ciphertext   text not null,
  iv           text not null,
  auth_tag     text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  revoked_at   timestamptz
);

create unique index if not exists secret_records_active_name_uidx
  on public.secret_records (name) where revoked_at is null;
create index if not exists secret_records_provider_idx
  on public.secret_records (provider) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- guild_whitelists — command access separate from server discovery
-- ---------------------------------------------------------------------------
create table if not exists public.guild_whitelists (
  id             uuid primary key default gen_random_uuid(),
  guild_id       text not null check (guild_id ~ '^\\d{17,20}$'),
  whitelist_type text not null check (whitelist_type in ('full', 'temp', 'unauthorised')),
  expires_at     timestamptz,
  note           text,
  added_by       uuid references public.users(id),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     uuid references public.users(id),
  check (whitelist_type <> 'temp' or expires_at is not null),
  check (whitelist_type <> 'full' or expires_at is null)
);

create unique index if not exists guild_whitelists_active_uidx
  on public.guild_whitelists (guild_id) where removed_at is null;
create index if not exists guild_whitelists_active_type_idx
  on public.guild_whitelists (whitelist_type) where removed_at is null;

create or replace function public.set_guild_whitelist(
  p_guild_id text,
  p_whitelist_type text,
  p_expires_at timestamptz default null,
  p_note text default null,
  p_added_by uuid default null
)
returns public.guild_whitelists
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.guild_whitelists;
begin
  if p_guild_id !~ '^\d{17,20}$' then raise exception 'invalid guild id'; end if;
  if p_whitelist_type not in ('full', 'temp', 'unauthorised') then raise exception 'invalid whitelist type'; end if;
  if p_whitelist_type = 'temp' and (p_expires_at is null or p_expires_at <= now()) then raise exception 'temporary whitelist must expire in the future'; end if;
  if p_whitelist_type = 'full' and p_expires_at is not null then raise exception 'full whitelist cannot expire'; end if;

  update public.guild_whitelists
    set removed_at = now(), removed_by = p_added_by
    where guild_id = p_guild_id and removed_at is null;

  insert into public.guild_whitelists(guild_id, whitelist_type, expires_at, note, added_by)
    values (p_guild_id, p_whitelist_type, case when p_whitelist_type = 'temp' then p_expires_at else null end, p_note, p_added_by)
    returning * into result;

  update public.servers
    set authorized = p_whitelist_type <> 'unauthorised', updated_at = now()
    where guild_id = p_guild_id;
  return result;
end;
$$;

create or replace function public.revoke_guild_whitelist(
  p_guild_id text,
  p_removed_by uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  update public.guild_whitelists
    set removed_at = now(), removed_by = p_removed_by
    where guild_id = p_guild_id and removed_at is null;
  get diagnostics changed_count = row_count;
  update public.servers
    set authorized = false, updated_at = now()
    where guild_id = p_guild_id;
  return changed_count > 0;
end;
$$;

revoke all on function public.set_guild_whitelist(text, text, timestamptz, text, uuid) from public;
revoke all on function public.revoke_guild_whitelist(text, uuid) from public;
grant execute on function public.set_guild_whitelist(text, text, timestamptz, text, uuid) to service_role;
grant execute on function public.revoke_guild_whitelist(text, uuid) to service_role;

create index if not exists bot_states_guild_idx on public.bot_states (guild_id);
create index if not exists bot_states_enabled_idx on public.bot_states (enabled, paused);
create index if not exists infra_accounts_provider_idx on public.infra_accounts (provider, enabled);

alter table public.infra_accounts enable row level security;
alter table public.bot_states enable row level security;
alter table public.server_settings enable row level security;
alter table public.secret_records enable row level security;
alter table public.guild_whitelists enable row level security;
alter table public.guild_access enable row level security;
revoke all on public.guild_access from anon, authenticated;

-- Helper: does the current dashboard user own this guild?
create or replace function public.owns_guild(p_guild_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.servers s
    join public.users u on u.discord_id = s.owner_id
    where s.guild_id = p_guild_id
      and u.id = auth.uid()
  );
$$;

-- SECURITY DEFINER functions default to PUBLIC EXECUTE, which would let
-- `anon` and any future role probe ownership. Restrict to the roles the
-- dashboard actually uses. Idempotent; re-runs are no-ops.
revoke all on function public.owns_guild(text) from public;
grant execute on function public.owns_guild(text) to authenticated, service_role;

-- Master access is intentionally a separate security-definer predicate. It
-- avoids recursive RLS policies. Privilege is provisioned only through
-- database state controlled by a trusted server-side migration/bootstrap path.
create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.role = 'master'
  );
$$;

-- Trusted owner/administrator/inviter relationships are written only by
-- service-role reconciliation. Existing owner rows remain a compatibility
-- fallback until the first successful Discord verification.
create or replace function public.has_guild_access(p_guild_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_master_user()
    or exists (
      select 1
      from public.guild_access a
      join public.users u on u.discord_id = a.discord_user_id
      where a.guild_id = p_guild_id
        and a.revoked_at is null
        and u.id = auth.uid()
    )
    or public.owns_guild(p_guild_id);
$$;

revoke all on function public.has_guild_access(text) from public;
grant execute on function public.has_guild_access(text) to authenticated, service_role;

-- Same lockdown as `owns_guild` above.
revoke all on function public.is_master_user() from public;
grant execute on function public.is_master_user() to authenticated, service_role;

 drop policy if exists guild_access_self_select on public.guild_access;
create policy guild_access_self_select on public.guild_access
  for select using (
    public.is_master_user()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.discord_id = guild_access.discord_user_id
    )
  );

drop policy if exists admin_users_master_read on public.admin_users;
create policy admin_users_master_read on public.admin_users
  for select using (public.is_master_user());

create or replace function public.can_access_guild(p_guild_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_master_user() or public.owns_guild(p_guild_id);
$$;

revoke execute on function public.is_master_user() from public;
grant execute on function public.is_master_user() to authenticated, service_role;
revoke execute on function public.can_access_guild(text) from public;
grant execute on function public.can_access_guild(text) to authenticated, service_role;

-- users: read/update own row only
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (id = auth.uid());

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- The row-level policy above cannot see *which* columns changed, so on its own
-- it lets a token holder flip `is_owner` on their own row and self-promote to
-- guild owner (and re-point `discord_id`). Column privileges close that: the
-- authenticated role may only maintain cosmetic profile fields.
--
-- This is a GRANT, not RLS, so it does not affect the `service_role` the bots
-- use to provision rows — it only constrains browser-presented tokens.
revoke update on public.users from anon, authenticated;
grant update (username, avatar_url, updated_at) on public.users to authenticated;

-- servers
drop policy if exists servers_owner_select on public.servers;
create policy servers_owner_select on public.servers
  for select using (public.can_access_guild(guild_id));

-- `authorized` is the master-only server-lock gate. Browser sessions must
-- never be able to update this table; whitelist routes use the service-role
-- client after `authorizeMaster()` has succeeded.
drop policy if exists servers_owner_update on public.servers;
revoke update on public.servers from anon, authenticated;

-- Master-only infrastructure metadata. Secret values are never stored here;
-- secret_ref points to the deployment secret manager key.
drop policy if exists infra_accounts_master_all on public.infra_accounts;
create policy infra_accounts_master_all on public.infra_accounts
  for all using (public.is_master_user()) with check (public.is_master_user());

drop policy if exists secret_records_master_all on public.secret_records;
create policy secret_records_master_all on public.secret_records
  for all using (public.is_master_user()) with check (public.is_master_user());

drop policy if exists guild_whitelists_select on public.guild_whitelists;
create policy guild_whitelists_select on public.guild_whitelists
  for select using (public.can_access_guild(guild_id));

drop policy if exists guild_whitelists_master_write on public.guild_whitelists;
create policy guild_whitelists_master_write on public.guild_whitelists
  for all using (public.is_master_user()) with check (public.is_master_user());

drop policy if exists bot_states_access on public.bot_states;
create policy bot_states_access on public.bot_states
  for all using (public.can_access_guild(guild_id)) with check (public.can_access_guild(guild_id));

drop policy if exists server_settings_access on public.server_settings;
create policy server_settings_access on public.server_settings
  for all using (public.can_access_guild(guild_id)) with check (public.can_access_guild(guild_id));

-- bot_configs
drop policy if exists bot_configs_owner_rw on public.servers;
drop policy if exists bot_configs_owner_rw on public.bot_configs;
create policy bot_configs_owner_rw on public.bot_configs
  for all using (public.can_access_guild(guild_id)) with check (public.can_access_guild(guild_id));

-- mod_actions: owner read/write, never delete via the dashboard (audit trail)
drop policy if exists mod_actions_owner_select on public.mod_actions;
create policy mod_actions_owner_select on public.mod_actions
  for select using (public.can_access_guild(guild_id));

drop policy if exists mod_actions_owner_insert on public.mod_actions;
create policy mod_actions_owner_insert on public.mod_actions
  for insert with check (public.can_access_guild(guild_id));

-- security_events: owner read-only
drop policy if exists security_events_owner_select on public.security_events;
create policy security_events_owner_select on public.security_events
  for select using (public.can_access_guild(guild_id));

-- antinuke_whitelist: owner read/write/delete
drop policy if exists antinuke_whitelist_owner_rw on public.antinuke_whitelist;
create policy antinuke_whitelist_owner_rw on public.antinuke_whitelist
  for all using (public.can_access_guild(guild_id)) with check (public.can_access_guild(guild_id));

-- =============================================================================
-- Retention: archive mod_actions/security_events older than 90 days.
-- Run from the weekly GitHub Action cron (see .github/workflows/quota-report.yml).
-- =============================================================================
create or replace function public.rows_to_archive(p_days integer default 90)
returns table (tbl text, row_count bigint)
language sql
stable
as $$
  select 'mod_actions'::text, count(*) from public.mod_actions
    where created_at < now() - (p_days || ' days')::interval
  union all
  select 'security_events'::text, count(*) from public.security_events
    where created_at < now() - (p_days || ' days')::interval;
$$;
