-- Retention contract for the weekly archival job.
--
-- Supabase is the source of truth for recent audit rows. The workflow archives
-- rows to MongoDB first, verifies the archive write, and only then deletes the
-- matching rows from these tables. Keeping the deletion predicate here makes
-- the safety boundary explicit and reusable by operators running psql manually.
--
-- This file is intentionally non-destructive when run by itself. The Node
-- archival worker performs the cross-database copy and exact-id deletion.

\set ON_ERROR_STOP on
\if :{?retention_days}
\else
\set retention_days 90
\endif

-- The function is read-only and safe to call from monitoring or a dry run.
select *
from public.rows_to_archive(:'retention_days'::integer);
