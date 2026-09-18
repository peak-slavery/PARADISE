# Paradise Engine — Session Handoff / Memory

> Purpose: persistent context record so any agent/model session can resume
> exactly where the previous session left off. Last updated: **2026-09-17 —
> AI provider resilience implemented** (see §4.6; the "all 8 bots live"
> statements below are historical and no longer true — the fleet is suspended
> by billing). This file contains **no secrets**. Credentials live in gitignored
> `temp cred.txt` only.

## Release checkpoint — 2026-09-17

The operator authorized pushing the accumulated changes and then directed that
everything land on `ei-point` `main` with no extra branches. Delivered: `0bff069`
(card registry, AI resilience, hardening), `a137c9f` (trade version-conflict
fix), `56930ef` (CI registry fix — empty `cards/Gold` tracked via `.gitkeep`,
scanner ignores dotfiles, manifest pinned `eol=lf`). `main` fast-forwarded to
`56930ef`; the temporary release branch was deleted locally and on the remote.
CI run 35193202101 is fully green. Local gates passed: lint, workspace
typechecks/tests, production build, cards:check, 32 deployment checks, audit.
Luffy smoke passed 9 local checks; live Mongo parity skipped (Atlas paused).

Remaining known issues (static review, unreproduced): expired-trade
refund/unlock settlement, relative artwork paths passed to embeds after pack
debit, unrestricted `/open` access to the zero-price `limited.premium` pack,
nested queue acquisition in the sell path, metadata-only sync skips, absent
admin resync subcommand, unconfigured image-provider endpoint. Render billing
suspension and paused Atlas clusters remain production blockers.

## 1. Project overview

Paradise Engine ("eiflow" / "EI-point") = 1 Next.js dashboard + 8 Discord bots.

| Piece | Where | Notes |
|---|---|---|
| Dashboard | `dashboard/` (Next.js 16, port 3000) | Deployed on **Vercel**, project `ei-point-dashboard`, team `kazutoz02s-projects`, plan hobby. Discord login LIVE |
| 8 bots (shanks, sanji, zoro, boahancock, nami, luffy, niko-robin, cyrene) | `bots/*` (discord.js 14, tsx) | ⚠️ **ALL 8 SUSPENDED BY BILLING as of 2026-09-16T12:05Z** — Render serves its 503 suspension page; `suspenders: ["billing"]`, API resume refused. Was ALL LIVE on Render free tier (restored 2026-09-14 after env wipe; keep-alive ring active). Locally via PM2 (`ecosystem.config.cjs`, ports 3101–3108) |
| Shared packages | `packages/shared`, `packages/secret-policy` | Source-only workspaces (`@eiflow/shared`, `@eiflow/secret-policy`) |
| Ops scripts | `scripts/*.mjs` | 26 scripts; 6 `*.test.mjs` run by `npm test`; `check-deploy.mjs` is the deploy gate (31 checks) |
| Infra | `infra/` (supabase migrations, mongo, cron) | Supabase schema loaded and verified (12 tables) |

Dashboard holds all production secrets; bots boot, call `/api/internal/secret/{name}`
with HMAC signatures to fetch their secrets from the dashboard vault. See
`DEPLOY.md` (deployment bible), `SECURITY_BOOTSTRAP.md`, `EI-point_Production_Solution.md` (§16 = required Vercel env vars).

## 2. Git / remotes

- Repo root: `D:\Github\paradise engine` (branch `main`).
- `origin`   → `github.com/peak-slavery/PARADISE.git` — **9 commits behind** (not synced; user hasn't asked).
- `ei-point` → `github.com/xyanncat/EI-point.git` — **push target for CI/Vercel, fully synced and green**.
- Repo-local git identity (MUST stay): `xyanncat <168539334+xyanncat@users.noreply.github.com>`.
  Global identity may read peak-slavery — irrelevant; Vercel checks the commit
  author and blocks peak-slavery-authored commits (TEAM_ACCESS_REQUIRED).
- Latest commits on main: `a1b6f95` (test: init mocked modules in beforeEach —
  hoisted TDZ fix), `89658cf` (test: vitest suites for keepalive + scope split),
  `989291d` (feat: command access split, keep-alive ring, RBAC, security layers),
  `a322ab0` (env template dashboard-URL fix).
- Intentionally untracked: `cross-cutting-principles.md`, `skill-observations/`, `SESSION_HANDOFF.md` (this file).

## 3. What this session fixed (all verified)

### 3.1 GitHub CI — now fully green on EI-point (run 34807131211 and later)
- **Dependabot config**: removed invalid `version-update:ignore` entry.
- **CodeQL**: actions v3→v4 with `upload: never` (repo lacks Code Scanning), explicit autobuild step, and — discovered live — job needs `permissions: actions: read` or it 403s ("Resource not accessible by integration") during status reporting.
- **Gitleaks secret scan**: was failing on Discord-snowflake-shaped values. Fix = `gitleaks.toml` at repo root (auto-detected by `gitleaks-action@v2`; also set `GITLEAKS_CONFIG` + pinned `GITLEAKS_VERSION: '8.30.1'` in ci.yml). Config extends the full default ruleset and allowlists ONLY exact historical values: 8 bot application client IDs (public identifiers), demo member ID `184617893241159680`, placeholder `123456789012345678`, masked former operator ID `147958[0-9]{13}`. Validated empirically: full 54-commit history scans clean; negative test proves new fake IDs/tokens are still caught.
- **Hygiene**: scrubbed real client IDs from all 8 `bots/*/.env.example`; `.gitattributes` (`* text=auto`); `.gitignore` hardened (`.claude/settings.local.json`, `.claude/worktrees/`, `.claude/scripts/`, `.bot-logs/`, `.playwright/`, `.superpowers/`, `.zcode/`).
- Local gates all pass: lint, typecheck (all workspaces), `npm test`, `npm audit` (0 vulns), `check:deploy` (32/32), production dashboard build.

### 3.2 Vercel production deployment — unblocked and live
**Root cause of "Deployment was blocked"** (exact reason from deployment record):
`readyStateReason: "The deployment was blocked because the commit author doesn't have permission to create deployments for this project."`
`seatBlock: {"blockCode":"TEAM_ACCESS_REQUIRED","gitUserId":322412407}` →
GitHub user `322412407` = **peak-slavery**. The Vercel account/team
(`kazutoz02` / `kazutoz02s-projects`) is linked to GitHub **xyanncat** (id 1685334/168539334 — repo owner). Hobby plan = single seat, so commits authored by
`peak-slavery` get blocked; commits authored by `xyanncat` deploy (that's why
Sep 7 deploys worked).

**Fixes applied via Vercel API (token provided by user, session-scoped):**
1. Env scopes: 11 env vars were `development`-only; added `production` target →
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SECRET_VAULT_MASTER_KEY`, `SECRET_VAULT_SALT`, `HMAC_SECRETS_JSON`,
   `DASHBOARD_URL`, `DEV_GUILD_ID`, `MAIN_GUILD_ID`, `DEV_AUTH_CHANNEL_ID`, `DEMO_MODE`.
2. Created missing `NEXT_PUBLIC_SITE_URL=https://ei-point-dashboard.vercel.app` (production scope).
3. Triggered production deploy of commit `11c668b` via `POST /v13/deployments`
   with `gitSource` (creator = kazutoz02 → not subject to the git-author block).
   Deployment `dpl_32Wwh2LMAsveb4ZmRv7FtbFf4BFX` → **READY**, alias
   `https://ei-point-dashboard.vercel.app` returns HTTP 200 on `/api/health`,
   GitHub commit status for `11c668b` = success ("Deployment has completed").

Also known: project `rootDirectory` = `dashboard` (so root `vercel.json` is
informational for Vercel; project settings themselves carry build `npm run build`,
install `npm ci`, framework nextjs, node 24.x — these mirror vercel.json and are fine).

## 4. Open items (next session should pick these up)

### 4.0 RESOLVED — Render env wipe (2026-09-14 fifth pass) → fleet restored (sixth pass)

`scripts/.configure-ring.mjs` sent PARTIAL env arrays to
`PUT /v1/services/{id}/env-vars` — Render's PUT **replaces the entire set** —
wiping DISCORD_TOKEN/BOT_ID/HMAC_SECRET etc. from all 8 services (deploys
crashed with `Error: Invalid environment configuration`, env.ts:261). Lesson
(now twice-learned): **never PUT a partial env array to Render; always GET,
merge, PUT the complete set.**

**Restoration executed 2026-09-14 (sixth pass) — all 8 bots LIVE again:**
- Wrote a throwaway restore script (deleted after use) mirroring
  `scripts/run-bot.mjs`'s authoritative `own` env: bootstrap (BOT_ID, BOT_NAME,
  BOT_VERSION, EMBED_COLOR, DISCORD_TOKEN, DISCORD_CLIENT_ID, HMAC_SECRET,
  HEALTH_TOKEN) + routing (OWNER_IDS, DEV_GUILD_ID, MAIN_GUILD_ID,
  DEV_AUTH_CHANNEL_ID) + backend (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  MONGODB_URI, MONGODB_DB=eiflow, MONGODB_SECONDARY_URI,
  MONGODB_SECONDARY_DB=eipointsecurity, UPSTASH_REDIS_REST_URL/TOKEN,
  DASHBOARD_URL, SENTRY_DSN) + runtime (PORT=3000, LOG_LEVEL=info,
  REDIS_DAILY_COMMAND_BUDGET=8000, NODE_OPTIONS=--max-old-space-size=384) +
  keepalive ring (KEEPALIVE_PING_URL=ring peer, KEEPALIVE_PING_INTERVAL_SEC=300)
  + per-bot AI keys (cyrene: GROQ/MISTRAL/AGNES_IMAGE/OPENROUTER_API_KEY,
  CYRENE_MODEL=openai/gpt-oss-20b, ASSISTANT_MODEL=ministral-8b-latest,
  AGNES_IMAGE_MODEL=agnes-image-2.5-flash; shanks: NVIDIA_NIM/CEREBRAS +
  SECURITY_SLM_MODEL=nvidia/nemotron-3.5-content-safety + FALLBACK=qwen-3.8-27b;
  zoro: CEREBRAS + ZORO_SLM_MODEL=qwen-3.8-27b; niko-robin: MODELSCOPE_API_KEY).
  Dry-run first (printed var counts only, verified no unknown keys would be
  lost), then `--apply` PUT 28-35 vars per service + triggered deploys.
- All 8 deploys: **live** (dep-dak3adqd… through dep-dak3age…), build
  successful, "bot ready" logged for every bot (e.g. shanks 17:58:00,
  boahancock 17:58:04 as BOA Han_cock#9053, cyrene 17:58:00 as Cyrene#8519).
- Detailed health (per-bot HEALTH_TOKEN): supabase **true** (restored keys
  work), mongo false + redis false (the two KNOWN external blockers §4.1 —
  paused Atlas clusters, Upstash quota; NOT code errors). Unauthenticated
  `/health` returns 200 `{"status":"degraded"}` by design (liveness vs
  readiness; 503 only for authenticated callers).
- Boot logs clean: only MongoServerSelectionError + UpstashError lines (the
  known blockers). cyrene logs one optional warn: `missing:
  ["provider.gemini.api_key"]` — optional feature, by design.
- **Keep-alive ring verified active**: every service logs `keep-alive ring
  ping started` with correct peer + interval; 25+ min after boot all 8
  `/health` probes respond in 300-970ms (a spun-down free service would take
  30-60s) — the ring's inbound pings are keeping every service awake.
- Ring peer map (KEEPALIVE_PING_URL per bot): shanks→eiflow-sanji,
  sanji→eiflow-zoro, zoro→royal-paradise-v2-4ery (boahancock),
  boahancock→eiflow-nami, nami→eiflow-luffy, luffy→eiflow-niko-robin,
  niko-robin→cyrene-2ukf, cyrene→eiflow-shanks.
- Service IDs: shanks srv-dajuo4eq1p3s739kg730, sanji srv-dajuo5uk1f9s739gnddg,
  zoro srv-dajuo3p42hec738vooug, boahancock srv-d91v4uegvqtc73bo88dg,
  nami srv-dajuo3bm8hqs739pvoo0, luffy srv-dajuo567bikc73dj04ng,
  niko-robin srv-dajuo2oae00c73bftb70, cyrene srv-dackk00ae00c73fl0cg0.
- **Command scopes verified via Discord API (doubles fixed, confirmed live)**:
  every bot = public commands ONLY in global scope (shanks 11: automode, ban,
  mute, purge, unban, unmute, warn, about, help, serverinfo, userinfo; others
  5-13), dev commands ONLY in dev guild (each bot: exactly `authorize`), and
  scope-overlap NONE for all 8. All 8 bots are members of the dev server ONLY
  (main server returns 403 Missing Access — expected; to use bots in the main
  server, invite them). Global propagation ≤1h; re-verify in the Discord client.
- Render deploy status JSON: list endpoint returns items wrapped in a
  `.deploy` key (`j[0].deploy.status`), NOT flat.
- Temp scripts all deleted (restore/poll/health/bootcheck/verify-commands/
  ringcheck + the offending .configure-ring.mjs). Remaining untracked:
  `scripts/.cmd-audit.mjs` (predates this, harmless).

### 4.1 Blockers that need the USER (outside any agent's reach)

0. **P0 — Render fleet SUSPENDED BY BILLING (discovered 2026-09-16).**
   All 8 services report `suspended: "suspended"`, `suspenders: ["billing"]`,
   `plan: free`, `updatedAt` 2026-09-16T12:05:50–52Z (suspended within ~2s of
   each other). Every bot URL returns HTTP 503 with Render's
   `This service has been suspended by its owner.` HTML page, so the bot
   processes are not reachable. Sources: `GET /v1/services` (all 8),
   `GET /v1/services/{id}` (`suspenders:["billing"]`), live `/health` probes.
   - NOT a free-tier spin-down, NOT a deploy failure, NOT a code error: last
     successful deploy was 2026-09-14T20:02Z and service logs show normal
     operation (only the known `MongoServerSelectionError`) until
     2026-09-16T12:01Z, then suspension at 12:05Z.
   - `POST /v1/services/{id}/resume` → HTTP 400
     `{"message":"only services suspended by a user can be resumed"}`.
     A billing suspension cannot be cleared by any available credential.
   - **Fix (operator)**: Render dashboard → Billing for `Kazuto's Workspace`
     (`tea-csp5vkrgbbvc73fq1j5g`) → resolve the balance/plan issue, then resume
     the services (or trigger fresh deploys).
   - Until this clears, NO runtime verification is possible: health probes,
     in-guild Discord tests, and the Luffy smoke test all require the fleet.
     This supersedes items 1–2 below in ordering.

1. **MongoDB Atlas clusters are paused — health check `mongo:false`.**
   Both `eiflow.onrjgir.mongodb.net` (primary) and `eipointsecurity.sutarwt.mongodb.net`
   (secondary) fail at the TLS handshake with alert 80 (internal_error), from BOTH the
   local machine and Vercel's runtime. DNS/SRV resolve fine, cert verifies.
   Fix: MongoDB Atlas console → Database → select cluster → Resume.
   The `MONGODB_URI` Vercel var is verified correct and attached to the live
   deployment (id `sEnLUuUlguUWPV7j`) — no env work left, purely cluster resume.
   NOTE: the `al-` keys in `temp cred.txt` are Atlas **Model API** (inference) keys —
   they authenticate (Bearer) against `ai.mongodb.com/v1/embeddings` but CANNOT
   resume clusters (that needs console access or an org API key).
2. **Upstash Redis free-tier monthly quota exhausted (500000/500000)** —
   every Redis call returns `ERR max requests limit exceeded`, so health reports
   `redis:false`. Structural: 8-bot heartbeats (60s × ~2-4 cmds) burn ~350K/mo.
   Options: upgrade Upstash, lengthen heartbeat interval, or let bots degrade to
   MemoryKv (runtime already falls back gracefully). Quota resets monthly.
3. **Exposed Vercel token (second `z code`, team-scoped)** — could NOT be
   self-deleted via API (`/v3/user/tokens` 403 for team tokens). User must delete
   it in Vercel → Account Settings → Tokens.

### 4.2 DONE this session (2026-09-14, fourth pass — production push)

- **Discord login FIXED end-to-end** (was: provider disabled + invalid credentials):
  - Root causes: (a) Discord provider disabled in Supabase; (b) Client ID field
    contained the literal text "Makima" (an app name, not the application ID).
  - Fix: entered Niko Robin application's Client ID `1479781452987109377` + its
    client secret (both from `temp cred.txt`) in Supabase → Authentication →
    Providers → Discord, enabled the toggle, saved.
  - URL Configuration: Site URL `https://ei-point-dashboard.vercel.app`, Redirect
    URL `https://ei-point-dashboard.vercel.app/auth/callback` (Total URLs: 1).
  - Verified: `GET /auth/v1/authorize?provider=discord` → HTTP 302 to
    `discord.com/api/oauth2/authorize` with correct client_id/redirect_uri/scope,
    and Discord accepts the redirect_uri (no INVALID_REDIRECT).
  - IMPORTANT knowledge: the real kickoff endpoint is `/auth/v1/authorize?provider=...`
    (NOT `/oauth/discord` — that 404s `feature_disabled` ALWAYS, even when working;
    it's the OAuth Server BETA surface). supabase-js `signInWithOAuth` uses /authorize.
  - UI automation notes: Supabase's new toggle responds to keyboard Space when
    focused (AXPress/clicks were unreliable); text fields accept focus+ctrl+a+type.
- **Render fleet: ALL 8 BOTS LIVE on free tier**:
  - Existing: cyrene (`srv-dackk00ae00c73fl0cg0`, url cyrene-2ukf.onrender.com) and
    Boa-Hancock (`srv-d91v4uegvqtc73bo88dg`, royal-paradise-v2-4ery.onrender.com) —
    were system-suspended with missing env; fixed DISCORD_TOKEN/DISCORD_CLIENT_ID,
    corrected DASHBOARD_URL, added UPSTASH vars to cyrene; triggered deploys to wake
    (note: `/resume` 400s for system-suspended free services — a deploy wakes them).
  - Created new (owner `tea-csp5vkrgbbvc73fq1j5g`, rootDir `bots/<bot>`, plan free,
    healthCheckPath /health): eiflow-niko-robin `srv-dajuo2oae00c73bftb70`,
    eiflow-nami `srv-dajuo3bm8hqs739pvoo0`, eiflow-zoro `srv-dajuo3p42hec738vooug`,
    eiflow-shanks `srv-dajuo4eq1p3s739kg730`, eiflow-luffy `srv-dajuo567bikc73dj04ng`,
    eiflow-sanji `srv-dajuo5uk1f9s739gnddg`. URLs: `https://eiflow-<bot>.onrender.com`.
  - Render API create shape: needs `serviceDetails.envSpecificDetails.{buildCommand,
    startCommand}` (top-level commands rejected); env-vars via PUT array (PUT replaces
    — send complete sets).
  - Render logs API: `GET /v1/logs?startTime=<RFC3339>&ownerId=<team>&resource=<srvId>`
    (params `service`/`serviceName` are invalid; `ownerId` required).
  - All 8 health endpoints HTTP 200 (free tier cold-starts add ~30-60s latency —
    000/timeout on first probe is normal, retry).
  - Bots log only MongoServerSelectionError (paused Atlas) + Upstash quota errors —
    both external blockers above, no code errors.
- Supabase schema verified visually in Table Editor: all 12 tables present
  (users, servers, server_settings, security_events, secret_records, mod_actions,
  internal_request_nonces, infra_accounts, guild_whitelists, bot_states,
  bot_configs, antinuke_whitelist).
- `origin` (peak-slavery/PARADISE) still 6 commits behind; sync only if user asks.

### 4.3 Deferred by design (not errors)

1. **Production smoke CI check stays skipped** until Atlas + Upstash are fixed
   (the smoke script requires supabase+mongo+redis all true on every bot).
   Bot URLs are ready (see §4.2); to enable: set repo variable
   `PRODUCTION_SMOKE_ENABLED=true` + the secrets it lists on `xyanncat/EI-point`.
2. `dependency review` stays skipped on main — PR-only by design.
3. Free-tier caveats: Render free services cold-start ~30-60s (first probe may
   timeout/000 — retry); Upstash quota exhaustion persists until reset/upgrade.

### 4.4 Done this session (2026-09-14, second pass)

- **Durable git-identity fix APPLIED AND PROVEN**: repo-local
  `git config user.name xyanncat` / `user.email 168539334+xyanncat@users.noreply.github.com`.
  Verification commit `dc5332d` (docs: Upstash vars in `.env.vercel.example`) pushed
  → Vercel auto-deployed production READY (dpl_8oYv4hJF3AMCrmqyKehXkHzXJD9k), GitHub
  commit status "Deployment has completed", CI run 34819182524 all-success.
  Future pushes by this machine will auto-deploy. Do NOT reset to peak-slavery identity
  for this repo, or Vercel blocks again (TEAM_ACCESS_REQUIRED, hobby single-seat).
- **Vercel production env fixed** (was the source of `degraded` health):
  - `MONGODB_URI`: was literally `undefined`; deleted + recreated with the real
    101-char URI from `temp cred.txt` — superseded by the final recreate in the
    third pass (current live var id `sEnLUuUlguUWPV7j`).
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`: created (production).
    Verified: Upstash ping returns PONG. NOTE: Upstash free tier rate-limits
    per-second; rapid health calls can transiently show `redis:false` (ERR max
    requests limit exceeded) — retry before concluding broken.
  - `DASHBOARD_HEALTH_TOKEN`: created (production); value saved to
    `temp cred.txt` (2026-09-14 section). Required to see real health status —
    unauthenticated `/api/health` always says `starting` by design.
- **DEMO_MODE=false verified** in production (decrypted via API).
- Vercel API quirks learned (see §7).
- **Env-file cleanup (commit a322ab0, 2026-09-14)**: audited all 12 `.env*`
  files. The 11 `.env.example` templates are all load-bearing (check-deploy
  gate requires each; new-bot.mjs reads the root one) — kept. Deleted the
  only redundant file, `bots/cyrene/.env` (gitignored local leftover holding
  a real client ID + real OWNER_IDS; the launcher reads `temp cred.txt`
  directly and never opens it). Also fixed a real footgun: all 8 bot
  templates + DEPLOY.md carried the retired `paradise-engine.vercel.app`
  DASHBOARD_URL — a bot configured from them would sign vault requests
  against the wrong dashboard. Now `https://ei-point-dashboard.vercel.app`
  everywhere (matches `scripts/run-bot.mjs`). CI green, Vercel deployed.
- **Full env-value audit (2026-09-14, third pass, with second token)**:
  decrypted all 19 production env vars via API and compared to
  `temp cred.txt`. Result: **18/19 match**. Fixes applied:
  - `DASHBOARD_URL`: removed trailing slash (38→37 chars, canonical form;
    functionally harmless since vault-client normalizes via `URL().origin`).
  - `MONGODB_URI`: deleted the broken var (decrypted to the literal string
    `undefined` originally) and recreated from the real 101-char URI —
    verified ATTACHED to deployment dpl_57SyyY5CHGKqwUW2uNrAVC3fvr84.
  - `MONGODB_SECONDARY_DB`: Vercel's `eipointsecurity` was CORRECT; the
    `eipointsecutity` spelling in `temp cred.txt` was a typo (matches code
    default `packages/shared/src/env.ts:82`). Fixed the cred file.
  - Remaining "DIFF" on MONGODB_URI decrypt (len 0) is a known API quirk of
    `type: sensitive` vars — the list/decrypt endpoints return empty even
    when set. Deployment attachment is the reliable proof.
  - `temp cred.txt` typo fixed: database name now `eipointsecurity`.
- `origin` (peak-slavery/PARADISE) now 6 commits behind; sync only if user asks.

### 4.5 DONE this session (2026-09-14, fifth pass — command scopes, RBAC, keep-alive, security layers)

User request: fix doubled slash commands; auto-ping keep-alive per bot; lock
auth/verification commands to dev server while normal + moderation commands stay
public everywhere; dashboard-editable per-role command access; multi-layer
security hardening. All code shipped in `989291d` + `89658cf` + `a1b6f95`
(pushed to ei-point; CI success on `a1b6f95`; Vercel production deploy success).

- **Doubled slash commands — root cause + structural fix**:
  - Cause: earlier `--guild` deploys registered guild copies; a later global
    deploy never cleared them (deploy-commands-all.mjs passed no guild IDs), so
    commands existed in BOTH guild and global scope → Discord showed doubles.
  - Split model: `CommandModule.access?: 'public' | 'dev'` (types.ts).
    `universal/authorize.ts` exports `access = 'dev'` (auth/verification).
    `LazyCommandRunner.accessFor(name)` reads it lazily (commands.ts).
  - `deploy.ts registerCommands` now splits: guild mode → dev body to that
    guild. Global mode → public body to GLOBAL, dev body to DEV_GUILD_ID, `[]`
    to MAIN_GUILD_ID (clears stale guild copies); warns if dev commands exist
    without DEV_GUILD_ID; verifies readback counts.
  - Runtime second layer (bot.ts): dev-access command used outside
    `env.devGuildId` → rejected "Dev server only". A command can now never
    exist in two scopes.
  - Re-registered globally for all 8 bots (public counts): shanks 12, sanji 9,
    zoro 14, boahancock 8, nami 8, luffy 10, niko-robin 6, cyrene 11.
    Global propagation ≤1h. Registration is API-only and ALREADY DONE (bots do
    not need to be online); only the in-Discord verification is pending.
  - `scripts/deploy-commands-all.mjs` buildEnv now reads DEV_GUILD_ID /
    MAIN_GUILD_ID from cred-file lines `#dev server=` / `#main server=`.
- **Keep-alive ring** (anti-spin-down for Render free tier):
  - `packages/shared/src/keepalive.ts`: `parseKeepaliveConfig` (https-only
    except localhost; unset URL = disabled) + `startKeepalivePing` (default
    300s cadence clamped 60–900, 10s fetch timeout, warn after 3 consecutive
    failures, staggered first ping 30–90s, all timers unref'd). Wired in
    bot.ts `ClientReady`; exported from shared index.
  - Ring order configured on all 8 services (peer URLs in §4.0): shanks→sanji→
    zoro→boahancock→nami→luffy→niko-robin→cyrene→shanks. Closed ring, no
    Redis/cron/external uptime service; one awake bot re-seeds the whole ring.
  - Ring env vars were being written when the env wipe happened — they exist
    on the services but the vars they REPLACED are gone (§4.0).
- **RBAC — dashboard-configurable per-role command access**:
  - bot.ts runtime: reads `bot_states.feature_flags.command_roles` (jsonb:
    `{ [commandName]: roleId[] }`) via existing getControlState. Bypass for
    services.isOwner / guild owner / Administrator. A command with a non-empty
    role list requires the invoking member to hold one of those roles, else
    finishOperation('forbidden'). Commands with no entry stay open (default
    public), so nothing breaks before the user configures roles.
  - `dashboard/components/dashboard/AccessControl.tsx` (new): per-command role
    ID inputs for the active bot, loads GET /api/bot-state/{guildId}, saves
    PATCH with preserved feature_flags, parses comma/space-separated IDs
    (\d{15,21}), shows restricted count, demo-mode aware. Mounted in
    `dashboard/app/dashboard/[guildId]/page.tsx` between ConfigForm and
    ControlCenter.
- **Security layers added** (on top of existing HMAC vault, fail-closed guild
  auth, CSRF same-origin, open-redirect guard, bounded bodies, gitleaks/
  CodeQL/audit gates):
  - `vercel.json` headers: HSTS `max-age=63072000; includeSubDomains; preload`;
    CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src
    'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com;
    font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co;
    frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
    X-DNS-Prefetch-Control off.
  - `dashboard/proxy.ts`: per-IP sliding-window rate limiter before the CSRF
    gate — login/callback 10/min, `/api/internal/*` 60/min, `/dashboard`
    120/min; 429 JSON + Retry-After 60; bucket map bounded at 5,000 entries.
- **Test lessons (packages/shared runs Vitest, NOT node:test)**:
  - node:test-style files die with "No test suite found" — import
    `describe/expect/it` from 'vitest'.
  - `vi.hoisted` state factories must not reference consts declared later
    (TDZ): initialize `modules: []` inside the hoisted object and populate in
    `beforeEach` (`a1b6f95` fixed exactly this).
  - New suites: `keepalive.test.ts` (6 tests on parseKeepaliveConfig) and
    rewritten `deploy.test.ts` (5 tests on the split registration model with
    a typed `devModule(name, access?)` factory).
- Temp scripts from the fifth pass all deleted (the offending
  `.configure-ring.mjs` + restore/verification helpers). Remaining untracked:
  `scripts/.cmd-audit.mjs` (predates this work, harmless).

### 4.6 DONE this session (2026-09-17, eleventh pass — AI provider resilience)

- The routing audit found 6 of 11 required AI capabilities missing in cyrene:
  provider rate limits, quotas, retries, circuit breakers, provider health,
  capacity tracking. `completeWithFallback` made exactly ONE attempt per
  provider and retried broken providers in full on every request.
- **New `bots/cyrene/src/lib/resilience.ts`** (pure, injectable time, fully
  tested): circuit breaker (closed→open→half-open; opens on consecutive-
  failure threshold or immediately on 429/permanent), provider cooldown
  (parks a provider, admits exactly one probe per window), bounded retries with
  exponential backoff + jitter capped under the request timeout (abort-aware),
  failure classification from HTTP status, `ProviderHealthRegistry`, and
  `DailyRequestBudget` feeding the shared capacity bands via
  `decideCapacity(snapshot, 'optional')`.
- **Wired**: `completeWithFallback` consults the breaker, retries transient
  failures, records success/failure, and skips parked providers; `/model` shows
  live breaker state + counters; `runCompletion` gates on capacity admission
  and counts issued requests.
- **37 new tests** (29 resilience + 8 router integration), proven against wired
  behavior. Cyrene suite: 48 tests (was 11).
- Gates: lint clean, typecheck 0 errors, root 44, shared 81, cyrene 48, luffy
  79, dashboard 32, audit 0, `check:deploy` 32/32, `smoke:luffy` 9/9,
  `git diff --check` clean.

### 4.7 DONE this session (2026-09-16, tenth pass — restore integrity + card smoke)

- **Fixed a silent-corruption gap in `scripts/restore-drill.mjs`**: it verified
  only document COUNT, so a truncated/corrupted restore was reported as
  `restore drill passed`. Now verifies field-level parity via an exported
  `verifyRestoreParity()` (excludes `_id`, dropped on insert, and `restored_at`,
  added by the drill). 8 regression tests; corrupted/truncated/injected cases
  fail as intended. Drill body is behind a main guard so tests import it
  without credentials or a live cluster.
- **Added `scripts/luffy-smoke.mjs`** (`npm run smoke:luffy`): end-to-end card
  data path — manifest loads, IDs unique, artwork refs contained (no traversal,
  no absolute paths), `sha256:` hashes present, weights total 100,000,000,
  Limited Arts exactly 0.001%, runtime catalog loads the manifest and contains
  every enabled definition, and (with `MONGODB_URI`) every enabled manifest card
  exists in Mongo `card_definitions` and none is disabled.
  Three-way exit codes: 0 verified / 1 real defect / 2 unverifiable.
  Verified non-vacuous: injected `../../etc/passwd` artwork ref → exit 1;
  unreachable Mongo URI → exit 2; restored → 9/9 pass.
- **Wired into CI** (`cards` job after the scanner gate) and enforced by
  `check:deploy` so neither step can be silently dropped. Verified the
  assertion fires by removing the CI step (gate failed), then restoring it.
- Gates: lint clean, typecheck 0 errors, root **44** tests, shared **81**,
  Luffy **79**, npm audit 0 vulns, `check:deploy` **32/32**, `smoke:luffy` 9/9,
  card scanner 18 cards / 11 folders, `git diff --check` clean.

### 4.8 DONE this session (2026-09-16, ninth pass — fleet suspension + local verification)

- **P0 discovered: all 8 Render services are suspended by billing.** Render API
  reports `suspended: "suspended"`, `suspenders: ["billing"]`, `plan: free`,
  `updatedAt` 2026-09-16T12:05:50–52Z. Every bot URL serves Render's
  `This service has been suspended by its owner.` 503 page. NOT a spin-down, NOT
  a deploy failure: last deploy 2026-09-14T20:02Z, logs normal until 12:01Z.
  Both recovery APIs are closed — `POST /resume` → 400
  `only services suspended by a user can be resumed`; `POST /deploys` → 400
  `cannot deploy suspended service`. Owner-only fix (Render → Billing).
- **Atlas resume re-confirmed impossible**: `al-` keys → 401 against
  `cloud.mongodb.com/api/atlas/v2/groups` (digest + Bearer); no org/admin key in
  `temp cred.txt`. Cluster pause re-verified by TLS probing the SRV-discovered
  shard endpoints on 27017 → alert 80 (4/4), while control hosts complete TLS.
- **Local runtime verification (substitute for the suspended fleet)** via
  `npm run test:local`: all 9 services `online`, 0 restarts; all 8 bots
  `/health` HTTP 200; dashboard HTTP 200. Authenticated readiness on 3101 →
  HTTP 503 `{"status":"degraded", db_connections:{supabase:true, mongo:false,
  redis:false}}` plus a live `redis_capacity` object (quota 8000, usage 68,
  band `normal`). 0 substantive error lines across all 8 bot error logs; only
  the two known external errors appear. Luffy logged `bot ready` and
  `card registry sync skipped because primary Mongo is unavailable`.
- **Fixed `scripts/test-local-stack.mjs`** (real bug): it waited 90s for the
  dashboard with a 30s per-request timeout, but the dashboard runs `next dev`
  and compiles 24 routes on first request alongside 8 booting bots. One slow
  request consumed the budget and the harness failed spuriously even though
  everything was healthy. Now: dashboard 240s, bots 120s, per-request 15s.
  `npm run test:local` passes with exit 0 and 0 leftover PM2 processes.
- **Strengthened `packages/shared/src/db/supabase-rls.test.ts`** from
  policy-name string matching to real security assertions (no browser writes to
  `guild_access`, self-scoped read only, `revoked_at is null` required, master
  predicate retained, no destructive SQL, upsert-idempotent backfill). Proved
  non-vacuous by injecting a `for all using (true)` policy → suite failed →
  restored the file → suite passed. Shared suite is now **81 tests**.
- Gates: lint clean, typecheck 0 errors, root 36 tests, shared 81, Luffy 79,
  dashboard green, `npm audit` 0 vulns, `check:deploy` 31/31, `git diff --check`
  clean. No commit/push/deploy/production mutation.

### 4.9 DONE this session (2026-09-15, seventh pass — verification + triage)

Daily follow-up on the restored fleet. **Result: 0 novel failures anywhere.**

- **Fleet re-verified**: all 8 bots liveness HTTP 200, authed readiness 503
  (degraded — known blockers only), supabase:true everywhere, uptime
  4389–4495s. The uptime values exactly match the sixth-pass env-restore
  deploys (~18:04 UTC Sep 14) — i.e. NO mass restart ever happened; the
  keep-alive ring has held every service continuously, ~5× past the free-tier
  spin-down window. RAM 155–194MB (384MB cap).
- **Render logs triaged** (100 lines/service): every error/warn line across
  all 8 services is exactly one of the two known blockers —
  `MongoServerSelectionError … tlsv1 alert internal error … alert number 80`
  (paused Atlas) or `UpstashError … max requests limit exceeded. Limit:
  500000, Usage: 500000`. Zero novel errors. cyrene's optional
  gemini.api_key warn persists by design.
- **Upstash**: still 500000/500000 (monthly quota — unchanged). No reset yet.
- **Atlas**: `al-` keys tested against Atlas Admin API v2 (`/api/atlas/v2/groups`)
  → HTTP 401 both keys — confirmed inference-only, cannot resume clusters.
  Direct local probes of both cluster URIs → same TLS alert 80 → both still
  paused. Cluster resume remains console-only (§4.1 item 1).
- **Vercel exposed token**: no Vercel API token exists in `temp cred.txt`
  (the chat-pasted one is burned/not recorded by policy; team tokens also
  403 on API self-delete per fifth-pass attempt). Deletion stays a user-side
  UI action (§4.1 item 3).
- **Fleet triage tool** — `scripts/triage-fleet.mjs` (+ `triage-fleet.test.mjs`,
  10 tests, wired into `npm test` root suite + `npm run triage:fleet`).
  Separates liveness vs readiness vs KNOWN external blockers vs NOVEL
  failures. Direct-probes Mongo (TLS alert 80 = atlas-pause signature) and
  Upstash (max-requests = quota signature) once, then classifies each bot:
  ok / blocked / novel / down / auth-failed. Exit 0 = healthy or known
  blockers; exit 1 = novel. supabase:false is ALWAYS novel (system of
  record, no known blocker).
  **Updated 2026-09-16**: Render's billing-suspension page (HTTP 503 HTML
  `This service has been suspended by its owner.`) is detected and classified
  as `blocked`, not as a NOVEL application failure. Previously it was reported
  as novel, which misleadingly pointed operators at code that never ran.
  Current live output: 8× BLOCKED (billing suspension), 0 novel, exit 0.
- **Main-server invite links** (bots are in the dev server ONLY — main guild
  returned 403 Missing Access because they were never invited). Guild-scoped
  one-click links, permissions right-sized per bot's commands:
  - shanks (moderation: ban/kick/mute/purge): perms 1099646233670
    `https://discord.com/oauth2/authorize?client_id=1544550226373640263&permissions=1099646233670&scope=bot%20applications.commands&guild_id=848841415940898827`
  - sanji (logging: audit log + webhooks): perms 537251040
    `https://discord.com/oauth2/authorize?client_id=1544551817634119784&permissions=537251040&scope=bot%20applications.commands&guild_id=848841415940898827`
  - zoro (antinuke: full security set): perms 1100317322486
    `https://discord.com/oauth2/authorize?client_id=1544547167858069504&permissions=1100317322486&scope=bot%20applications.commands&guild_id=848841415940898827`
  - boahancock / nami / luffy / niko-robin / cyrene (chat-only base
    379968: view/send/embed/attach/history/react/external-emojis):
    `https://discord.com/oauth2/authorize?client_id=<ID>&permissions=379968&scope=bot%20applications.commands&guild_id=848841415940898827`
    with ID 1479781736278917164 (boahancock), 1544543648065261628 (nami),
    1544550806118858792 (luffy), 1479781452987109377 (niko-robin),
    1544546018807513131 (cyrene).
  NOTE: `authorize` pages are client-side rendered — HTTP 200 alone doesn't
  validate; client IDs are proven valid via the Discord API scope checks.
- Gates after triage-tool work: lint clean, all typechecks pass, npm test
  25/25 root + all workspace suites green.
- Temp scripts (.verify/.logs/.logdbg/.atlas/.svcdbg) deleted. Remaining
  untracked: `scripts/.cmd-audit.mjs` (predates all this, harmless), plus
  intentionally-untracked SESSION_HANDOFF.md / cross-cutting-principles.md /
  skill-observations/.

## 5. Environment / credentials map

- PM2 services + ports: see AGENTS.md table (dashboard 3000, bots 3101–3108).
- Real credentials: `temp cred.txt` (gitignored, never committed — verified via
  full-history search). Contains: Supabase URL/anon/service-role keys,
  `sb_publishable_`/`sb_secret_` project keys (sb_secret = service-role for the
  project's auth admin API — does NOT work on the Management API), primary +
  secondary Mongo connection strings, Upstash URL/token, Cloudflare R2 keys,
  Firebase service account, all 8 bots' Discord tokens/client ids/secrets/HMAC/
  health tokens, HMAC_SECRETS_JSON, vault keys, DASHBOARD_HEALTH_TOKEN,
  **Render API key** (`rnd_…`, account xyann), **Atlas Model API keys**
  (`al-…`, inference only — cannot manage clusters), Sentry DSN, guild/master IDs.
- Render: team `tea-csp5vkrgbbvc73fq1j5g` (Kazuto's Workspace, free tier);
  8 services; bot URLs `https://eiflow-<bot>.onrender.com` except cyrene
  (`cyrene-2ukf.onrender.com`) and boahancock (`royal-paradise-v2-4ery.onrender.com`).
- Vercel team id: `team_TVtqccQqADl7eKlxfY5Z8yd1`; project id:
  `prj_j8INvPufJyFXsNKAloO7sQYRAg4J`; bot URLs above also feed production smoke.
- Supabase project: `qizbftvqvkkvchhhnawg` (org "ei point", FREE plan);
  Dashboard login = Discord via Niko Robin application (client id
  `1479781452987109377`); Supabase callback
  `https://qizbftvqvkkvchhhnawg.supabase.co/auth/v1/callback` (already registered
  in the Discord app — no INVALID_REDIRECT).

## 6. Verification commands (replicate anytime)

```bash
npm run lint && npm run typecheck && npm test
npm audit --audit-level=high
npm run check:deploy           # deploy gate, 31 checks
npm run build -w @eipoint/dashboard

# Bot fleet (8 live services; cold-start adds ~30-60s — retry on 000):
for b in niko-robin nami zoro shanks luffy sanji; do
  curl -s -o /dev/null -w "$b: %{http_code}\n" --max-time 60 "https://eiflow-$b.onrender.com/health"; done
curl -s -o /dev/null -w "cyrene: %{http_code}\n" --max-time 60 https://cyrene-2ukf.onrender.com/health
curl -s -o /dev/null -w "boahancock: %{http_code}\n" --max-time 60 https://royal-paradise-v2-4ery.onrender.com/health

# Dashboard health (token in temp cred.txt DASHBOARD_HEALTH_TOKEN=):
curl -s -H "Authorization: Bearer <DASHBOARD_HEALTH_TOKEN>" https://ei-point-dashboard.vercel.app/api/health

# One-shot fleet triage (liveness vs readiness vs known blockers vs NOVEL):
npm run triage:fleet            # exit 0 = healthy or known blockers; 1 = novel

# Local runtime verification (substitute while Render is suspended):
# boots dashboard + all 8 bots under PM2, probes real health endpoints,
# then always deletes its own services. Verify `pm2 status` is empty after.
npm run test:local

# Luffy card data path (manifest → catalog → Mongo parity when reachable):
npm run smoke:luffy
# exit 0 = fully verified, 1 = real defect, 2 = unverifiable (Mongo unreachable)

# Discord login flow (302 = working; provider must be discord:true):
curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/auth/v1/authorize?provider=discord&redirect_to=https://ei-point-dashboard.vercel.app/auth/callback" -H "apikey: $ANON_KEY"
# (do NOT use /auth/v1/oauth/discord — always 404 feature_disabled, wrong endpoint)

gh run list --repo xyanncat/EI-point --limit 3
```
Expected once the Render suspension is cleared AND Atlas is resumed AND the
Upstash quota resets: health returns
`{"status":"ok","db_connections":{"supabase":true,"mongo":true,"redis":true}}`.

Current state (**2026-09-16**): the bot fleet is **offline — all 8 services
suspended by billing**. Every bot URL returns Render's HTTP 503 suspension page
(HTML, `This service has been suspended by its owner.`), so there is no bot
liveness or readiness signal at all. Dashboard (Vercel) state is unchanged.
`npm run triage:fleet` reports 8× blocked (billing suspension), 0 novel, exit 0;
`npm run check:local` reports both Mongo clusters unavailable with Supabase
Discord OAuth enabled. Resolve the Render billing issue first — nothing
else can be verified while the fleet is down.

Once services are running again, the expected degraded (not healthy) state
until Atlas + Upstash are also fixed is: every detailed health =
supabase:true, mongo:false (paused Atlas), redis:false (Upstash quota).
Unauthenticated bot `/health` 200 `{"status":"degraded"}` is normal (liveness
surface); 503 detailed is authenticated-only. Verify command doubles are gone
in the Discord client (API-verified: global=public-only, dev guild=authorize
only, overlap NONE).

## 7. Vercel API quirks learned (save yourself hours)

- The v9 list endpoint returns `value:""` for secret/sensitive vars — an
  EMPTY list value does NOT mean unset. Ground truth = GET by id with
  `?decrypt=true`, or better, the live deployment's behavior.
- PATCH on `type: sensitive` vars can return 200 without persisting. When a
  sensitive value is wrong, DELETE the var then POST a fresh one
  (POST /v10/projects/{id}/env). Watch for `ENV_CONFLICT` — it means a prior
  create actually succeeded despite an odd-looking response.
- Git Bash on Windows mangles env vars passed into `node -e` inline scripts
  (`process.env.VAR` arrives empty). Write request bodies to temp files with
  node reading `temp cred.txt` directly, then `curl --data-binary @file`.
- Deploy as project owner (API token) bypasses the git-author block:
  POST /v13/deployments with `gitSource{org,repo,ref}` + `target=production`.
- Deployment record fields worth reading on BLOCKED: `readyStateReason`,
  `seatBlock`, `alwaysRefuseToBuild`, `errorLink`.
- Client-side encrypted vars (type `encrypted`, created with decryptionKey)
  show ~1KB base64 blobs; `decrypt=true` returns the real value only for the
  same key holder.
