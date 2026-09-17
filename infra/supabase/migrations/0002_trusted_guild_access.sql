-- Trusted dashboard guild access relationships.
-- Browser sessions may read only rows relevant to auth.uid(); all writes are
-- reserved for service_role-backed bot/OAuth reconciliation.

create table if not exists public.guild_access (
  id                uuid primary key default gen_random_uuid(),
  guild_id          text not null references public.servers(guild_id) on delete cascade,
  discord_user_id   text not null check (discord_user_id ~ '^\d{17,20}$'),
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

alter table public.guild_access enable row level security;
revoke all on public.guild_access from anon, authenticated;

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
    or exists (
      select 1
      from public.servers s
      join public.users u on u.discord_id = s.owner_id
      where s.guild_id = p_guild_id and u.id = auth.uid()
    );
$$;

revoke all on function public.has_guild_access(text) from public;
grant execute on function public.has_guild_access(text) to authenticated, service_role;

drop policy if exists guild_access_self_select on public.guild_access;
create policy guild_access_self_select on public.guild_access
  for select using (
    public.is_master_user()
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.discord_id = guild_access.discord_user_id
    )
  );

create or replace function public.can_access_guild(p_guild_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_master_user() or public.has_guild_access(p_guild_id)
$$;

-- Backfill the existing owner relationship without trusting browser input.
insert into public.guild_access (guild_id, discord_user_id, access_source)
select s.guild_id, s.owner_id, 'owner'
from public.servers s
where s.owner_id is not null
  and s.owner_id ~ '^\d{17,20}$'
on conflict (guild_id, discord_user_id, access_source) do update
  set revoked_at = null,
      verified_at = now(),
      updated_at = now();

-- RLS must be evaluated through the server-side predicate, never by a client
-- supplied relationship row.
drop policy if exists guild_access_self_select on public.guild_access;
create policy guild_access_self_select on public.guild_access
  for select using (
    public.is_master_user()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.discord_id = guild_access.discord_user_id
    )
  );
