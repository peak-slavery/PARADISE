-- =============================================================================
-- Ei Point / Ei Flow — Supabase (Postgres) schema
-- Source of truth for: identity, server authorization, bot config, moderation
-- records and security events. Low write volume, relational, RLS-protected.
--
-- Apply: psql "$SUPABASE_DB_URL" -f infra/supabase/schema.sql
--    or: paste into the Supabase SQL editor.
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

comment on table public.users is 'Dashboard identities. discord_id mirrors the Discord OAuth subject.';

-- One-time IDs for privileged bot-to-dashboard requests. The primary key makes
-- replay rejection atomic across serverless instances.
create table if not exists public.internal_request_nonces (
  request_id text primary key check (length(request_id) between 16 and 128),
  created_at timestamptz not null default now()
);
create index if not exists internal_request_nonces_created_idx
  on public.internal_request_nonces (created_at);

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

create index if not exists bot_states_guild_idx on public.bot_states (guild_id);
create index if not exists bot_states_enabled_idx on public.bot_states (enabled, paused);
create index if not exists infra_accounts_provider_idx on public.infra_accounts (provider, enabled);

alter table public.infra_accounts enable row level security;
alter table public.bot_states enable row level security;
alter table public.server_settings enable row level security;
alter table public.secret_records enable row level security;
alter table public.guild_whitelists enable row level security;

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

-- Master access is intentionally a separate security-definer predicate. It
-- avoids recursive RLS policies and allows a DB flag plus the immutable
-- operator identity to be enforced in one place.
create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (u.is_master = true or u.discord_id = '1479589523426902208')
  );
$$;

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

drop policy if exists servers_owner_update on public.servers;
create policy servers_owner_update on public.servers
  for update using (public.can_access_guild(guild_id)) with check (public.can_access_guild(guild_id));

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
  for all using (public.owns_guild(guild_id)) with check (public.owns_guild(guild_id));

-- mod_actions: owner read/write, never delete via the dashboard (audit trail)
drop policy if exists mod_actions_owner_select on public.mod_actions;
create policy mod_actions_owner_select on public.mod_actions
  for select using (public.owns_guild(guild_id));

drop policy if exists mod_actions_owner_insert on public.mod_actions;
create policy mod_actions_owner_insert on public.mod_actions
  for insert with check (public.owns_guild(guild_id));

-- security_events: owner read-only
drop policy if exists security_events_owner_select on public.security_events;
create policy security_events_owner_select on public.security_events
  for select using (public.owns_guild(guild_id));

-- antinuke_whitelist: owner read/write/delete
drop policy if exists antinuke_whitelist_owner_rw on public.antinuke_whitelist;
create policy antinuke_whitelist_owner_rw on public.antinuke_whitelist
  for all using (public.owns_guild(guild_id)) with check (public.owns_guild(guild_id));

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
