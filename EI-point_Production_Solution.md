# EI-point — Production Readiness & Deployment Solution

**Purpose:** Turn the current `main` branch into a production-ready deployment.

This document is intentionally written as an execution plan for an AI coding agent or developer. Follow the phases in order. Do not skip release gates.

---

# 0. Definition of done

EI-point is **deployment-ready only when all** of the following are true:

- [ ] TypeScript passes for root/shared/dashboard/all 8 bots.
- [ ] ESLint passes with zero warnings.
- [ ] Unit/security tests pass.
- [ ] Dashboard production build passes.
- [ ] `npm audit --audit-level=high` passes or every exception is explicitly documented and accepted.
- [ ] Supabase schema/migrations apply cleanly to a fresh database.
- [ ] Supabase schema/migrations apply cleanly to an existing test database.
- [ ] Mongo initialization is idempotent.
- [ ] Mongo required indexes are verified before readiness.
- [ ] Redis failure behavior is tested.
- [ ] HMAC request authentication passes positive and negative tests.
- [ ] RLS is tested with at least two identities.
- [ ] No production request can return demo fixtures unless an explicit non-production demo flag is enabled.
- [ ] All 8 bots start, authenticate, expose health status, and remain stable.
- [ ] Dashboard deploys successfully.
- [ ] Discord command registration succeeds.
- [ ] Unauthorized guild behavior is verified.
- [ ] Antinuke adversarial tests pass.
- [ ] Backup/restore procedure has been exercised.
- [ ] Rollback procedure has been exercised.
- [ ] Security scanning is enabled.
- [ ] No real secrets exist in Git history or current source.
- [ ] Production environment variables are documented and validated.
- [ ] Monitoring and alerting are configured.
- [ ] Final production smoke test passes.

---

# 1. P0 — Remove the privileged identity hardcode

## Problem

`infra/supabase/schema.sql` contains a literal Discord ID in `is_master_user()`.

This must not exist in production authorization logic.

## Solution

Replace the literal identity check with database role state.

Recommended model:

```sql
create table if not exists public.admin_users (
  user_id uuid primary key references public.users(id) on delete cascade,
  role text not null check (role in ('master', 'operator', 'support')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

alter table public.admin_users enable row level security;
```

Then:

```sql
create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.role = 'master'
  );
$$;
```

Do not allow the browser role to insert/update `admin_users`.

Provision the first master through a controlled server-side bootstrap script or migration executed with privileged credentials.

## Acceptance

- Searching the repository for the old Discord ID returns zero application/schema matches.
- Normal authenticated users cannot grant themselves `master`.
- Master access works after bootstrap.
- Removing the master row immediately removes master privileges.

---

# 2. P0 — Fix MongoDB `ai_context` index bootstrap

## Problem

`infra/mongo/init.js` currently creates two indexes with the same key:

```js
{ updated_at: 1 }
```

One is ordinary and one is TTL.

## Solution

Keep only:

```js
db.ai_context.createIndex(
  { updated_at: 1 },
  {
    name: 'ai_ctx_ttl',
    expireAfterSeconds: 60 * 60 * 24 * 30
  }
);
```

Do not create `ai_ctx_updated` unless a genuinely different index pattern is required.

The runtime bootstrap in:

```text
packages/shared/src/db/mongo.ts
```

must use the exact same canonical index definitions.

## Better architecture

Create:

```text
packages/shared/src/db/mongo-indexes.ts
```

with a canonical definition list.

Use that definition from runtime bootstrap.

Keep `infra/mongo/init.js` synchronized with it.

## Acceptance

Run against:

1. empty Mongo database;
2. already initialized Mongo database;
3. partially initialized database.

All three must finish without index conflicts.

---

# 3. P0 — Mongo index failure must fail readiness

## Current problem

`ensureIndexes()` catches errors and continues.

That can leave the application running against an unindexed database.

## Solution

Change the lifecycle to:

```text
Mongo connect
    ↓
create/verify required indexes
    ↓
verify TTL indexes
    ↓
Mongo READY
```

If index setup fails:

```text
Mongo NOT READY
```

The service may remain alive for diagnostics, but health/readiness must report failure.

Do not silently continue as healthy.

## Required verification

Verify:

- `logs_guild_created`
- logs TTL
- XP unique guild/user
- card game unique guild/user
- inventory unique guild/user
- AI context unique guild/user/scope
- AI context TTL

---

# 4. P0 — Eliminate implicit production demo mode

## Problem

Demo fixtures are useful for local UI development but must never appear in production because one backend is missing.

## Required rule

Only this should enable fixtures:

```env
DEMO_MODE=true
```

And:

```text
NODE_ENV=production
→ DEMO_MODE must be false
```

## Production startup validation

Create:

```text
packages/shared/src/production-env.ts
```

or equivalent.

Required production variables should be validated before the service reports ready.

At minimum:

### Dashboard

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
MONGODB_URI
MONGODB_DB
SECRET_VAULT_MASTER_KEY
SECRET_VAULT_SALT
HMAC_SECRETS_JSON
NEXT_PUBLIC_SITE_URL
DASHBOARD_URL
DEMO_MODE=false
```

### Bots

Validate each bot's:

```text
DISCORD_TOKEN
BOT_ID
DASHBOARD_URL
HMAC secret
Supabase service credentials
Mongo/Redis credentials where required
```

## Acceptance

If Mongo is missing in production:

```text
503 / not ready
```

not demo logs.

---

# 5. P1 — Add production environment validation

Create a typed environment contract.

Recommended approach:

```text
environment
→ parse
→ validate
→ normalize
→ expose typed Env
```

Reject:

- empty secrets;
- weak HMAC secrets;
- non-HTTPS production URLs;
- insecure Mongo URLs;
- missing bot-specific secrets;
- duplicate HMAC secrets;
- invalid Discord IDs;
- invalid Redis configuration.

Do not log the values.

Log only:

```text
environment validation failed:
- MONGODB_URI missing
- HMAC_SECRETS_JSON missing
```

Never log credential contents.

---

# 6. P1 — Strengthen HMAC contract

The existing HMAC design is good. Keep:

- raw-body signing;
- timestamp;
- timing-safe comparison;
- request ID;
- replay protection;
- per-bot secrets;
- maximum body size.

Add explicit negative tests for:

```text
wrong secret
wrong bot
wrong guild
wrong timestamp
expired timestamp
future timestamp
duplicate request_id
tampered body
malformed signature
missing signature
missing timestamp
oversized body
unknown bot
invalid guild
```

## Secret policy

Production:

```text
HMAC_SECRETS_JSON
```

must contain exactly one unique strong secret for every bot.

Never reuse one secret across all bots.

---

# 7. P1 — Harden Supabase RLS

Verify every dashboard-facing table.

For each table answer:

```text
Can anon SELECT?
Can anon INSERT?
Can anon UPDATE?
Can anon DELETE?
Can authenticated user SELECT?
Can authenticated user modify?
Can owner access another guild?
Can master access it?
Can service_role access it?
```

Expected principle:

```text
anon:
  no privileged access

authenticated:
  own identity + owned guilds only

master:
  explicitly provisioned privileged access

service_role:
  server-only
```

Add tests for cross-guild access.

---

# 8. P1 — Add database migration discipline

Do not rely on one giant mutable schema file forever.

Move toward:

```text
infra/
  supabase/
    migrations/
      0001_extensions.sql
      0002_users.sql
      0003_servers.sql
      0004_bot_configs.sql
      0005_security.sql
      0006_admin_roles.sql
      ...
```

Keep migration execution deterministic.

Never make production depend on manually pasting SQL.

---

# 9. P1 — Add CodeQL and dependency security

Add GitHub CodeQL to CI.

Minimum security pipeline:

```text
push / PR
  ├── typecheck
  ├── lint
  ├── unit tests
  ├── dashboard build
  ├── npm audit
  ├── CodeQL
  ├── dependency review
  └── secret scanning/push protection where available
```

GitHub recommends code scanning to detect vulnerabilities and coding errors, dependency review to identify vulnerable dependency changes, and secret scanning/push protection to prevent credential exposure. citeturn0search0turn0search1turn0search4

For private repositories, verify which GitHub Code Security features are available under the current repository/account plan.

---

# 10. P1 — Add full production smoke tests

Create:

```text
scripts/production-smoke.mjs
```

The smoke suite must test:

## Dashboard

- HTTP 200 on public route.
- `/dashboard` redirects unauthenticated user.
- login flow starts.
- protected route rejects unauthenticated access.
- security headers exist.
- HTTPS origin is correct.

## Supabase

- service connection.
- normal user.
- owner.
- master.
- RLS isolation.

## Mongo

- connection.
- indexes.
- TTL.
- guild-scoped read/write.
- failure behavior.

## Redis

- connection.
- rate-limit write/read.
- expiry.
- failure behavior.

## HMAC

- signed configuration request.
- replay rejected.
- modified body rejected.
- wrong bot rejected.

## Bots

For each of:

```text
shanks
sanji
zoro
boahancock
nami
luffy
niko-robin
cyrene
```

verify:

```text
process starts
Discord authentication succeeds
health endpoint responds
configuration sync succeeds
shutdown is clean
```

---

# 11. P1 — Antinuke adversarial testing

Zoro is the highest-risk bot.

Create an isolated Discord test guild.

Test:

```text
mass ban
mass kick
mass channel deletion
mass role deletion
mass channel creation
mass role creation
webhook creation
permission escalation
unauthorized admin action
whitelisted user
whitelisted role
temporary whitelist expiration
guild revocation
Redis outage
duplicate Discord audit events
concurrent audit events
bot restart during incident
```

Verify:

```text
false positive rate
response latency
rollback correctness
duplicate-event handling
lockdown behavior
audit logging
```

Never perform destructive tests against a real production guild.

---

# 12. P1 — Discord permission model

Every sensitive command must verify permissions at execution time.

Required for:

```text
warn
mute
ban
purge
antinuke
lockdown
whitelist
configuration changes
secret operations
```

Do not rely exclusively on command registration permissions.

Also verify bot permissions before attempting destructive actions.

If the bot lacks the required Discord permission:

```text
return controlled error
log reason
do not partially execute
```

---

# 13. P1 — Queue and concurrency testing

For Cyrene and other expensive providers:

Test:

```text
0 concurrent
1 concurrent
normal load
queue full
provider timeout
provider rate limit
provider failure
Redis unavailable
bot restart during request
request cancellation
```

Required invariant:

> A timed-out request must not permanently consume a concurrency slot.

Verify this with an automated regression test.

---

# 14. P2 — Production deployment topology

Recommended deployment:

```text
                         ┌───────────────┐
                         │    Vercel     │
                         │   Dashboard   │
                         └───────┬───────┘
                                 │
                       HTTPS / Supabase
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
        Supabase              MongoDB              Redis
         Auth/RLS             Atlas                Upstash
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                      Signed internal API
                                 │
        ┌────────┬────────┬──────┼──────┬────────┬────────┐
        │ Shanks │ Sanji  │ Zoro │ Boa  │ Nami   │ Luffy  │
        │        │        │      │       │        │        │
        │        │        │      │       │        │        │
        └────────┴────────┴──────┴───────┴────────┴────────┘
                         │
                  Niko Robin / Cyrene
```

Bots should be deployed independently.

A bot crash must not take down the dashboard or other bots.

---

# 15. P2 — Process supervision

For VPS/container deployments:

Use one process/service per bot.

Recommended:

```text
eipoint-dashboard
eipoint-shanks
eipoint-sanji
eipoint-zoro
eipoint-boahancock
eipoint-nami
eipoint-luffy
eipoint-niko-robin
eipoint-cyrene
```

Set:

- automatic restart;
- memory limits;
- graceful shutdown;
- log rotation;
- health checks;
- startup timeout;
- restart backoff.

Do not expose internal health endpoints publicly unless deliberately protected.

---

# 16. P2 — Vercel dashboard deployment

Configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
MONGODB_URI
MONGODB_DB
SECRET_VAULT_MASTER_KEY
SECRET_VAULT_SALT
HMAC_SECRETS_JSON
NEXT_PUBLIC_SITE_URL
DASHBOARD_URL
DEV_GUILD_ID
MAIN_GUILD_ID
DEV_AUTH_CHANNEL_ID
DEMO_MODE=false
```

Use Vercel environment scopes deliberately:

```text
Preview
Development
Production
```

Do not copy production credentials into preview unless required.

Use separate Supabase/Mongo/Redis credentials for staging where practical.

---

# 17. P2 — Secret management

Production secrets must live in:

```text
Vercel Environment Variables
VPS secret manager
container secret store
GitHub Actions secrets
```

Never in:

```text
.env committed to Git
README
source
PM2 ecosystem files
Docker image layers
CI logs
```

Rotate immediately if exposure is suspected.

GitHub's secret-scanning guidance recommends rotating leaked credentials rather than relying only on removing them from Git history. citeturn0search2

---

# 18. P2 — Logging policy

Production logs must contain:

```text
timestamp
service
bot
guild_id where appropriate
request_id
event/action
latency
status
error class
```

Never log:

```text
Discord tokens
Supabase service-role key
Mongo URI
Redis tokens
HMAC secrets
vault master key
provider API keys
Authorization headers
session cookies
raw sensitive AI prompts
```

Use structured redaction before transport.

---

# 19. P2 — Monitoring

Create alerts for:

```text
bot offline
dashboard 5xx spike
Mongo unavailable
Redis unavailable
Supabase unavailable
HMAC failures spike
unauthorized guild attempts
antinuke incidents
queue saturation
provider failures
high latency
memory threshold
restart loop
retention failure
backup failure
```

Recommended health model:

```text
/liveness
/readiness
/api/health
```

Public health output should remain minimal.

Detailed diagnostics require a trusted health token or internal network.

---

# 20. P2 — Backup and restore

Document:

## Supabase

- backup source;
- restore destination;
- RLS verification after restore;
- identity verification.

## Mongo

- export;
- restore;
- index recreation;
- TTL verification.

## Redis

Treat Redis as reconstructable state where possible.

Do not make Redis the sole source of durable authority.

## Secrets

Back up secret metadata and maintain a documented re-provisioning procedure for master secrets.

---

# 21. P2 — Dependency update strategy

Do not merge the closed all-dependency upgrade as one giant change.

Split into:

### Group A

Patch/minor security updates.

### Group B

MongoDB.

### Group C

Supabase.

### Group D

React/Next.

### Group E

ESLint/TypeScript.

### Group F

Tailwind.

After every group:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build -w @eipoint/dashboard
npm audit --audit-level=high
```

Then run the production smoke suite.

---

# 22. Fix documentation drift

The README must reflect actual installed versions.

Specifically verify:

```text
Node
npm
Next.js
React
Discord.js
Supabase
MongoDB driver
Redis client
TypeScript
ESLint
Vitest
Tailwind
```

Do not document a vulnerability as unresolved if the actual lockfile has already moved to a fixed version.

---

# 23. Final CI gate

The final CI workflow should conceptually be:

```yaml
validate:
  typecheck:
  lint:
  unit-tests:
  dashboard-build:
  dependency-audit:
  codeql:
  dependency-review:
  secret-scan:

integration:
  supabase:
  mongo:
  redis:
  hmac:
  authz:
  bot-contracts:

production-smoke:
  depends-on:
    - validate
    - integration

release:
  depends-on:
    - production-smoke
```

No deployment when a required job fails.

---

# 24. Release sequence

Use this exact order:

```text
1. Create staging infrastructure
2. Apply Supabase migrations
3. Initialize Mongo
4. Verify Mongo indexes
5. Initialize Redis
6. Configure staging secrets
7. Deploy dashboard
8. Deploy bots
9. Register Discord commands
10. Run authentication tests
11. Run RLS tests
12. Run HMAC tests
13. Run bot health tests
14. Run antinuke adversarial tests
15. Run load/concurrency tests
16. Run production smoke suite
17. Backup staging configuration
18. Approve release
19. Deploy production dashboard
20. Deploy production bots
21. Register production commands
22. Run production smoke
23. Enable monitoring
24. Announce release
```

---

# 25. Rollback sequence

If production smoke fails:

```text
1. Stop rollout
2. Keep failed deployment isolated
3. Inspect health/readiness
4. Roll dashboard back if dashboard is the failure
5. Roll individual bot back if bot-specific
6. Do NOT blindly roll database migrations backward
7. Restore database only when data corruption occurred
8. Rotate credentials if security compromise is suspected
9. Re-run smoke tests
10. Record incident
```

Database migrations must be designed as forward-compatible whenever possible.

---

# 26. Final acceptance matrix

| Gate | Required |
|---|---|
| Typecheck | PASS |
| ESLint | PASS |
| Unit tests | PASS |
| Dashboard build | PASS |
| npm audit | PASS / approved exception |
| CodeQL | PASS |
| Dependency review | PASS |
| Secret scan | PASS |
| Supabase migration | PASS |
| Mongo bootstrap | PASS |
| Mongo indexes | PASS |
| Redis | PASS |
| HMAC | PASS |
| RLS | PASS |
| Auth | PASS |
| All 8 bots | PASS |
| Command registration | PASS |
| Antinuke | PASS |
| Queue/concurrency | PASS |
| Backup/restore | PASS |
| Dashboard deployment | PASS |
| Bot deployment | PASS |
| Monitoring | PASS |
| Rollback test | PASS |

---

# 27. Final production target

The target architecture is:

```text
                    PRODUCTION
                         │
             ┌───────────┴───────────┐
             │                       │
          Vercel                  Bot Fleet
             │                       │
       Dashboard/API       ┌─────────┴─────────┐
             │             │                   │
          Supabase       8 isolated         Discord
          Auth/RLS        services
             │             │
             ├─────────────┼──────────────┐
             │             │              │
          MongoDB        Redis        Provider APIs
             │             │              │
             └─────────────┴──────────────┘
                         │
                 Monitoring/Alerts
```

Security boundary:

```text
Browser
  ↓
Supabase session
  ↓
RLS / server authorization
  ↓
Dashboard

Bot
  ↓
HMAC + timestamp + request_id
  ↓
Internal route
  ↓
Supabase service-role operation
  ↓
Atomic nonce/replay check
```

---

# 28. Final instruction for the implementation agent

Do not attempt a broad rewrite.

Implement the work in this order:

```text
P0 security/correctness
↓
P0 database bootstrap
↓
P0 production/demo isolation
↓
P1 integration tests
↓
P1 security CI
↓
P1 bot smoke tests
↓
P2 deployment automation
↓
P2 observability
↓
P2 backup/rollback
↓
final audit
```

After every phase:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build -w @eipoint/dashboard
npm audit --audit-level=high
```

Then run the relevant integration/smoke suite.

**Do not declare EI-point production-ready based only on successful compilation. Production readiness requires security, database, Discord, deployment, failure-mode, and rollback validation.**

---

## Implementation status — 2026-09-13

Implemented and verified locally: security and database hardening, production/demo isolation, migration tooling, security CI, production smoke tooling, monitoring, restore/rollback drills, typecheck, lint, unit tests, dashboard production build, dependency audit (0 vulnerabilities), and the nine-service PM2 localhost smoke test.

External blockers remain: both Atlas clusters reject the TLS handshake before authentication (`tlsv1 alert internal error`), and the Cloudflare R2 API token is rejected. Reconfigure Atlas networking/cluster TLS and replace the R2 token, then rerun `npm run check:local` and `node scripts/validate-prod-creds.mjs`. Do not host production until all 16 credential checks pass.
