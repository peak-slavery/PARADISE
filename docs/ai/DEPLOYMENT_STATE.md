# EI-point — Deployment State

> Verified as of 2026-09-16. No secrets — only presence/health assertions.

## Dashboard — Vercel (LIVE)

| Item | Value |
|---|---|
| Project | `ei-point-dashboard` |
| Team | `kazutoz02s-projects` (plan: hobby — single seat) |
| Root directory | `dashboard` |
| Framework | Next.js 16 |
| Build / install | `npm run build` / `npm ci` |
| Node | 24.x (project setting; `vercel.json` mirrors) |
| URL | `https://ei-point-dashboard.vercel.app` |
| Health | `GET /api/health` → **HTTP 200** (`{status:"starting"}` unauthenticated = live-by-design) |

Environment: 11 production-scoped vars verified present and attached
(including `DEMO_MODE=false`, `NEXT_PUBLIC_SITE_URL`). The root `vercel.json`
is informational; project settings carry the build config.

### The Vercel author block (resolved)

Prior deploys failed with:
`The deployment was blocked because the commit author doesn't have permission
to create deployments for this project.` (`TEAM_ACCESS_REQUIRED`,
gitUserId 322412407 = `peak-slavery`). The hobby team is linked to GitHub
`xyanncat`, so only `xyanncat`-authored commits deploy.

**Fix (permanent)**: keep the repo-local git identity as
`xyanncat <168539334+xyanncat@users.noreply.github.com>`. Global identity may
read `peak-slavery` — that is irrelevant because Vercel checks the commit
author. Do not change this.

## Bots — Render free tier (all 8 LIVE)

| Bot | Service ID | URL |
|---|---|---|
| shanks | `srv-dajuo4eq1p3s739kg730` | `https://eiflow-shanks.onrender.com` |
| sanji | `srv-dajuo5uk1f9s739gnddg` | `https://eiflow-sanji.onrender.com` |
| zoro | `srv-dajuo3p42hec738vooug` | `https://eiflow-zoro.onrender.com` |
| boahancock | `srv-d91v4uegvqtc73bo88dg` | `https://royal-paradise-v2-4ery.onrender.com` |
| nami | `srv-dajuo3bm8hqs739pvoo0` | `https://eiflow-nami.onrender.com` |
| luffy | `srv-dajuo567bikc73dj04ng` | `https://eiflow-luffy.onrender.com` |
| niko-robin | `srv-dajuo2oae00c73bftb70` | `https://eiflow-niko-robin.onrender.com` |
| cyrene | `srv-dackk00ae00c73fl0cg0` | `https://cyrene-2ukf.onrender.com` |

All 8 respond HTTP 200 on `/health` with `{status:"degraded"}` — verified
2026-09-16. The status reflects the external Mongo/Redis state, not a code
error. Unauthenticated `/health` returns 200 by design (liveness); 503 is
reserved for authenticated callers (readiness).

**Keep-alive ring** (prevents free-tier spin-down): shanks→sanji→zoro→
boahancock→nami→luffy→niko-robin→cyrene→shanks. Verified active — all 8
probes respond in 300-970ms; a spun-down service would take 30-60s.

**Render API gotchas** (learned the hard way):
- `PUT /v1/services/{id}/env-vars` **replaces the entire env set**. Always
  GET → merge → PUT a complete array. A partial PUT wiped all bot secrets
  once.
- Service create needs `serviceDetails.envSpecificDetails.{buildCommand,
  startCommand}`; top-level commands are rejected.
- Logs: `GET /v1/logs?startTime=<RFC3339>&ownerId=<team>&resource=<srvId>`.
  Params `service`/`serviceName` are invalid; `ownerId` is required.
- Deploy status JSON wraps items in `.deploy` (`j[0].deploy.status`), not flat.
- `/resume` 400s for system-suspended free services — a deploy wakes them.

## Local

PM2 via `ecosystem.config.cjs`: dashboard on 3000, bots on 3101-3108.
`npm run test:local` starts, probes localhost, and always cleans up (it
refuses to start if a named service exists and deletes its 9 test services
afterwards). Each service has `max_memory_restart: '500M'`; the 0.1-CPU
target cannot be enforced by PM2 on Windows — that needs a Job Object,
container, or VM.

## CI

Green on the `ei-point` remote. Jobs: typecheck (shared + 8 bots in a
matrix), lint, npm audit, test, dashboard build, CodeQL (v4, `upload: never`
— repo has no Code Scanning add-on), dependency-review (PR-only), gitleaks
(pinned 8.30.1), production-smoke (gated on `vars.PRODUCTION_SMOKE_ENABLED`).

## Rollback procedure

1. Vercel: pick any prior `READY` deployment in the project history and
   promote it to production (instant, no rebuild).
2. Bots: trigger a Render deploy of the previous commit, or revert the commit
   and redeploy. Render keeps deploy history per service.
3. Supabase: migrations are checksummed and reversible; `npm run drill:rollback`
   exercises the path non-destructively.
4. Mongo: no destructive migrations shipped; index contract is idempotent.

## Deployment checklist (operator gates)

`npm run check:deploy` runs 32 checks and is the deploy gate. Run
`npm run check:local` and `npm run check:bots` before any push.
