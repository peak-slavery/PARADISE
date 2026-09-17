# EI-point — AI Handoff

> **Read this first.** Short enough that a new model can understand current
> project state without rereading the conversation or the whole repository.
> Start here, then read `PROJECT_STATE.md`, `CURRENT_TASK.md`, `KNOWN_ISSUES.md`.
> No secrets in this file — ever.

PROJECT STATUS: **NOT COMPLETE** (external blockers, not code defects)

VERSION/COMMIT: `main` @ `5e529d4`; uncommitted workstream in progress (Luffy
card game + registry, capacity policy, Mongo/migration/fleet hardening); no
commit or push was created in this pass.

FEATURES COMPLETED:
- Luffy collectible card game + filesystem registry — complete locally, 79/79
  tests, all local quality gates green. Canonical `cards/` rarity folders,
  strict scanner, deterministic manifest, idempotent Mongo upsert/archive,
  startup synchronization, 11 ranks, Limited Arts at exactly 0.001%,
  definition/instance separation, server-authoritative berries economy,
  race-safe trading, data-driven packs, admin issue/revoke with supply caps,
  11 observability events, 9 commands, and adversarial duplication/race tests.
- Discord OAuth login + dashboard authorization (RLS, master panel,
  fail-closed 404s) — implemented and verified in prior sessions.
- CI gates green (Dependabot/CodeQL v4/Gitleaks/dependency-review).
- Vercel dashboard live at `https://ei-point-dashboard.vercel.app`.

⛔ FLEET OFFLINE (2026-09-16): **all 8 Render services are suspended by
billing.** `suspended: "suspended"`, `suspenders: ["billing"]`; every bot URL
serves Render's 503 suspension page. Both recovery APIs are closed —
`POST /resume` → `only services suspended by a user can be resumed`,
`POST /deploys` → `cannot deploy suspended service`. The owner must clear
billing in the Render dashboard. The earlier "all 8 bots live on Render"
statement is historical (true on 2026-09-15) and is no longer accurate.

LOCAL RUNTIME VERIFIED INSTEAD: `npm run test:local` boots the dashboard + all 8
bots under PM2 — 9/9 online with 0 restarts, all 8 bots `/health` HTTP 200,
authenticated readiness correctly HTTP 503
`{supabase:true, mongo:false, redis:false}` with a live `redis_capacity`
snapshot, 0 substantive error lines across all bots, 0 leftover processes.
This verifies the application code, not the production deployment.

SECURITY STATUS: 0 npm vulnerabilities, lint clean, no hardcoded identities or
secrets, demo mode fail-closed. Adversarial card-economy tests pass. RLS tests
now assert real security properties (no browser writes to `guild_access`,
self-scoped reads only, unrevoked-access requirement, no destructive migration
SQL) and were proven non-vacuous by injecting a privilege-escalation policy and
confirming the suite fails.

DATABASE STATUS: Mongo schema/indexes correct and verified (30 indexes, 0
conflicts, 5 unique) **but Atlas clusters are PAUSED** (re-confirmed by TLS
probing the SRV-discovered shard endpoints → alert 80, while control hosts
complete TLS normally). Supabase 12 tables verified; **migration 0002 not yet
applied to production** (written, non-destructive, upsert-idempotent). Upstash
quota exhausted (graceful MemoryKv fallback).

CI STATUS: green on `ei-point` remote. All local gates pass.

DEPLOYMENT STATUS: Vercel LIVE. **Render fleet SUSPENDED by billing — 8/8
services offline**, so production health probes cannot respond at all. Local
PM2 verification (9/9 online) stands in for application-code validation.

PRODUCTION TEST STATUS: 0/8 bot endpoints reachable (platform suspension page).
Authenticated production readiness and in-guild Discord functional testing are
**blocked on the Render billing suspension, then Mongo resume**.

REMAINING NON-BLOCKING ITEMS: placeholder card artwork; real Discord
interaction smoke test for Luffy (its card data path is now covered in CI by
`npm run smoke:luffy`); CAS-based (not transactional) atomicity on M0 free tier;
documentation consolidation.

LAST VALIDATION: 2026-09-16 — lint clean, typecheck 0 errors, root 44 tests,
shared 81 tests, Luffy 79/79, dashboard 32, npm audit 0 vulnerabilities,
dashboard build, card registry validation, `smoke:luffy` 9/9, `check:deploy`
32/32, local PM2 runtime smoke (9/9 online), and `git diff --check` clean.
Production readiness remains blocked by the Render billing suspension, paused
Atlas clusters, exhausted Upstash quota, unapplied Supabase migration 0002, and
the exposed Vercel token requiring operator action.

NEXT ACTION:
1. **OPERATOR**: clear the Render billing suspension for `Kazuto's Workspace`
   and resume the 8 services (Render dashboard → Billing). Both APIs refuse
   recovery, so this is owner-only. This unblocks everything below.
2. **OPERATOR**: resume the two paused MongoDB Atlas clusters (console only —
   the available `al-` keys are inference-only and 401 against the Admin API).
3. **OPERATOR**: delete the exposed Vercel token; decide on Upstash quota.
4. **OPERATOR**: run `npm run migrate:supabase` for migration 0002.
5. **AGENT** (once the fleet runs and Mongo is up): authenticated production
   readiness probes; in-guild Discord functional testing across all 8 bots;
   Luffy live card/button smoke test.
6. **AGENT**: push the prepared commits to `ei-point` when the operator
   authorizes it.

CRITICAL CONSTRAINTS (do not violate):
- Git identity MUST stay `xyanncat`. Vercel blocks `peak-slavery` authors.
- Never commit or print `temp cred.txt`. Tokens pasted in chat are burned.
- Never hardcode a privileged Discord identity or a secret.
- Do not weaken gitleaks/CodeQL/npm-audit gates. `DEMO_MODE` stays false in
  production. Never expose server secrets via `NEXT_PUBLIC_*`.
- Do not push to `main` on either remote without explicit operator approval.
- Never PUT a partial env array to Render — it replaces the whole set.
