# EI-point — Task Queue

> Prioritized operational queue. No secrets.

## P0 — Operator-only blockers

1. **Resolve the Render billing suspension on `Kazuto's Workspace` and resume
   all 8 suspended services.** Verified 2026-09-16: every service reports
   `suspenders: ["billing"]`. Both recovery APIs are closed —
   `POST /resume` → `only services suspended by a user can be resumed`, and
   `POST /deploys` → `cannot deploy suspended service`. The whole bot fleet is
   offline until the owner clears billing in the Render dashboard. Do this
   first — it blocks every other runtime verification step.
2. Resume both MongoDB Atlas clusters from the Atlas console.
3. Revoke the exposed team-scoped Vercel token from Vercel Account Settings.
4. Decide whether to upgrade Upstash Redis, change heartbeat capacity usage, or
   accept the bounded MemoryKv fallback.

## P1 — Requires operator authorization or restored services

5. Apply Supabase migration `0002_trusted_guild_access.sql` to production using
   the approved migration path.
6. Run authenticated readiness probes after Render/Mongo/Redis recovery.
7. Perform authorized in-guild functional testing for all eight bots.
8. Run the Luffy live card-command/button smoke test. (`npm run smoke:luffy`
   already verifies the full card data path in CI; the remaining gap is a real
   Discord interaction.)
9. Verify backup creation and isolated restore against available production data
   — `MONGODB_URI=... npm run drill:restore`. The drill's parity verification is
   now field-level (8 regression tests), but it has not yet run against live
   data because Atlas is paused.

## P2 — Agent-addressable follow-up

10. Consolidate legacy documentation around `docs/ai/`.
11. Add any remaining route-level security regression tests found by future
    reviews.
12. Add licensed/original card artwork references when the operator supplies
    authorized assets.

## Delegated work queues

- Luna (GPT-5.6): frontend/dashboard UI/UX pass, real-browser verification,
  documentation sync, and read-only release review — see
  [LUNA_TASKS.md](./LUNA_TASKS.md).

## Completed this pass

- **Restore drill integrity**: replaced count-only verification with
  field-level parity, closing a silent-corruption gap; 8 regression tests
  (corrupted, truncated, reordered, injected, retyped, lost-field, empty).
- **Luffy card smoke test** (`npm run smoke:luffy`): end-to-end card data path
  — manifest integrity, artwork containment, content hashes, 100,000,000 weight
  total, Limited Arts exactly 0.001%, runtime-catalog parity, and Mongo
  `card_definitions` parity when a database is reachable. Three-way exit codes
  (0 verified / 1 defect / 2 unverifiable). Wired into CI and enforced by
  `check:deploy`.
- **Local runtime verification** substituting for the suspended fleet: all 9
  services boot online under PM2, all 8 bots serve `/health` HTTP 200,
  authenticated readiness correctly reports `supabase:true, mongo:false,
  redis:false` with live `redis_capacity`, and 0 substantive bot error lines.
- **Fixed `scripts/test-local-stack.mjs`** spurious dashboard-timeout failure
  (cold `next dev` compile of 24 routes needed more than the 90s budget).
  `npm run test:local` now passes with exit 0 and cleans up fully.
- **Strengthened RLS tests** from policy-name string matching to real security
  assertions (no browser writes to `guild_access`, self-scoped read only,
  unrevoked-access requirement, no destructive migration SQL). Verified
  non-vacuous by injecting a privilege-escalation policy and confirming failure.
- Mongo bootstrap mongosh `db`-shadowing defect fixed with regression coverage.
- Supabase migration runner invariants: contiguous sequence, baseline
  restriction, checksum-conflict abort, removed-migration drift detection,
  transactional ledger bootstrap.
- Single canonical fleet manifest (`scripts/fleet.mjs`) replacing four
  duplicated hardcoded bot lists; non-bot dirs under `bots/` are rejected.
- Render suspension root cause identified; both recovery paths proven closed.
- Triage tool now classifies platform suspension as `blocked`, not `novel`.
- Shared capacity policy and authenticated Redis capacity diagnostics.
- Filesystem-driven Luffy registry: scanner, canonical folders, deterministic
  manifest, Mongo sync, CI validation, runtime startup integration.
- Luffy full suite: 79/79 tests. Shared: 81 tests. Root: 44 tests.
- Root typecheck, lint, tests, dashboard build, and high-severity audit.
- Required persistent handoff artifacts created.
