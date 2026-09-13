-- Baseline schema matching infra/supabase/schema.sql, excluding its
-- compatibility header and this migration ledger.
--
-- Apply this only to a fresh database. Databases initialized before this
-- migration ledger should mark it as applied without re-executing it.
\ir ../schema.sql
