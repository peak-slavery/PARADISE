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
  for select using (public.owns_guild(guild_id));

drop policy if exists servers_owner_update on public.servers;
create policy servers_owner_update on public.servers
  for update using (public.owns_guild(guild_id)) with check (public.owns_guild(guild_id));

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
