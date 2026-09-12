# Host Readiness Audit

## Audit metadata

- Project: Paradise Engine / Ei Flow
- Branch: `main`
- Baseline commit: `5f79ed7`
- Baseline relation: `main` is 21 commits ahead of `origin/main`
- Audit mode: local, maintainer-safe, no credential values recorded
- Scope: deployment readiness, runtime startup, bot health, dashboard build, auth/security boundaries, tests, and operational documentation

## Before-work snapshot

### Working tree

The checkout began with 30 tracked modifications and new local files from the active workstream, including deployment documentation, dashboard UI/runtime changes, local launch probes, security tests, and local skill metadata. No commit or push was performed during this audit.

### Runtime prerequisites

| Check | Result |
|---|---|
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| PM2 | Not installed |
| Local credential file | `temp cred.txt` present; values not recorded |
| Bot processes | None running |
| Dashboard process | Not running at baseline |

### Baseline commands

| Command | Result |
|---|---|
| `npm run typecheck` | PASS across all workspaces |
| `npm run test` | PASS: 60 tests |
| `npm run lint` | PASS with `--max-warnings 0` |
| `npm run check:deploy` | PASS: 17/17 checks |
| `npm run check:local` | PASS for four configured provider keys; GROQ AutoMod now falls back to the normal GROQ key; Discord OAuth disabled in Supabase |
| `npm run check:bots` | FAIL as expected with no services running: all 8 health endpoints unreachable |

### Deployment surface

- Dashboard: Next.js 16.3.4, Vercel configuration in `vercel.json`
- Bots: 8 Node/discord.js services described by `render.yaml`
- Bot health: ports 3101–3108 locally and `/health` on Render
- Data/auth: Supabase, MongoDB, Upstash Redis, HMAC bot↔dashboard authentication
- Runtime secret model: vault-managed secrets remain outside `render.yaml`; bots fetch them through signed dashboard requests
- Next.js entrypoint: `dashboard/proxy.ts`; deprecated `dashboard/middleware.ts` is absent

### Baseline risks identified before runtime smoke tests

1. Bot health could not be confirmed until processes were started with valid local credentials and reachable providers.
2. Supabase Discord OAuth is disabled, so dashboard sign-in is not operational until the provider is enabled and redirect URLs are configured.
3. `GROQ_AUTOMOD_API_KEY` is missing, so Zoro's optional classifier feature is disabled locally.
4. `npm audit --audit-level=high` previously reported two moderate transitive Vitest advisories; the available automatic fix requires a breaking Vitest 5 upgrade and was not applied blindly.

## Work performed in this audit

- Reused existing `scripts/check-all-bots.mjs` instead of generating duplicate PM2 wrappers.
- Reused existing `scripts/run-dashboard.mjs` and `scripts/run-bot.mjs` for controlled local startup.
- Ran the complete static/test/deployment baseline.
- Ran a bounded cold-start smoke test for all eight bots using the existing in-memory credential launcher.
- Added the GROQ AutoMod credential alias: an explicit `GROQ_AUTOMOD_API_KEY` wins, otherwise the normal `GROQ_API_KEY` is reused.
- Added a secret-free PM2 ecosystem for the dashboard and all eight bots, plus fleet operator commands.
- Added a 500MB PM2 memory restart threshold and `LOCAL_ONLY=true` loopback binding for the local test profile.
- Added `npm run test:local`, which refuses to overwrite an existing named service and cleans up its nine named services in a finally path.
- Documented that PM2 on Windows cannot hard-enforce a 0.1 CPU-core quota; strict CPU isolation requires a Job Object, container, or VM.
- Started the nine-service PM2 stack during the earlier smoke test and verified stable online status with zero restarts; the stack was subsequently stopped and deleted by exact service name.
- Added no credentials to files or command output.
- The new runner was syntax/config-validated; its live rerun was interrupted before startup after a Windows PM2 shim issue was fixed.

## After-work snapshot

### Static and build gates

| Check | Result |
|---|---|
| `npm run typecheck` | PASS across all workspaces |
| `npm run test` | PASS: 62 tests, including the GROQ AutoMod alias regression |
| `npm run lint` | PASS with `--max-warnings 0` |
| `npm run check:deploy` | PASS: 17/17 checks |
| `npm run build` | PASS: Next.js 16.3.4 production build; all listed routes generated |
| `npm run check:local -- --providers` | PASS: GROQ, Mistral, NVIDIA NIM, and Cerebras model checks returned HTTP 200 |
| `git diff --check` | PASS |

### Live bot smoke test

The controlled test started each bot, waited up to 90 seconds for its health port, requested unauthenticated `/health`, recorded only the HTTP/status result, and stopped every spawned wrapper and child process afterward.

| Bot | Port | Result |
|---|---:|---|
| shanks | 3101 | HTTP 200, `status=degraded` |
| sanji | 3102 | HTTP 200, `status=degraded` |
| zoro | 3103 | HTTP 200, `status=degraded` |
| boahancock | 3104 | HTTP 200, `status=degraded` |
| nami | 3105 | HTTP 200, `status=degraded` |
| luffy | 3106 | HTTP 200, `status=degraded` |
| niko-robin | 3107 | HTTP 200, `status=degraded` |
| cyrene | 3108 | HTTP 200, `status=degraded` |

Interpretation: all eight bot processes successfully initialized their health servers and answered liveness requests. The PM2-managed stack remained online with zero restarts; the dashboard returned HTTP 200. Bot health returned HTTP 200 with `status=degraded`, `redis=true`, and `supabase=true`; MongoDB remained unavailable because the supplied connection path returned a TLS internal-error alert. No code change was made to weaken the encrypted MongoDB guard. Discord gateway `ready` and full production schema readiness still require provider-side verification.

## Final recommendation

**Code/deployment surface: launchable with caveats.** The repository is statically validated, builds successfully, and all eight bot entrypoints pass the local liveness smoke test. Before public activation, complete the provider/operator gates: enable Supabase Discord OAuth and redirect URLs, validate the production schema and vault, verify each Render bot reaches gateway `ready`, and resolve the two moderate Vitest transitive advisories or explicitly accept the breaking upgrade trade-off.

## Evidence limitations

- No production URL or Render/Vercel deployment was supplied for credential-free black-box checks.
- No Discord gateway login was attempted beyond the launcher’s local process/health test; no commands or messages were sent.
- No provider secret values, database records, or external service responses were copied into this report.
