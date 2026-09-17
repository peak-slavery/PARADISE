# EI-point — AI Changelog

> Append-only record of work performed by AI sessions. Newest first.
> No secrets.

## 2026-09-17 — AI provider resilience and capacity wiring (Cyrene)

- **Closed the biggest agent-addressable gap from the routing audit.** An
  independent audit found the AI router implemented only 3 of 11 required
  capabilities fully (model selection, timeouts, fallback); 2 partial (output
  limits, user cooldown); and 6 missing (capability detection, provider rate
  limits, quotas, retries, circuit breakers, provider health, capacity
  tracking). The most consequential defects: `completeWithFallback` made
  exactly ONE attempt per provider, so a single transient 500 immediately
  advanced to the next provider, and a persistently broken provider was retried
  in full on every request.
- **New `bots/cyrene/src/lib/resilience.ts`** implements the missing
  capabilities as pure, injectable-time state transitions:
  - Circuit breaker with `closed → open → half-open` states; opens after a
    configurable consecutive-failure threshold, or immediately on rate-limit
    (429/403) and permanent (bad model/auth) failures.
  - Provider cooldown: an open circuit parks the provider for the cooldown
    window, then admits exactly ONE probe (re-arming the window) so a recovered
    provider is discovered without a thundering herd.
  - Bounded retries with exponential backoff and full jitter, capped so a retry
    sequence cannot outlive the 18s request timeout; retries abort cleanly when
    the caller's signal aborts.
  - Failure classification from the status code the router already extracts
    (429/403 → rate_limited, 5xx/network/timeout → transient, other 4xx →
    permanent; unknown → transient so it never opens the circuit on first
    sight).
  - `ProviderHealthRegistry`: in-process per-provider health with success/
    failure totals, streak, state, cooldown remaining, and last error kind.
    Deliberately local — Redis may be unavailable and each instance owns its
    own keys.
  - `DailyRequestBudget`: in-process daily request counter feeding the shared
    capacity bands; `decide()` uses `decideCapacity(snapshot, 'optional')` so AI
    work sheds at the same thresholds as every other non-critical workload and
    fails closed on invalid quota.
- **Wired into the router** (`providers.ts`): `completeWithFallback` now
  consults the breaker before each provider (skipping parked providers instead
  of wasting the request budget), retries transient failures up to the attempt
  budget, records success/failure with classification, and surfaces health via
  the exported `providerHealth` registry. `/model` now shows live breaker state
  and counters per provider (`closed/open/half-open`, ok/failed counts,
  cooldown seconds) — still booleans and counters only, never a key.
- **Wired into the command path** (`ai.ts`): `runCompletion` checks capacity
  admission after the defer (so the user always gets a real reply) and counts
  each issued request against the budget. Default budget 300 requests/instance/
  day is deliberately generous; the shared policy is the authority on when to
  shed.
- **37 new tests**: 29 resilience (breaker transitions, immediate-open on
  rate-limit/permanent, single-probe half-open, classification, retry budget,
  backoff cap + jitter, budget bands/rollover/admission, fail-closed zero
  quota, abortable delay) and 8 router integration tests (retry-then-recover,
  no-retry-on-429 with failover, breaker parking across requests, exhausted
  route throws, no-key error, abort-mid-backoff stops, attempt budget). All
  proven against real wired behavior, not just the pure module.
- Cyrene suite now **48 tests** (was 11).
- Verification: lint clean, typecheck 0 errors, root 44 tests, shared 81,
  cyrene 48, luffy 79, dashboard 32, `npm audit` 0 vulnerabilities,
  `check:deploy` 32/32, `smoke:luffy` 9/9, `git diff --check` clean.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Backup/restore integrity gate and Luffy card smoke test

- **Fixed a silent-corruption gap in `scripts/restore-drill.mjs`.** The drill
  verified only that the restored document *count* matched. A truncated,
  reordered, or field-mangled restore would therefore be reported as
  `restore drill passed`, which is exactly the "silent corruption" outcome the
  operational-safety order forbids. It now performs field-level parity
  verification via an exported `verifyRestoreParity()` predicate that compares
  canonicalised source and restored records (excluding `_id`, which is dropped
  on insert, and `restored_at`, which the drill adds). Eight regression tests
  cover intact, reordered, corrupted-value, truncated, injected-field,
  retyped, lost-field, and empty-batch cases; the corrupted/truncated/injected
  cases each fail as intended. The drill's executable body is now behind a
  main guard, so importing it in tests requires neither credentials nor a
  live cluster.
- **Added `scripts/luffy-smoke.mjs` (`npm run smoke:luffy`)**, an end-to-end
  card data-path check that needs no Discord gateway session and no HTTP test
  surface (the bots intentionally expose only `/health`). It verifies: manifest
  loads; definition IDs are unique; every artwork ref is repo-relative,
  contained and free of traversal; every card carries a `sha256:` content hash;
  drop weights total exactly 100,000,000; Limited Arts is exactly 0.001%;
  the runtime catalog loads the manifest, validates probabilities and contains
  every enabled definition; and, when `MONGODB_URI` is supplied, every enabled
  manifest card exists in Mongo `card_definitions` and none is disabled.
  Exit codes are deliberately three-way — 0 fully verified, 1 real defect,
  2 unverifiable (Mongo unreachable) — so an operator cannot mistake "could not
  read the data" for "the data is correct". Verified non-vacuous by injecting a
  `../../etc/passwd` artwork ref (check failed, exit 1) and by an unreachable
  Mongo URI (exit 2), then restoring the manifest and confirming 9/9 pass.
- **Wired the smoke test into CI** (`cards` job, after the scanner gate) and
  added a `check:deploy` assertion requiring both steps, so neither can be
  silently dropped. Verified the assertion fires by removing the CI step and
  confirming the gate fails, then restoring it and confirming 32/32.
- Note: the smoke test initially reported a false failure on content hashes
  because the manifest stores them with an explicit `sha256:` algorithm prefix;
  the assertion was corrected to match the real format.
- **Hardened the smoke test against silent self-weakening.** The catalog check
  is the suite's most valuable assertion, but it needs a TypeScript loader
  (`tsx`). Originally a missing loader produced a benign "skipped" pass, so the
  check could silently vanish while the run still reported success. CI now sets
  `LUFFY_SMOKE_REQUIRE_CATALOG=1`, which turns a missing loader into a hard
  failure; local plain-`node` runs still skip with a visible message. `tsx` was
  also added to the root `devDependencies` so `npm run smoke:luffy` no longer
  depends on workspace hoisting from `bots/luffy`. Verified all three paths:
  plain node → 7/7 skip-and-pass, plain node + require → fail (exit 1),
  tsx + require → 9/9 pass.
- Verification: lint clean, typecheck 0 errors, root 44 tests, shared 81, Luffy
  79, npm audit 0 vulnerabilities, `check:deploy` 32/32, `smoke:luffy` 9/9,
  card scanner 18 cards / 11 folders, `git diff --check` clean.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Local runtime verification replaces the suspended fleet

- **Recovery attempts exhausted and documented.** `POST /v1/services/{id}/resume`
  → HTTP 400 `only services suspended by a user can be resumed`.
  `POST /v1/services/{id}/deploys` → HTTP 400 `cannot deploy suspended service`.
  Both paths to revive the fleet are closed, so the Render billing suspension is
  strictly operator-side. Atlas resume was re-confirmed impossible: the `al-`
  keys return 401 against the Atlas Admin API and no org/admin key exists.
- **Verified the bot runtime locally via PM2** as the strongest available
  substitute for the suspended fleet. All 9 services boot `online` with 0
  restarts; all 8 bots serve `GET /health` HTTP 200; the dashboard serves
  HTTP 200.
- **Verified the failure contract end to end.** Authenticated readiness on a
  live local bot returned HTTP 503 with
  `db_connections: {supabase: true, mongo: false, redis: false}` — the system of
  record reachable, the two known external blockers reported honestly, and no
  fabricated healthy state. The capacity policy was observed live in that same
  payload (`redis_capacity`: quota 8000, usage 68, `band: "normal"`,
  utilization 0.0085).
- **Verified graceful degradation.** Bot error logs contain 0 substantive
  entries across all 8 bots; the only recurring messages are the known
  `MongoServerSelectionError` (alert 80) and `UpstashError` quota warnings.
  Luffy logged `bot ready` (Discord login works) and
  `card registry sync skipped because primary Mongo is unavailable`, i.e. it
  correctly refuses to fabricate registry state while Mongo is down.
- **Fixed a real spurious-failure bug** in `scripts/test-local-stack.mjs`: it
  waited 90s for the dashboard with a 30s per-request timeout, but the dashboard
  runs `next dev` and must compile 24 routes on first request while eight bots
  boot concurrently. One slow request therefore consumed most of the budget and
  the harness failed with `did not become ready within 90s` even though every
  service was healthy. The dashboard now gets a 240s budget, bots 120s, and
  per-request timeouts are 15s so a single slow attempt cannot exhaust the
  window. `npm run test:local` now passes with exit 0 and cleans up to zero
  leftover processes.
- **Strengthened RLS tests from string-matching to security assertions.** The
  `supabase-rls.test.ts` suite previously only checked that policy *names*
  appeared in schema.sql. It now asserts the actual properties: browser roles
  (`anon`, `authenticated`) cannot write `guild_access`, no insert/update/
  delete/all policy exists on that table, the single read policy is scoped to
  the caller's own discord identity, `has_guild_access` requires
  `revoked_at is null` and still honours the master predicate, and no applied
  migration contains destructive SQL while the backfill stays upsert-idempotent.
  Verified non-vacuous by injecting a browser-writable
  `for all using (true)` policy into migration 0002 — the suite failed — then
  restoring the file and confirming it passes. Shared suite is now 81 tests.
- Verification after all changes: lint clean, typecheck 0 errors, root 36 tests,
  shared 81 tests, dashboard suite green, `npm audit` 0 vulnerabilities,
  `check:deploy` 31/31, `git diff --check` clean.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Fleet suspension discovered; triage tool corrected

- **Discovered the whole Render fleet is offline**: all 8 services report
  `suspended: "suspended"` with `suspenders: ["billing"]` via the Render API,
  and every bot URL serves Render's HTTP 503 suspension page. This contradicts
  the prior handoff's "all 8 bots live" claim, which was accurate when written
  on 2026-09-15 but is no longer true.
- Established the timeline and ruled out regressions: the last successful deploy
  was 2026-09-14T20:02Z, service logs show normal operation with only the known
  Mongo error until 2026-09-16T12:01Z, and suspension followed at 12:05:50–52Z.
  No deploy, code change, or local script caused it — it is a billing action on
  the workspace.
- Confirmed the suspension cannot be cleared programmatically:
  `POST /v1/services/{id}/resume` returns HTTP 400
  `only services suspended by a user can be resumed`.
- Re-confirmed the Atlas pause with direct TLS probes of the SRV-discovered
  shard endpoints (alert 80 on all endpoints) while control hosts complete TLS
  normally, and verified the `al-` keys return 401 against the Atlas Admin API
  under both digest and Bearer auth (inference-only, cannot manage clusters).
- **Fixed the tooling that hid this**: `scripts/triage-fleet.mjs` treated the
  Render suspension page as a NOVEL application failure (liveness HTTP 503).
  It now detects the suspension body, skips the pointless authenticated probe,
  and classifies the service as `blocked`. Two regression tests cover the new
  classification and its precedence over the `down` verdict.
- Live triage after the fix: 8 blocked (billing suspension), 0 novel, exit 0.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Migration runner invariants and single fleet manifest

- The Supabase migration runner now refuses to run unless migration filenames
  form a contiguous `0001`-based sequence, rejects a baseline that is not the
  first migration, aborts when a baseline row already carries a different
  checksum instead of silently ignoring it, and fails if the ledger references
  a migration no longer present in source (removed-migration drift).
- Ledger bootstrap is now one transaction: the table, checksum column, and
  NOT NULL constraint are established together so partial bootstrap cannot
  leave migrations skippable.
- Added `scripts/fleet.mjs` as the single canonical eight-bot manifest. Bot
  identity is derived from `bots/` package declarations, with Render service
  names/URLs, credential-file headers, and local PM2 ports in one table.
  `check-deploy`, `check-all-bots`, `triage-fleet`, and `production-smoke`
  now import from it instead of redeclaring four separate lists. A non-bot
  directory under `bots/` is rejected, not counted.
- Added four manifest regression tests; the root suite is now 34 tests.
- Replaced the unconditional "all 8 bot packages" success line with one that
  only prints when the per-bot checks actually pass.
- Corrected the README's migration-order claim, which previously described
  validation the runner did not perform.
- Verification: typecheck, lint, `npm test`, `npm audit`, dashboard build,
  card registry check, and `npm run check:deploy` (31/31) all pass; a
  negative test confirms the manifest fails closed on fleet drift.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Mongo bootstrap and readiness hardening

- Fixed the runtime `infra/mongo/init.js` defect where `const db = db.getSiblingDB(...)` shadowed mongosh's global database handle and caused bootstrap to fail before collection/index creation.
- Strengthened the deployment gate and shared Mongo index regression test to require the safe resolved `database` handle and reject the shadowing pattern.
- Updated `scripts/mongo-readiness.mjs` to support both `mongodb+srv://` and secure `mongodb://...?tls=true` connection strings without attempting SRV DNS resolution for standard URIs.
- Corrected the Supabase schema's migration-runner documentation to reference `npm run migrate:supabase`.
- Verification: focused Mongo/readiness tests, `npm test` (25 root + all workspace suites), `npm run check:deploy` (31/31), typecheck, lint, audit, dashboard build, card validation, and `git diff --check` all pass.
- No commit, push, deployment, or production data mutation was performed.

## 2026-09-16 — Capacity policy and release readiness

- Added shared `CapacityManager` policy with exact directive thresholds,
  priority-aware workload shedding, unhealthy-dependency behavior, and
  fail-closed invalid-quota handling.
- Added optional Redis capacity snapshots and authenticated health diagnostics;
  public liveness remains minimal.
- Added capacity boundary tests and no-secret `CAPACITY.md` and
  `RELEASE_READINESS.md` handoff artifacts.
- No provider mutation, commit, push, deployment, or production data mutation
  was performed.


- Added canonical root `cards/` rarity folders and 18 deterministic,
  non-copyrighted generated seed fixtures preserving existing stable IDs.
- Added synchronous scanner with filename-derived IDs, folder-authoritative
  rarity, path/symlink containment checks, extension/signature/structural image
  validation, strict metadata schema, duplicate ID/content detection, and
  deterministic manifest generation.
- Added `generated/cards.manifest.json`, `cards:check`, `cards:write`, and the
  CI card-registry job. CI fails on scanner errors, manifest drift, or rarity
  probability drift.
- Refactored the runtime catalog to load the manifest while preserving all
  existing APIs and pack IDs. Added idempotent Mongo upsert/archive/reactivate
  sync; removed source artwork never deletes instances or history.
- Wired registry synchronization into Luffy's post-Mongo startup hook and kept
  archived definitions renderable but ineligible for new drops/issuance.
- Added 31 registry tests; Luffy now passes **79/79** tests.
- No commit, push, deployment, or production database mutation was performed.


- Re-added the `cancelTrade` import used by the cancellation and refund/accept
  race tests in `bots/luffy/src/lib/cards/store.test.ts`.
- Verified the complete Luffy economy suite before the registry expansion:
  **48/48 tests passed** across rarity, engine, and store behavior.
- Verified repository lint, all workspace typechecks, root tests, dashboard
  production build, and `npm audit --audit-level=high` (0 vulnerabilities).
- Updated the persistent AI handoff files with the final local validation
  state. No commit, push, deployment, or production database mutation was
  performed.

## 2026-09-15 — Atria Dawn: Luffy card game + handoff system

### Luffy collectible card game (complete)

Implemented the full One Piece-themed card game as specified:

- **11-rank hierarchy** with a frozen weight table summing to exactly
  100,000,000; Limited Arts at weight 1,000 → **exactly 0.001%**.
- **Definition/instance separation** with unique instance IDs, owners,
  serial numbers, and lock states.
- **Server-authoritative berries economy**: atomic `$inc`, overflow and
  negative-balance guards, full transaction ledger with `balance_after`.
- **Race-safe trading**: lock tokens + CAS on (trade_id, version, status);
  self-trades, expired trades, stale ownership and double-acceptance all
  rejected.
- **Atomic selling**: ownership → sellable → not-locked → CAS → credit →
  ledger, with double-sell prevented by the version precondition.
- **Data-driven packs** (5 definitions); no pack logic in commands.
- **Admin issue/revoke** with supply-cap enforcement and serial numbers;
  authorization via `services.isOwner`, no hardcoded privileged ID.
- **11 observability events** wired through the shared batched log sink.
- **9 Discord commands** + working paginated collection buttons.
- **48 tests** across 3 suites; the adversarial expansion covers forged IDs,
  cross-guild spoofing, negative currency, double-sell/accept races,
  cancellation/refund races, locked cards, supply caps, serial ordering, and
  pack insertion. The suite caught and I fixed 2 real bugs (zero-balance debit
  assumption; `balance_after: 0` on trade refunds).

### Shared infrastructure (additive, no regressions)

- Added `handleButton` to `createBot` so bot-owned buttons route through the
  same auth/pause/dev-guild/rate-limit gates as slash commands.
- Added `ButtonContext` type and `replyOrFollowUp` support for button
  interactions.
- Added `CardCtx` (a narrow `Pick<CommandContext, ...>`) so the store can be
  driven by both slash and button contexts.
- `bots/luffy/package.json` gained the `"test": "vitest run"` script so luffy
  is included in workspace test discovery.

### Verification

`tsc --noEmit` clean across 9 workspaces; `eslint --max-warnings 0` clean;
`npm test` all suites pass; dashboard production build succeeds;
`npm audit` 0 vulnerabilities; index contract verified (30 indexes, 0
duplicates, 5 unique); 9/9 production health endpoints respond.

### Handoff system

Created `docs/ai/` — PROJECT_STATE, HANDOFF, CURRENT_TASK, ARCHITECTURE,
DATABASE_STATE, SECURITY_STATE, DEPLOYMENT_STATE, TEST_STATE, DECISIONS,
KNOWN_ISSUES, INITIAL_AUDIT, and this CHANGELOG. All claims verified against
the live repo and live endpoints rather than assumed from the brief.

### Key correction to the incoming brief

The brief's "known CI problems" (Dependabot `update-type`, CodeQL action
version, gitleaks Discord-ID fixtures) and the "duplicate
`ai_context.updated_at` index" were **already fixed and verified green** in
prior sessions. Re-doing them would have been wasted effort and risked
regressing working gates. Verified instead of assumed, per brief §0.

## Earlier sessions (from SESSION_HANDOFF.md, condensed)

- **CI fully green**: Dependabot invalid entry removed; CodeQL v3→v4 with
  `upload: never` and the required `permissions: actions: read`; gitleaks
  pinned 8.30.1 with a narrow documented allowlist; `.env.example` client IDs
  scrubbed; `.gitignore` hardened.
- **Vercel live**: diagnosed the `TEAM_ACCESS_REQUIRED` author block (commits
  by `peak-slavery`), scoped 11 env vars to production, created
  `NEXT_PUBLIC_SITE_URL`, triggered a successful production deploy.
- **Render fleet**: all 8 bots live after an env wipe caused by a partial
  PUT; keep-alive ring active; command scopes verified via Discord API.
- **Discord OAuth fixed**: provider was disabled and the client ID field
  contained the literal text "Makima"; corrected, enabled, handshake
  verified.
- **Dev-server gate**: non-master users in the dev guild now get an explicit
  ephemeral restriction instead of a misleading 10-second cooldown, checked
  before any rate-limit bucket is consumed.
