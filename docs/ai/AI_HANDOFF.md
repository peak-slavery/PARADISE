# EI-point — AI Handoff

> Read this file first when continuing work. No secrets.

## Current status

The repository is locally validated but the project is **not production-complete**.
The remaining blockers are external infrastructure/operator actions, not a
request to bypass safeguards.

## Verified in this pass

- Filesystem-driven Luffy registry implemented under repo-root `cards/`.
- Deterministic `generated/cards.manifest.json` contains 18 cards across 11
  rarity folders; `npm run cards:check -w @eiflow/bot-luffy` passes.
- Scanner rejects unsupported/corrupt images, duplicate IDs/content, unsafe
  paths/symlinks, malformed metadata, and prototype-pollution keys.
- Luffy catalog preserves existing runtime APIs and stable IDs; startup sync
  upserts/archive/reactivates Mongo definitions without deleting owned state.
- Luffy suite: **79/79 tests passed**.
- Repository and security-sensitive path audit completed.
- `npm run check:deploy`: **32/32** checks passed.
- Shared capacity policy implemented with exact 70/80/90/95% threshold bands,
  priority-aware workload shedding, fail-closed invalid-quota behavior, and
  authenticated Redis capacity diagnostics; see [CAPACITY.md](./CAPACITY.md).
- Release/readiness record written at [RELEASE_READINESS.md](./RELEASE_READINESS.md).
- Luffy card smoke test (`npm run smoke:luffy`) verifies the end-to-end card
  data path and runs in CI; the restore drill now verifies field-level parity
  instead of only document counts.
- Full local regression: workspace typechecks, lint, `npm test` (root 44,
  shared 81, Luffy 79), dashboard build, `npm audit` (0 vulnerabilities),
  `npm run check:deploy` 32/32, card validation, `smoke:luffy` 9/9, and
  `git diff --check` all pass.
- Required handoff files now exist: `TASK_QUEUE.md`, `COMPLETED_WORK.md`,
  `INFRASTRUCTURE_STATE.md`, `QUOTA_STATE.md`, `CAPACITY.md`,
  `RELEASE_READINESS.md`, and this file.
- Public liveness probes: **0/8 reachable on 2026-09-16** — the Render fleet is
  suspended by billing and every bot URL serves the platform's 503 suspension
  page. The earlier 9/9 HTTP 200 result was valid on 2026-09-15 and is now
  historical. Application runtime is verified locally instead via
  `npm run test:local` (9/9 online; authenticated readiness correctly reports
  `supabase:true, mongo:false, redis:false`).

## Blocking state

1. **All eight Render services are suspended by billing** (`suspenders:
   ["billing"]`); both `POST /resume` and `POST /deploys` are refused, so only
   the workspace owner can clear it in the Render dashboard.
2. MongoDB Atlas primary and secondary clusters are paused (re-confirmed by TLS
   probe of the SRV shard endpoints → alert 80; the available `al-` keys are
   inference-only and return 401 against the Atlas Admin API).
3. Upstash Redis free-tier quota is exhausted.
4. A previously exposed team-scoped Vercel token requires manual revocation.
5. Supabase migration 0002 is written and tested but not applied to production.
6. Authenticated production readiness and real Discord interaction testing await
   a restored fleet and Mongo/Redis infrastructure.

## Next exact actions

1. Operator resumes both Atlas clusters.
2. Operator revokes the exposed Vercel token and decides the Upstash capacity
   path.
3. Operator authorizes/applies Supabase migration 0002.
4. Run authenticated health checks and `npm run check:local` again.
5. Run authorized in-guild smoke tests across all eight bots, including Luffy.
6. Re-run the full validation suite and update this handoff with live results.

Delegated queues: Luna (GPT-5.6) task list lives in
[LUNA_TASKS.md](./LUNA_TASKS.md) — dashboard UI/UX, browser verification,
docs sync, read-only release review.

## Constraints

Never print or commit credentials, never commit `temp cred.txt`, never weaken
security gates, never hardcode a privileged Discord identity, and do not create
or push commits without explicit operator authorization.

See `PROJECT_STATE.md`, `KNOWN_ISSUES.md`, `SECURITY_STATE.md`, and
`TASK_QUEUE.md` for detailed state and ownership.
