-- Bootstrap the first dashboard master user.
--
-- Run with a Supabase service/admin database connection after the user has
-- signed in to the dashboard at least once:
--
-- PowerShell:
--   $env:MASTER_USER_ID = "<supabase-user-uuid>"
--   psql "$env:SUPABASE_DB_URL" -v master_user_id="$env:MASTER_USER_ID" -f infra/supabase/bootstrap-master.sql
--
-- Bash:
--   MASTER_USER_ID="<supabase-user-uuid>" \
--     psql "$SUPABASE_DB_URL" -v master_user_id="$MASTER_USER_ID" -f infra/supabase/bootstrap-master.sql
--
-- Keep this operation restricted to the Supabase service/admin connection. The
-- dashboard's anon/authenticated roles cannot read or modify admin_users.

do $bootstrap$
begin
  if :'master_user_id' = '' then
    raise exception 'master_user_id must be supplied with -v master_user_id=<uuid>';
  end if;
end
$bootstrap$;

insert into public.admin_users (user_id, role)
values (:'master_user_id', 'master')
on conflict (user_id) do update
set role = 'master', updated_at = now();

\echo 'Master user provisioned. Remove this access with SQL using a service/admin connection.'
