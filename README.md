# Paradise Engine

> A security-first Discord operations platform built from eight focused bots and one control-plane dashboard.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#license)

Paradise Engine separates moderation, security, analytics, utility, and AI workloads into independently deployable Discord services. A Next.js dashboard provides authenticated guild configuration, live activity, security incidents, and setup readiness without placing privileged credentials in the browser.

## At A Glance

```text
Discord guilds
      |
      +-- Shanks       moderation
      +-- Sanji        audit logging
      +-- Zoro         antinuke and threat response
      +-- Boa Hancock  welcome and leave automation
      +-- Nami         XP and leveling
      +-- Luffy        card game and inventory
      +-- Niko Robin   web search
      +-- Cyrene       AI assistant
      |
      +-- Next.js control plane
              |
              +-- Supabase: Auth, ownership, configuration, security events
              +-- MongoDB: high-volume activity, XP, games, inventories, AI context
              +-- Redis: rate limits, counters, cache, quota controls
```

## Why The Architecture Is Split

| Layer | Responsibility | Primary control |
| --- | --- | --- |
| Discord bots | Event handling and guild operations | Guild authorization, runtime permission checks, per-command limits |
| Shared runtime | Common contracts and reliability primitives | Zod environment validation, queues, HMAC, structured logging, health checks |
| Supabase | Auth and low-write control-plane data | RLS, ownership predicates, service-role isolation |
| MongoDB Atlas | High-volume operational data | TLS-only connections, scoped queries, indexes, TTL retention |
| Upstash Redis | Shared distributed state | Rate limits, antinuke windows, provider cooldowns, cache |
| Next.js dashboard | Secure operator interface | Supabase sessions, HTTPS production origins, security headers |

## Bot Fleet

| Bot | Focus | Representative commands |
| --- | --- | --- |
| Shanks | Moderation | `/warn`, `/mute`, `/ban`, `/unban`, `/purge` |
| Sanji | Logging | `/setlogchannel`, `/logconfig`, `/message logs`, `/other logs` |
| Zoro | Antinuke | `/antinuke`, `/whitelist`, `/security`, `/lockdown`, `/scan`, `/snapshot` |
| Boa Hancock | Welcome automation | `/setwelcome`, `/setleave`, `/testwelcome` |
| Nami | Leveling | `/rank`, `/leaderboard`, `/setlevelchannel` |
| Luffy | Card game | `/play`, `/hand`, `/score`, `/deck`, `/inventory` |
| Niko Robin | Search | `/search` |
| Cyrene | AI assistant | `/ask`, `/reset`, `/cyrene` |

## Repository Layout

```text
bots/                         Independent Discord bot applications
  boahancock/                 Welcome and leave messages
  cyrene/                     AI assistant
  luffy/                      Card game
  nami/                       XP and leveling
  niko-robin/                 Search
  sanji/                      Event logging
  shanks/                     Moderation
  zoro/                       Antinuke and security
dashboard/                    Next.js 15 control plane
infra/supabase/schema.sql     Supabase tables, RLS, triggers, nonce storage
infra/mongo/init.js           MongoDB collections, indexes, TTL, validators
packages/shared/              Shared runtime, database clients, security code
scripts/                      Operational retention and quota utilities
```

## Local Development

### Requirements

- Node.js 22 or newer
- npm 10 or newer
- A Discord application and bot token for the service being run
- Supabase, MongoDB, and Redis credentials for live mode

### Install

```bash
npm install
```

Copy the examples into local-only environment files. Never commit `.env`, `.env.local`, or credentials copied from a deployment platform.

```powershell
Copy-Item .env.example .env
Copy-Item dashboard\.env.example dashboard\.env.local
```

For a UI-only preview, set `DEMO_MODE=true` in `dashboard/.env.local`. Production does not enter demo mode implicitly.

### Initialize data stores

Run migrations with privileged credentials kept outside the application environment where possible:

```bash
psql "$SUPABASE_DB_URL" -f infra/supabase/schema.sql
mongosh "$MONGODB_URI" infra/mongo/init.js
```

The Supabase schema includes ownership RLS, protected user authority fields, and one-time request IDs for replay-resistant bot configuration sync. The Mongo bootstrap creates guild-scoped indexes, a 60-day log TTL, and rejecting validation for malformed log documents.

### Run the dashboard

```bash
npm run dev -w @eipoint/dashboard
```

Open `http://localhost:3000`. The production dashboard requires HTTPS canonical origins and explicit authentication configuration.

### Run a bot

```bash
npm run dev -w @eiflow/bot-shanks
npm run dev -w @eiflow/bot-sanji
npm run dev -w @eiflow/bot-zoro
```

Each bot uses the shared environment contract in `packages/shared/src/env.ts`. Use the matching bot workspace for the service you want to start.

## Environment Security

### Server-only values

Keep these in deployment secret storage and never prefix them with `NEXT_PUBLIC_`:

- Discord bot tokens
- Supabase service-role keys
- MongoDB connection strings
- Redis REST tokens
- Provider API keys
- Sentry DSNs where operational privacy requires it
- HMAC secrets
- `HEALTH_TOKEN`

### HMAC configuration

Production uses unique per-bot secrets through `HMAC_SECRETS_JSON`. Values must be strong, unique secrets for the complete bot roster. The internal configuration endpoint additionally requires:

- Valid JSON content type
- A bounded request body
- A timestamped HMAC signature
- A unique request ID
- A positively authorized guild
- A recognized bot ID

The legacy single `HMAC_SECRET` is retained for local development only.

### Health endpoint

`GET /health` preserves a useful `200` or `503` monitoring status while returning only `{ "status": "ok" }` or `{ "status": "degraded" }` publicly. Detailed dependency, queue, memory, and quota diagnostics require:

```http
Authorization: Bearer <HEALTH_TOKEN>
```

Responses are cached briefly to prevent unauthenticated probes from repeatedly triggering backend checks.

## Security Model

- Every sensitive Discord command checks permissions at execution time.
- Guild authorization fails closed when Supabase cannot provide a positive decision.
- Existing guilds are reconciled at startup and periodically; revoked guilds are left.
- Background Discord event handlers enforce the same guild authorization boundary as commands.
- User-facing dashboard queries use cookie-backed Supabase clients and RLS.
- Service-role Supabase access is isolated to the signed internal configuration route.
- OAuth redirects are constrained to safe internal paths and HTTPS production origins.
- MongoDB connections require TLS.
- Shared rate limiting fails closed when distributed protection is unavailable.
- Queue timeouts do not release concurrency slots until underlying work settles.
- Logs redact authorization headers, tokens, URIs, API keys, and service credentials.
- React output uses framework escaping; no arbitrary HTML rendering is used for user data.

## Validation

Run the complete local verification suite before opening a pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run build -w @eipoint/dashboard
npm audit
```

The shared package contains regression tests for HMAC freshness and tamper detection, fail-closed rate limiting, queue timeout accounting, and encrypted MongoDB transport validation.

## Deployment Notes

- Deploy bots independently so one process failure does not take down the fleet.
- Require Redis for horizontally scaled deployments; the local fallback is process-scoped.
- Apply the Supabase schema before enabling production bot synchronization.
- Configure a protected deployment environment for retention jobs using least-privilege credentials.
- Restrict detailed health diagnostics to trusted monitoring infrastructure.
- Do not expose development servers, Vitest UI, or Vite dev endpoints to untrusted networks.
- Rotate all credentials if deployment history or external logs may have exposed them.

## Current Security Status

The repository has application-level authorization, replay protection, fail-closed behavior, and security regression coverage. Before production launch, complete the dependency upgrade review for the remaining nested Next/PostCSS advisory, apply and verify the live Supabase migration, and validate ingress/TLS/runtime secret configuration in staging.

## License

This repository is private software. Add the project license before publishing it publicly.
