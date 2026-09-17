# EI-point — Current Task

> The single task in flight right now. Read this before starting work.

## Release checkpoint — 2026-09-17

The user authorized the GitHub update. Changes are being committed for the
`release/cards-resilience-hardening` branch on `ei-point`, not production `main`.
Lint, all workspace typechecks/tests, production dashboard build, cards:check,
32 deployment checks, and dependency audit passed. Luffy smoke passed 9 local
checks; live Mongo parity was skipped. Card engine and rarity defaults now use
cryptographic randomness.

Release review identified static blockers: conflicting Mongo version update
operators in the offered-card transfer; expired-trade refund/unlock handling;
relative artwork URLs passed to Discord embeds after pack debit; unrestricted
free premium pack access. Resolve and test these before merging to production.
Admin resync and the image-provider endpoint also remain unfinished. These
findings are static, not live reproductions. Existing production blockers remain.

The record below describes earlier work; its statements that push authorization
is absent are superseded by this checkpoint.


TASK: Master completion pass — AI provider resilience + capacity wiring completed locally
OWNER MODEL: Principal implementation with adversarial verification
DATE: 2026-09-17
OBJECTIVE:
  Close the highest-impact agent-addressable gaps from the master prompt by
  implementing the missing AI provider routing capabilities (retries, circuit
  breaker, provider cooldown, health tracking, capacity admission), wiring
  them into the Cyrene router and commands, and re-running the full validation
  suite. Commit creation remains operator-controlled and was not performed.

FILES IMPLEMENTED:
  - bots/cyrene/src/lib/resilience.ts (new): circuit breaker, provider
    cooldown, bounded retries, health registry, daily request budget
  - bots/cyrene/src/lib/resilience.test.ts (new): 29 tests
  - bots/cyrene/src/lib/providers.ts: wired breaker admission + retries +
    health into completeWithFallback
  - bots/cyrene/src/lib/providers.test.ts (new): 8 router integration tests
  - bots/cyrene/src/lib/ai.ts: capacity admission gate + request counting
  - bots/cyrene/src/commands/model.ts: live provider health in /model

DEPENDENCIES:
  - Luffy economy/rarity suite stays green (79 tests).
  - Shared capacity policy (@eiflow/shared) is the admission authority.

RISKS:
  - New tests must exercise real code paths, not trivially pass. Each must
    fail if the corresponding guard is removed.
  - Commits must be authored as `xyanncat` (Vercel blocks peak-slavery).
  - Do NOT push. The operator must authorize the push.

STATUS: complete for local code and validation; production verification remains externally blocked

## Latest pass — 2026-09-17 (AI provider resilience)

- The routing audit found `completeWithFallback` made exactly one attempt per
  provider with no retry, no breaker, and no health tracking; 6 of 11 required
  capabilities were missing. All are now implemented and wired:
  - Circuit breaker (closed → open → half-open), opens on consecutive-failure
    threshold or immediately on 429/permanent; exactly one probe per cooldown
    window.
  - Bounded transient retries with exponential backoff + jitter, capped under
    the request timeout, abort-aware.
  - ProviderHealthRegistry surfaced in `/model` (state, ok/failed, cooldown).
  - DailyRequestBudget feeding shared capacity bands; `runCompletion` gates on
    admission and counts issued requests.
- Cyrene suite: 48 tests (was 11). Full validation green: lint, typecheck,
  root 44, shared 81, luffy 79, dashboard 32, audit 0, gate 32/32, smoke 9/9.

## Latest hardening pass — 2026-09-16

- Fixed `infra/mongo/init.js`, which incorrectly declared `const db = db.getSiblingDB(...)` and therefore shadowed mongosh's global `db` before bootstrap could create collections or indexes.
- Mongo readiness now accepts both `mongodb+srv://...` and secure standard `mongodb://...?tls=true` URIs; SRV DNS validation is limited to SRV connections.
- Deployment validation and shared Mongo index tests now reject the shadowing regression and require the resolved `database` handle.
- Corrected the Supabase schema comment to reference the real `npm run migrate:supabase` entrypoint instead of a nonexistent SQL file.

## Completion record

FILES CHANGED:
  - packages/shared/src/capacity.ts and capacity.test.ts — central capacity
    bands, priority-aware shedding, and boundary/failure tests.
  - packages/shared/src/redis.ts and health diagnostics — optional capacity
    snapshots exposed only to authenticated health callers.
  - docs/ai/CAPACITY.md and RELEASE_READINESS.md — no-secret operational policy
    and release state.
  - Earlier Luffy registry files remain part of the verified workstream.

IMPLEMENTATION:
  - Registry tests cover forged/unsafe filenames, duplicate IDs/content,
    malformed image containers, metadata pollution, deterministic manifests,
    catalog compatibility, removed-card archival, reactivation, and idempotent
    sync. Economy tests retain forged IDs, cross-guild spoofing,
    negative currency, stale double-sells, double acceptance, cancellation /
    refund races, locked-card sales, supply caps, serial ordering, unknown
    definitions, and pack insertion.

TESTS:
  - Shared: 81/81 tests passed across 18 files, including capacity policy and
    the strengthened RLS security assertions.
  - Luffy: 79/79 tests passed across rarity, engine, store, registry, and sync suites.
  - Root scripts suite: 44 tests across 8 files.
  - Luffy card smoke test: 9/9 checks.
  - Root workspace test suite passed.

VALIDATION:
  - Root typecheck passed across all workspaces.
  - ESLint passed with --max-warnings 0.
  - Dashboard production build passed.
  - npm audit --audit-level=high reported 0 vulnerabilities.

SECURITY:
  - No security gates were weakened; no secrets or privileged identities were
    added.

DATABASE:
  - No production database mutation performed. Mongo and Redis external
    blockers remain documented.

DEPLOYMENT:
  - No deployment or push performed. Existing liveness status remains as
    documented in PROJECT_STATE.md.

REMAINING:
  - Operator: resume Atlas clusters (P0), Upstash decision, token deletion,
    authorize migration 0002 and the push.
  - Agent (after Mongo is up): in-guild Discord functional testing; Luffy
    live smoke test; authenticated readiness probes.

NEXT TASK:
  Once the operator resumes the Atlas clusters, run in-guild Discord
  functional testing across all 8 bots and re-verify authenticated health.
