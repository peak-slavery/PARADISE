# EI-point — Database State

> Verified schema/index/RLS state. No connection strings or credentials.

## MongoDB (Atlas)

### Collections (12)

`ai_context`, `card_definitions`, `card_instances`, `card_packs`,
`card_player_currency`, `card_trades`, `card_acquisitions`,
`card_transactions`, `card_games` (the pre-existing poker game — untouched),
plus the logging/control collections used by the shared runtime.

### Index contract

Canonical source: `infra/mongo/indexes.cjs`, consumed by
`packages/shared/src/db/mongo-indexes.ts` via `createRequire`. Applied
idempotently at boot by `ensureIndexes()`.

**Verified 2026-09-15** (programmatic check):
- **30 indexes total** across 12 collections
- **0 duplicate index names**
- **0 conflicting key patterns** (same collection + same key under two names)
- **5 unique constraints**: `carddef_id` (definition_id),
  `cardinst_id` (instance_id), `cardpack_id` (pack_id),
  `cardcur_guild_user` (guild_id + user_id), `cardtrade_id` (trade_id)

### The `ai_context.updated_at` issue — RESOLVED

The brief flags "duplicate/conflicting ai_context.updated_at indexes". This
is already fixed and verified. The collection now has exactly:
- `ai_ctx_unique` — `{ guild_id: 1, user_id: 1, scope: 1 }` unique
- `ai_ctx_ttl` — `{ updated_at: 1 }` with `expireAfterSeconds`

No duplicate name and no conflicting key pattern exists. **Do not re-fix.**

### Operational state — BLOCKED (external)

Both Atlas clusters are **paused** at the console level:
- Primary `eiflow.onrjgir.mongodb.net`
- Secondary `eipointsecurity.sutarwt.mongodb.net`

TLS handshake fails with alert 80 from both the local machine and Vercel's
runtime; DNS/SRV and cert verification are fine, so this is cluster state.
`mongo:false` in every health probe. **Requires operator console action.**

**Re-verified 2026-09-16** (independent probes, no assumptions):
- SRV lookup succeeds: 3 shard records returned for each cluster.
- TLS probe of each SRV-discovered shard endpoint on port 27017 → `SSL alert
  number 80` for all 4 endpoints tested (2 per cluster).
- Control probes to `cloud.mongodb.com:443` and `google.com:443` → TLS OK,
  proving local outbound TLS is not the cause.
- The `al-` Model API keys return HTTP 401 against
  `cloud.mongodb.com/api/atlas/v2/groups` under both digest and Bearer auth,
  confirming they cannot manage or resume clusters.

Client config: TLS enabled for `mongodb+srv://`, connection pooling tuned for
the M0 free tier, `serverSelectionTimeoutMS: 2_000` in health probes.
`scripts/mongo-readiness.mjs` accepts both `mongodb+srv://` and secure
`mongodb://...?tls=true` forms, performing SRV DNS validation only for SRV
connections.

## Supabase

### Tables (12) — verified present

users, servers, server_settings, security_events, secret_records,
mod_actions, internal_request_nonces, infra_accounts, guild_whitelists,
bot_states, guild_access (pending migration 0002 — see below), bot_configs.

### RLS

Active and tested. The dashboard authorizes per request (layout check is
defence in depth, never the control, because Next.js renders layout and page
concurrently).

- Base schema (0001): guild visibility via `owns_guild`.
- Migration 0002 (`infra/supabase/migrations/0002_trusted_guild_access.sql`):
  introduces the `guild_access` relationship table with source
  (owner/administrator/inviter), verification time, and revocation state;
  overrides the RLS fallback to `has_guild_access`. Browser-supplied inviter
  or guild claims are never trusted.

**Migration 0002 is written, reviewed, and covered by
`packages/shared/src/db/supabase-rls.test.ts`, but NOT yet applied to
production.** Until it is, the dashboard runs the `owns_guild` path. Apply
with `npm run migrate:supabase` (needs the service-role key — operator).

Privileged access uses the `is_master_user()` database predicate — there is
no permanently hardcoded Discord ID for admin access.

### Migrations

Deterministic, four-digit ordered names, transactional, with an immutable
checksum ledger. Verified by `scripts/supabase-migrations.test.mjs`.

## Redis (Upstash)

Used for: rate limiting, antinuke counters, provider cooldowns, caching.

**Operational state — BLOCKED (external)**: free-tier monthly quota exhausted
(500000/500000). Every call returns `ERR max requests limit exceeded`.

Failure behaviour is verified-safe: the runtime degrades to `MemoryKv` rather
than failing open. This means rate limits become per-process instead of
fleet-wide — weakened but not absent. Redis failure never grants unlimited
expensive-provider access.

Structural cause: 8 bots × 60s heartbeats × ~2-4 commands ≈ 350K/month.
Options: upgrade Upstash, lengthen the interval, or accept the fallback.

## Data safety

- Production data is never silently replaced by fixtures. Demo fixtures are
  gated behind `hasConfiguredEnvironment()` — a partially-configured
  production deploy fails closed.
- Backup/restore: see `scripts/restore-drill.mjs` and `rollback-drill.mjs`;
  `npm run drill:restore` / `drill:rollback` exercise the checksummed
  restore path non-destructively.
