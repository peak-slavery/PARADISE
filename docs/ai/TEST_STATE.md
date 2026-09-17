# EI-point — Test State

> Verified 2026-09-16. Local code gates are green; production readiness remains blocked by external services
> (the Render fleet is suspended by billing and Atlas is paused).

## Summary

| Gate | Command | Result |
|---|---|---|
| Typecheck (9 workspaces) | `npm run typecheck` | clean |
| Lint | `npm run lint` (`--max-warnings 0`) | clean, 0 errors / 0 warnings |
| Unit tests | `npm test` | all suites pass |
| Dashboard build | `npm run build` | succeeds |
| Dependency audit | `npm run audit` (`--audit-level=high`) | 0 vulnerabilities |
| Index contract | programmatic check | 30 indexes, 0 dupes, 5 unique |
| Credential gates | `scripts/*.test.mjs` | 44 tests pass (8 files) |
| Local runtime smoke | `npm run test:local` | 9/9 services online, exit 0 |
| Fleet triage | `npm run triage:fleet` | 8 blocked (billing suspension), 0 novel |
| Luffy card data path | `npm run smoke:luffy` | 9/9 checks (exit 2 if Mongo unverified) |

## Workspace test results

| Package | Tests |
|---|---|
| `@eiflow/bot-luffy` | **79** |
| `@eiflow/bot-shanks` | 3 |
| `@eiflow/bot-zoro` | 13 |
| `@eipoint/dashboard` | 32 |
| `@eiflow/shared` (incl. capacity policy and supabase-rls) | **81** (18 files) |
| other bots | 2 / 11 / 5 / 3 as applicable |
| root `scripts/*.test.mjs` | 44 (8 files, incl. fleet manifest, triage, restore parity) |

## Local runtime verification (2026-09-16)

`npm run test:local` boots the dashboard plus all 8 bots under PM2 and probes
real endpoints. Substitutes for the suspended Render fleet for application-code
verification only. Verified: 9/9 services `online` with 0 restarts, all 8 bots
`/health` HTTP 200, dashboard HTTP 200, 0 leftover processes after cleanup.
Authenticated readiness returned HTTP 503
`{supabase:true, mongo:false, redis:false}` with a live `redis_capacity`
snapshot — correct degraded reporting, no fabricated health. All 8 bot error
logs contained 0 substantive entries.

The harness itself was fixed this session: it previously waited only 90s for the
dashboard with a 30s per-request timeout, which failed spuriously because the
dashboard compiles 24 routes on first request under `next dev` while 8 bots boot
concurrently. Budgets are now dashboard 240s, bots 120s, per-request 15s.

## Luffy card tests (79 total, 4 suites)

`src/lib/cards/rarity.test.ts` (9):
normalization, unique ranks, monotonic tiers, **Limited Arts probability is
exactly 0.001%** (`toBeCloseTo(0.00001, 8)` and `0.001` at 6 places),
decreasing weights, unknown-rank rejection, `pickRankFromTable` filtering and
empty-pool throw, probability bounds.

`src/lib/cards/engine.test.ts` (11):
pack draw counts for every active pack, Limited Arts never appears when the
pack excludes it, valuation formula, collection value sums active only and
ignores sold/revoked, `safeAdd` overflow rejection, `safeSub` negative
rejection, ID formats.

`src/lib/cards/store.test.ts` (28):
insufficient-balance rejection, deterministic credit/debit with `balance_after`,
negative-final-balance rejection, pack purchase atomicity, ownership/CAS,
trade expiry/double-acceptance/currency transfer, admin revocation, supply
caps, serial ordering, and owner/status filtering.

`src/lib/cards/registry/registry.test.ts` (31):
filename normalization, all supported image formats, corrupt/truncated-image
rejection, unsupported extensions, size limits, duplicate IDs/content, symlink
and folder behavior, metadata schema/prototype-pollution rejection,
deterministic manifest round-trips, catalog adapter compatibility, idempotent
Mongo upsert, removed-card archival, reactivation, and per-definition errors.

The fake harness implements `find/findOne/findOneAndUpdate/updateOne/
updateMany/countDocuments/insertOne/insertMany`, a cursor with sort/limit,
and a `matchDoc` supporting plain equality plus `$in/$gte/$gt/$or/$ne`. It
also correctly models `$setOnInsert` as insert-only — honouring it on
updates would reset player balances to zero.

### Bugs these tests caught (both fixed)

1. `applyCurrencyDelta` assumed a zero starting balance for non-CAS debits.
2. `cancelTrade`'s refund transaction recorded `balance_after: 0` instead of
   the actual post-refund balance.

## Adversarial coverage

The store tests are explicitly adversarial: forged ownership, double-sell,
double-acceptance, expired trades, self-trades, negative balances, and
overflow are all exercised against the real code paths.

## Test infrastructure notes

- Bots use Vitest. `bots/luffy/package.json` now has a `"test": "vitest run"`
  script matching the convention in cyrene/nami/shanks/zoro — before this
  pass luffy was absent from workspace test discovery.
- `npm run test:local` starts the 9 local services, probes them, and always
  cleans up. It refuses to start if a named service already exists.
- 8 root `scripts/*.test.mjs` gates run before workspace suites:
  credential-keys, bot-env, check-local-config, fleet, pm2-config,
  render-config, restore-drill, supabase-migrations, triage-fleet.

- Capacity policy: `packages/shared/src/capacity.test.ts` (5) covers exact
  70/80/90/95% threshold boundaries, invalid quota fail-closed behavior,
  priority shedding, unhealthy dependencies, and deterministic resource
  tracking. Authenticated health diagnostics expose the Redis snapshot without
  changing public liveness output.
- Card validation: `npm run cards:check -w @eiflow/bot-luffy` — 18 cards,
  11 rarity folders, deterministic manifest, no scanner errors.
- `npm run check:deploy`: **32/32 passed**.
- Public liveness probes: **0/9 reachable** as of 2026-09-16 — the Render fleet
  is suspended by billing and returns the platform's 503 suspension page. This
  supersedes the earlier 9/9 HTTP 200 result, which was valid on 2026-09-15.
  Local liveness is verified instead via `npm run test:local` (9/9 online).
- `npm run check:local`: intentionally blocked by the known primary and
  secondary MongoDB Atlas availability failure; Supabase Discord OAuth was
  detected as enabled.


- **In-guild Discord functional testing** — blocked on the Render billing
  suspension and the paused Atlas clusters (bots cannot run or persist state).
  This is the main remaining gap.
- **Luffy live-bot smoke test** — unit/type gates plus a local boot to
  `bot ready`; no real Discord interaction yet.
- **Authenticated production readiness probes** — blocked on the suspended
  fleet, Mongo, and Redis. Local authenticated readiness verified instead.
