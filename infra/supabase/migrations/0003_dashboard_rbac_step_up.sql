-- Dashboard operation roles and durable, MFA-bound step-up authorization.
--
-- Browser sessions may resolve roles and create/consume operation challenges
-- only through the security-definer RPCs below. They never receive direct write
-- access to admin_users or dashboard_step_up_challenges.

alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check
  check (role in ('master', 'operator', 'support', 'OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN', 'BOT_OPERATOR', 'AUDITOR'));

create table if not exists public.dashboard_step_up_challenges (
  challenge_id       text primary key check (challenge_id ~ '^[a-f0-9]{32}$'),
  user_id            uuid not null references public.users(id) on delete cascade,
  operation          text not null check (operation in ('guild.bot_state.write', 'guild.embed.send', 'security.remediate', 'secret.write', 'secret.reveal', 'guild.access.write', 'infrastructure.write')),
  scope              text not null check (scope in ('global', 'guild')),
  guild_id           text check (guild_id is null or guild_id ~ '^\d{17,20}$'),
  mfa_challenge_id   text not null check (mfa_challenge_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  mfa_factor_id      text not null check (mfa_factor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  mfa_expires_at     timestamptz not null,
  roles              text[] not null check (cardinality(roles) > 0),
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  grant_expires_at   timestamptz,
  attempts           integer not null default 0 check (attempts >= 0)
);

-- Keep the legacy delivery column available if an earlier draft migration was
-- applied, but new RPCs do not use it.
alter table public.dashboard_step_up_challenges
  add column if not exists delivery text;

alter table public.dashboard_step_up_challenges
  add column if not exists mfa_challenge_id text;
alter table public.dashboard_step_up_challenges
  add column if not exists mfa_factor_id text;
alter table public.dashboard_step_up_challenges
  add column if not exists mfa_expires_at timestamptz;

-- Existing draft rows cannot be valid proof because they have no MFA binding.
update public.dashboard_step_up_challenges
set consumed_at = now()
where consumed_at is null
  and (mfa_challenge_id is null or mfa_factor_id is null or mfa_expires_at is null);

create unique index if not exists dashboard_step_up_active_idx
  on public.dashboard_step_up_challenges (user_id, operation, scope, coalesce(guild_id, ''))
  where consumed_at is null;
create index if not exists dashboard_step_up_user_idx
  on public.dashboard_step_up_challenges (user_id, expires_at)
  where consumed_at is null;
create index if not exists dashboard_step_up_active_user_idx
  on public.dashboard_step_up_challenges (user_id, issued_at)
  where consumed_at is null;

alter table public.dashboard_step_up_challenges enable row level security;
revoke all on public.dashboard_step_up_challenges from anon, authenticated;
drop policy if exists dashboard_step_up_self_select on public.dashboard_step_up_challenges;
create policy dashboard_step_up_self_select on public.dashboard_step_up_challenges
  for select using (user_id = auth.uid());

create or replace function public.dashboard_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(
      case a.role
        when 'master' then 'OWNER'
        when 'operator' then 'BOT_OPERATOR'
        when 'support' then 'AUDITOR'
        else a.role
      end
      order by a.role
    ),
    array[]::text[]
  )
  from public.admin_users a
  where a.user_id = auth.uid()
    and a.role in ('master', 'operator', 'support', 'OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN', 'BOT_OPERATOR', 'AUDITOR');
$$;

-- OWNER is the normalized form of the legacy master role. Keep the legacy
-- predicate for existing callers, but make it honor the same mapping.
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
      and a.role in ('master', 'OWNER')
  );
$$;

drop function if exists public.issue_dashboard_step_up(text, text, text, text);
drop function if exists public.issue_dashboard_step_up(text, text, text, text, text, timestamptz);

create or replace function public.issue_dashboard_step_up(
  p_operation text,
  p_scope text,
  p_guild_id text,
  p_mfa_challenge_id text,
  p_mfa_factor_id text,
  p_mfa_expires_at timestamptz
)
returns public.dashboard_step_up_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_roles text[];
  required_roles text[];
  issued public.dashboard_step_up_challenges%rowtype;
  active_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_operation not in ('guild.bot_state.write', 'guild.embed.send', 'security.remediate', 'secret.write', 'secret.reveal', 'guild.access.write', 'infrastructure.write')
     or p_scope not in ('global', 'guild')
     or p_mfa_challenge_id is null
     or p_mfa_challenge_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_mfa_factor_id is null
     or p_mfa_factor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_mfa_expires_at is null
     or p_mfa_expires_at <= now()
     or (p_scope = 'guild' and (p_guild_id is null or p_guild_id !~ '^\d{17,20}$'))
     or (p_scope = 'global' and p_guild_id is not null) then
    raise exception 'invalid step-up request';
  end if;
  if p_operation in ('guild.bot_state.write', 'guild.embed.send') then
    required_roles := array['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN'];
  elsif p_operation = 'security.remediate' then
    required_roles := array['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'];
  else
    required_roles := array['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'];
  end if;

  select coalesce(array_agg(case a.role
    when 'master' then 'OWNER'
    when 'operator' then 'BOT_OPERATOR'
    when 'support' then 'AUDITOR'
    else a.role
  end order by a.role), array[]::text[])
  into actor_roles
  from public.admin_users a
  where a.user_id = auth.uid()
    and a.role in ('master', 'operator', 'support', 'OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN', 'BOT_OPERATOR', 'AUDITOR');
  if not (actor_roles && required_roles) then
    raise exception 'step-up operation forbidden';
  end if;
  if p_scope = 'guild' and not public.has_guild_access(p_guild_id) then
    raise exception 'guild access required';
  end if;

  select count(*) into active_count
  from public.dashboard_step_up_challenges
  where user_id = auth.uid()
    and consumed_at is null
    and expires_at > now();
  if active_count >= 8 then
    raise exception 'too many active step-up challenges';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || p_operation || ':' || p_scope || ':' || coalesce(p_guild_id, '')));
  delete from public.dashboard_step_up_challenges
  where user_id = auth.uid()
    and operation = p_operation
    and scope = p_scope
    and coalesce(guild_id, '') = coalesce(p_guild_id, '')
    and consumed_at is null;

  insert into public.dashboard_step_up_challenges (
    challenge_id, user_id, operation, scope, guild_id,
    mfa_challenge_id, mfa_factor_id, mfa_expires_at, roles, expires_at
  ) values (
    encode(gen_random_bytes(16), 'hex'), auth.uid(), p_operation, p_scope,
    case when p_scope = 'guild' then p_guild_id else null end,
    p_mfa_challenge_id, p_mfa_factor_id, p_mfa_expires_at, actor_roles,
    least(now() + interval '5 minutes', p_mfa_expires_at)
  )
  returning * into issued;
  return issued;
end;
$$;

drop function if exists public.consume_dashboard_step_up(text, uuid);
drop function if exists public.consume_dashboard_step_up(text, text, text);

create or replace function public.consume_dashboard_step_up(
  p_challenge_id text,
  p_mfa_challenge_id text,
  p_mfa_factor_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  issued public.dashboard_step_up_challenges%rowtype;
  auth_method jsonb;
  fresh_mfa boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;
  if p_challenge_id is null or p_challenge_id !~ '^[a-f0-9]{32}$'
     or p_mfa_challenge_id is null or p_mfa_challenge_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_mfa_factor_id is null or p_mfa_factor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_challenge_id));
  update public.dashboard_step_up_challenges
  set attempts = attempts + 1
  where challenge_id = p_challenge_id
    and user_id = auth.uid()
    and consumed_at is null
    and expires_at > now()
    and attempts < 5
  returning * into issued;
  if issued.challenge_id is null then
    return false;
  end if;
  if issued.mfa_challenge_id <> p_mfa_challenge_id
     or issued.mfa_factor_id <> p_mfa_factor_id
     or issued.mfa_expires_at is null
     or issued.mfa_expires_at <= now() then
    return false;
  end if;
  if auth.jwt() ->> 'aal' <> 'aal2' then
    return false;
  end if;

  for auth_method in
    select value
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as value
  loop
    if auth_method ->> 'method' in ('otp', 'totp', 'phone', 'webauthn', 'mfa')
       and auth_method ->> 'timestamp' ~ '^[0-9]+(\.[0-9]+)?$'
       and (auth_method ->> 'timestamp')::double precision >= extract(epoch from issued.issued_at) then
      fresh_mfa := true;
      exit;
    end if;
  end loop;
  if not fresh_mfa then
    return false;
  end if;

  update public.dashboard_step_up_challenges
  set consumed_at = now(),
      grant_expires_at = now() + interval '5 minutes'
  where challenge_id = p_challenge_id
    and user_id = auth.uid()
    and consumed_at is null;
  return found;
end;
$$;

create or replace function public.revoke_dashboard_step_up_grant(p_challenge_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  update public.dashboard_step_up_challenges
  set grant_expires_at = now()
  where challenge_id = p_challenge_id
    and user_id = auth.uid()
    and consumed_at is not null
    and grant_expires_at > now();
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

revoke all on function public.dashboard_roles() from public;
grant execute on function public.dashboard_roles() to authenticated, service_role;
revoke all on function public.is_master_user() from public;
grant execute on function public.is_master_user() to authenticated, service_role;
revoke all on function public.issue_dashboard_step_up(text, text, text, text, text, timestamptz) from public;
grant execute on function public.issue_dashboard_step_up(text, text, text, text, text, timestamptz) to authenticated, service_role;
revoke all on function public.consume_dashboard_step_up(text, text, text) from public;
grant execute on function public.consume_dashboard_step_up(text, text, text) to authenticated, service_role;
revoke all on function public.revoke_dashboard_step_up_grant(text) from public;
grant execute on function public.revoke_dashboard_step_up_grant(text) to authenticated, service_role;
