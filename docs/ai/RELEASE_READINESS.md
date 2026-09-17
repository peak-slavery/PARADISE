# EI-point Release Readiness

> Generated/verified 2026-09-16. No secrets. This is a readiness record, not a claim of production completion.

## Release identity

- Current HEAD: `5e529d4d63059a3f61404346eed921b11cd8750d`.
- Working tree: 51 uncommitted paths; no commit or push was created.


- Deployment configuration: `npm run check:deploy` — 32/32 passed.
- Workspace TypeScript: `npm run typecheck` — passed.
- Repository lint: `npm run lint` — passed with zero warnings.
- Full workspace tests: `npm test` — passed; root 44 tests, Luffy 79/79,
  shared 81 tests (dashboard suite green).
- Dashboard production build: `npm run build -w @eipoint/dashboard` — passed.
- Dependency audit: `npm run audit` — 0 high/critical vulnerabilities.
- Card registry: `npm run cards:check -w @eiflow/bot-luffy` — 18 cards, 11 rarity folders, deterministic manifest.
- Card data path: `npm run smoke:luffy` — 9/9 checks (manifest integrity,
  artwork containment, content hashes, weight total, Limited Arts exactly
  0.001%, runtime-catalog parity). Mongo parity requires `MONGODB_URI`.
- Capacity policy: shared threshold and failure-mode tests pass.
- Diff hygiene: `git diff --check` — passed.

## Local runtime verification (substitute for the suspended fleet)

Because the Render fleet is suspended, the runtime was verified locally via PM2
(`npm run test:local`, exit 0, zero leftover processes):

- All 9 services (dashboard + 8 bots) boot `online` with 0 restarts.
- All 8 bots serve `GET /health` HTTP 200; dashboard serves HTTP 200.
- Authenticated readiness returned HTTP 503 with
  `db_connections: {supabase: true, mongo: false, redis: false}` — the documented
  degraded state, with no fabricated health.
- `redis_capacity` reported live: quota 8000, usage 68, `band: "normal"`.
- 0 substantive error-log entries across all 8 bots; only the two known external
  dependency errors appear.
- Luffy logged `bot ready` (Discord login succeeds) and correctly skipped card
  registry sync while Mongo was unavailable.

This verifies the application code, not the production deployment. It does not
substitute for authenticated production readiness or in-guild Discord testing,
which remain blocked on the Render billing suspension.

## Implemented in the current workstream

- Filesystem-driven Luffy card registry, manifest, catalog adapter, Mongo sync, archival semantics, and CI validation.
- Shared capacity policy with threshold bands, priority-aware shedding, unhealthy dependency behavior, and authenticated Redis capacity diagnostics.
- Dashboard authorization/UI hardening and existing HMAC, CSRF, RLS, replay, rate-limit, and demo-mode controls preserved.
- Mongo bootstrap hardening: fixed the mongosh `db` shadowing defect, added regression checks, and corrected secure URI readiness handling for both SRV and standard TLS forms.
- Supabase migration runner invariants: contiguous sequence, baseline restricted to the first migration, checksum conflict abort, removed-migration drift detection, and transactional ledger bootstrap.
- Single canonical fleet manifest (`scripts/fleet.mjs`) replaces four duplicated hardcoded bot lists; non-bot directories under `bots/` are rejected rather than counted.
- Backup/restore integrity: the restore drill now verifies field-level data
  parity instead of only document counts, closing a silent-corruption gap;
  8 regression tests cover the failure modes.
- Luffy card smoke test (`npm run smoke:luffy`) verifies the full card data path
  and runs in CI; `check:deploy` enforces that both CI steps exist.
- Supabase schema documentation now points to the actual migration runner entrypoint.

## External blockers

1. **All eight Render services are suspended by billing (verified 2026-09-16).**
   The Render API reports `suspended: "suspended"` with `suspenders: ["billing"]`
   for every service, and `POST /resume` is refused with
   `only services suspended by a user can be resumed`. Every bot URL returns
   Render's HTTP 503 suspension page, so the bot processes are unreachable.
   This blocks all runtime verification.
2. MongoDB Atlas primary and secondary clusters are paused; re-confirmed by
   direct TLS probes of the SRV-discovered shard endpoints (alert 80 on all
   endpoints) while control hosts complete TLS normally.
3. Upstash Redis quota is exhausted; runtime uses bounded `MemoryKv` fallback
   and distributed coordination is degraded.
4. Supabase trusted guild-access migration `0002` is written/tested but not
   applied to production.
5. Previously exposed Vercel team token requires manual revocation.
6. Authenticated readiness, real Discord interaction tests, and production
   registry sync remain unverified until the fleet and infrastructure are
   restored.

## Required operator actions

- Resolve the Render billing suspension for `Kazuto's Workspace`, then resume
  the eight services (or trigger fresh deploys). This is the first step —
  nothing else can be verified while the fleet is offline.
- Resume both Atlas clusters.
- Revoke the exposed Vercel token.
- Choose a legitimate Upstash capacity path.
- Authorize/apply Supabase migration 0002.
- Then run authenticated readiness probes, all-bot in-guild smoke tests, Luffy
  live card/button smoke tests, backup/restore acceptance, and a final release
  review.

## Release decision

**NOT PRODUCTION-COMPLETE.** Local code gates are green, but external infrastructure and authorization-dependent verification remain outstanding. No commit, push, deployment, or production data mutation was performed by this workstream.
