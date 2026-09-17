# EI-point — Project State

> **Single source of truth for project status.**
> Last updated: 2026-09-16 by Atria Dawn (capacity-policy validation pass).
> This file contains **no secrets**. Credential values live only in the
> gitignored `temp cred.txt` and in provider consoles/Vercel/Render env vars.

## PROJECT STATUS: NOT COMPLETE

The codebase is substantially complete and production-deployed, but the
definition of done (§24 of the program brief) is not yet met because of
**external infrastructure blockers that require the operator**, not code
defects. See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

## VERSION/COMMIT

- Branch: `main`
- Last commit: `5e529d4` — `feat(ops): add production fleet triage`
- **51 uncommitted paths** in the working tree (Luffy card registry, OAuth and
  dashboard hardening, shared capacity policy, and persistent AI handoff
  files). No commit or push was created in this pass.
- Push target for CI/Vercel: remote `ei-point` (github.com/xyanncat/EI-point.git)
- Remote `origin` (peak-slavery/PARADISE.git) is 9 commits behind, intentionally
  not synced.
- Git identity MUST remain `xyanncat <168539334+xyanncat@users.noreply.github.com>`.
  Vercel blocks commits authored by `peak-slavery` (TEAM_ACCESS_REQUIRED).

## FEATURES COMPLETED

### Luffy collectible card game + filesystem registry (this session, verified)

Complete One Piece-themed card game in `bots/luffy/`, with a filesystem-driven
card registry under repo-root `cards/` and deterministic
`generated/cards.manifest.json`.

- **Filesystem source workflow** — 11 canonical rarity folders; PNG/JPG/JPEG/WEBP; optional strict JSON sidecars; no manual DB inserts, Discord registration, or per-card source edits.
- **Secure scanner** — deterministic filename IDs, folder-authoritative rarity, symlink/path containment checks, 256 KiB cap, magic bytes plus structural PNG/JPEG/WEBP integrity checks, duplicate ID/content detection, metadata pollution rejection.
- **Manifest** — deterministic sorted entries with root-relative artwork references and SHA-256 hashes; current registry has 18 generated placeholder fixtures preserving stable definition IDs.
- **Runtime adapter** — `catalog.ts` preserves `CARD_DEFINITIONS`, `CARD_PACKS`, `getDefinition`, `getPack`, `definitionsByRank`, and `assertPublishedProbabilities`; archived definitions remain renderable but are excluded from new draws/issuance.
- **Mongo synchronization** — idempotent `card_definitions` upsert/archive/reactivation after Mongo connects; removed artwork never deletes player instances, acquisitions, trades, or ledger history.
- **11-rank hierarchy** (Common → Limited Arts) with frozen weight table summing to exactly 100,000,000. Limited Arts weight 1,000 → effective probability **exactly 0.001%** (`0.00001`).
- **Definition/instance separation**, server-authoritative integer berries economy, CAS-safe selling/trading, data-driven packs, admin issue/revoke, observability, nine commands, and paginated buttons remain intact.
- **79 Luffy tests** — original engine/rarity/store coverage plus scanner, manifest, loader, sync, image-integrity, metadata-security, archival, and idempotency tests.

### Shared capacity and readiness (this pass)

- **Capacity policy** — `packages/shared/src/capacity.ts` centralizes the 70/80/90/95% threshold bands, priority-aware shedding, unhealthy-dependency behavior, and invalid-quota fail-closed behavior.
- **Redis diagnostics** — authenticated health includes the observed `redis_capacity` snapshot; public liveness remains minimal. Existing bounded `MemoryKv` fallback and rate limits remain intact.
- **Release readiness** — `docs/ai/RELEASE_READINESS.md` records local gates separately from external production blockers.
### Previously completed and verified (prior sessions)

- **Discord OAuth login** — provider enabled, correct client ID/secret, site
  URL and redirect URI configured, 302 handshake verified against Discord.
- **Dashboard authorization** — RLS-enforced guild visibility, master control
  panel via database `is_master_user()` predicate, fail-closed 404s.
- **Dev-server gate** — non-master users in DEV_GUILD_ID get an explicit
  ephemeral restriction instead of a misleading cooldown, before any limiter
  bucket is consumed.
- **CI gates** — Dependabot (invalid entry removed), CodeQL v4 with
  `upload: never`, Gitleaks pinned to 8.30.1 with a narrow allowlist,
  dependency-review, production smoke job.
- **Render fleet** — ⚠️ **ALL 8 SERVICES SUSPENDED BY BILLING (2026-09-16)**:
  `suspenders: ["billing"]`, API resume refused with
  `only services suspended by a user can be resumed`, and every bot URL returns
  Render's HTTP 503 suspension page. Previously: all 8 bots live, keep-alive
  ring verified active, command scopes verified via Discord API (no doubles,
  no overlap). See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) item 0.
- **Vercel** — production deployment live and returning HTTP 200.

## SECURITY STATUS

- `npm audit --audit-level=high` → **0 vulnerabilities**
- Lint `--max-warnings 0` → **clean**
- No hardcoded privileged identities; no hardcoded secrets in source.
- Demo mode cannot serve to a partially-configured production deploy
  (`hasConfiguredEnvironment()` fail-closed check).
- See [SECURITY_STATE.md](./SECURITY_STATE.md) for the full posture.

## DATABASE STATUS

- **MongoDB**: schema and indexes correct (30 indexes, 0 duplicates, 0
  conflicting keys, 5 unique constraints verified). **Atlas clusters are
  PAUSED** — `mongo:false` in every health probe. This is an external blocker.
- **Supabase**: 12 tables verified present, RLS active, migration 0002
  (trusted guild access) written but **not yet applied to production**.
- **Redis (Upstash)**: free-tier quota **exhausted** (500000/500000). Bots
  degrade gracefully to MemoryKv; authenticated diagnostics now expose the
  shared capacity band. External blocker.
- See [DATABASE_STATE.md](./DATABASE_STATE.md).

## CI STATUS

Green on `ei-point` remote. All jobs pass locally: typecheck (9 workspaces),
lint, test, build, audit, index-contract check.

## DEPLOYMENT STATUS

- Vercel dashboard: **LIVE**, `https://ei-point-dashboard.vercel.app`,
  `/api/health` → HTTP 200.
- Render bots: **all 8 LIVE**, `/health` → HTTP 200 (status `degraded` due to
  the two external blockers above, not code errors).
- See [DEPLOYMENT_STATE.md](./DEPLOYMENT_STATE.md).

## PRODUCTION TEST STATUS

- Unauthenticated liveness probes: **9/9 respond** (dashboard + 8 bots).
- Authenticated readiness probes: **blocked** by Mongo/Redis external state.
- Discord in-guild functional testing: **not yet performed** — requires the
  Atlas cluster to be resumed so bots can persist state.

## REMAINING NON-BLOCKING ITEMS

- Placeholder card artwork (no copyrighted images bundled — by design).
- Luffy has no live-bot smoke test (unit + type gates only).
- M0 free tier → CAS-based atomicity instead of multi-document transactions.
- Documentation polish for the card system (this pass partially addresses it).

## LAST VALIDATION

2026-09-16: full local validation after the hardening pass: Luffy registry
scanner/manifest validation passes (18 cards, 11 folders), Luffy 79/79 tests,
shared 81 tests, root 44 tests, `tsc --noEmit` across all workspaces,
`eslint --max-warnings 0`, dashboard production build, `npm audit` (0
vulnerabilities), `npm run check:deploy` (32/32), `npm run smoke:luffy` (9/9),
local PM2 runtime smoke (9/9 online), and `git diff --check` all pass.
Authenticated production readiness remains externally blocked: the Render fleet
is suspended by billing and both Atlas clusters are paused.

## NEXT ACTION

**Operator action required** (cannot be done by an agent): resume the two
paused MongoDB Atlas clusters. See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) §1.
Until then, authenticated health stays `degraded` and in-guild Discord
testing is not meaningful.
