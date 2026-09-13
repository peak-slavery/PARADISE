# EI-point — Production Audit Report

**Repository:** `xyanncat/EI-point`  
**Branch audited:** `main`  
**Audit type:** Static repository/code/configuration audit  
**Audit date:** 2026-09-13  
**Overall deployment-readiness score:** **6.2 / 10**  
**Confidence:** High for findings directly visible in source/config; runtime/build findings remain unverified until CI and production-shaped tests are executed.

> This is an engineering audit, not a claim that every runtime path has been exercised. The repository contains a strong security architecture, but several concrete correctness, security, documentation, and deployment-readiness issues prevent me from calling the current `main` branch production-ready.

---

## 1. Executive scorecard

| Area | Score | Status | Main reason |
|---|---:|---|---|
| Architecture | 8.5/10 | Good | Strong separation of 8 bots, dashboard, shared runtime, and three data planes |
| Security design | 7.2/10 | Needs hardening | HMAC/RLS/fail-closed design is strong, but privileged identity is hardcoded |
| Authentication / authorization | 6.8/10 | Needs hardening | Good RLS structure, but master identity is not configuration-driven |
| Database design | 7.4/10 | Needs fixes | Good constraints/indexing, but Mongo bootstrap contains a conflicting index definition |
| Bot runtime | 7.0/10 | Needs verification | Strong shared primitives; full fleet behavior needs integration testing |
| Dashboard | 7.0/10 | Needs verification | Good security headers/session boundary; production fallback behavior needs tightening |
| Testing | 6.0/10 | Needs expansion | Security unit coverage exists, but production-shaped integration/E2E coverage is insufficient |
| CI/CD | 6.7/10 | Good baseline | Typecheck/lint/test/audit/build exist; security scanning and deployment gates should be strengthened |
| Dependency hygiene | 5.8/10 | Needs work | Current manifests/README are inconsistent and a dependency-update PR is closed/unmerged |
| Documentation | 6.3/10 | Stale/inconsistent | README says Next 15.5 while dashboard declares Next 16.3.4 |
| Observability / operations | 7.0/10 | Needs verification | Health/redaction/retention design is good; production monitoring and alerting need explicit gates |
| Deployment readiness | **6.2/10** | **Not ready** | Concrete Mongo bootstrap issue + privilege hardcoding + incomplete deployment validation |

---

# 2. Critical findings

## C-01 — Hardcoded master/privileged Discord identity

**Severity: CRITICAL**  
**Score loss: -0.8**

`infra/supabase/schema.sql` contains a security-definer master check that treats a literal Discord ID as a master user in addition to the database flag.

This creates a permanent privileged backdoor/identity dependency in the schema. Even if the intended ID belongs to the owner, production authorization should not depend on a magic constant embedded in a migration.

### Required fix

Remove the literal Discord ID from SQL.

Use one of:

1. `is_master` provisioned by a controlled migration/bootstrap process;
2. an environment/configured operator allowlist stored outside application source;
3. a dedicated `admin_users` table controlled only by a server-side provisioning path.

The preferred design is:

```text
Supabase Auth identity
        ↓
users.id
        ↓
admin_users / role assignment
        ↓
is_master_user()
```

No hardcoded Discord IDs.

---

## C-02 — MongoDB bootstrap defines the same `updated_at` index twice on `ai_context`

**Severity: HIGH / DEPLOYMENT BLOCKER**  
**Score loss: -0.7**

`infra/mongo/init.js` creates:

```js
db.ai_context.createIndex({ updated_at: 1 }, { name: 'ai_ctx_updated' });
```

and then:

```js
db.ai_context.createIndex(
  { updated_at: 1 },
  { name: 'ai_ctx_ttl', expireAfterSeconds: 60 * 60 * 24 * 30 }
);
```

These have the same index key pattern but different options. MongoDB index creation can reject the second specification as a conflicting/equivalent index definition.

### Required fix

Use one TTL index:

```js
db.ai_context.createIndex(
  { updated_at: 1 },
  {
    name: 'ai_ctx_ttl',
    expireAfterSeconds: 60 * 60 * 24 * 30
  }
);
```

If a non-TTL lookup index is required, choose a different key pattern that provides actual query value.

Also make `ensureIndexes()` and `infra/mongo/init.js` share one canonical index definition so they cannot drift.

---

## C-03 — Mongo index bootstrap failure is explicitly allowed to continue

**Severity: HIGH**  
**Score loss: -0.5**

`packages/shared/src/db/mongo.ts` catches index bootstrap failure and continues:

```text
mongodb index bootstrap failed — continuing with an unindexed database
```

For this application, silently accepting an unindexed database is unsafe operational behavior.

The system contains:

- high-volume logs,
- guild-scoped queries,
- XP leaderboards,
- AI context,
- TTL retention.

If indexes fail, the service should not silently enter an unbounded/degraded database mode.

### Required fix

For production:

```text
connect Mongo
   ↓
ensure canonical indexes
   ↓
verify required indexes
   ↓
ONLY THEN mark Mongo ready
```

If index bootstrap fails:

- fail readiness;
- keep liveness available if desired;
- do not advertise the database as healthy;
- emit a structured critical alert;
- optionally retry with bounded backoff.

---

# 3. High-severity correctness/deployment findings

## H-01 — README and package configuration disagree about Next.js

**Severity: HIGH**  
**Score loss: -0.4**

The README describes the project as using Next.js 15.5 and discusses a remaining nested PostCSS advisory requiring Next.js 16.

The actual dashboard manifest declares:

```json
"next": "^16.3.4"
```

This means the deployment/security documentation is stale.

### Required fix

Update the README to reflect the actual locked dependency versions and remove the obsolete Next-15/PostCSS migration warning if the current lockfile confirms the issue is resolved.

Do not use README dependency statements as security evidence; derive them from the lockfile.

---

## H-02 — Production can partially fall back to demo fixtures

**Severity: HIGH**  
**Score loss: -0.5**

The dashboard intentionally supports demo fixtures when individual credentials are missing.

`dashboard/lib/demo.ts` defines:

```text
demo = !supabase || !mongo
```

and Mongo accessors return `null` when Mongo is absent so callers can use fixtures.

The dashboard proxy has a strong production guard for missing Supabase configuration, but the architecture still permits a production deployment to have Supabase configured while Mongo is absent.

That creates a dangerous class of failure:

```text
production dashboard
   + valid Supabase
   + missing Mongo
        ↓
some screens can display fixture data
```

A production dashboard must never present synthetic data as live operational data.

### Required fix

Make demo mode explicit:

```text
DEMO_MODE=true
```

must be the only condition that permits fixtures.

In production:

```text
NODE_ENV=production
AND DEMO_MODE != true
AND any required backend missing
        ↓
FAIL / 503
```

Do not infer demo mode from missing credentials.

---

## H-03 — Deployment validation is not strong enough for a nine-service production fleet

**Severity: HIGH**  
**Score loss: -0.4**

The repository has eight bots plus the dashboard, but the deployment gate is primarily static:

- typecheck
- lint
- tests
- npm audit
- dashboard build

The full production-shaped path needs explicit verification for:

- all 8 bot processes starting;
- all 8 Discord clients authenticating;
- health endpoints;
- Supabase connectivity;
- Mongo connectivity + index readiness;
- Redis connectivity;
- HMAC bot → dashboard synchronization;
- RLS ownership;
- guild authorization/revocation;
- command registration;
- graceful shutdown;
- queue saturation/timeouts;
- retention jobs.

### Required fix

Add a `production-smoke` stage that runs against isolated test infrastructure and verifies every service contract.

---

# 4. Medium-severity findings

## M-01 — Security scanning should be first-class CI

**Severity: MEDIUM**  
**Score loss: -0.3**

The CI workflow has:

- typecheck
- lint
- tests
- npm audit
- dashboard build

but does not visibly establish CodeQL/SAST, dependency review, or secret push protection as mandatory repository gates.

GitHub recommends code scanning for vulnerabilities/errors, dependency review for dependency changes, and secret scanning/push protection for credentials. citeturn0search0turn0search1turn0search4

### Required fix

Add:

- CodeQL
- dependency review
- Dependabot
- secret scanning/push protection where available
- lockfile integrity checks

For a private repository, verify which GitHub Code Security features are enabled for the account/organization.

---

## M-02 — No explicit deployment artifact/release contract

**Severity: MEDIUM**  
**Score loss: -0.2**

The repository describes independent bot deployment but does not establish a single canonical release process covering:

```text
commit
→ CI
→ artifact/version
→ environment promotion
→ database migration
→ bot deployment
→ dashboard deployment
→ smoke test
→ rollback
```

### Required fix

Document and automate this lifecycle.

---

## M-03 — Shared schema/migration drift risk

**Severity: MEDIUM**  
**Score loss: -0.2**

The repository contains substantial Supabase SQL and separate Mongo bootstrap logic, while application runtime code also creates Mongo indexes.

That gives multiple sources of truth.

### Required fix

Create:

```text
infra/
  supabase/
    migrations/
  mongo/
    indexes.js
```

and import/use those definitions from bootstrap code where practical.

---

## M-04 — Secrets policy is strong in design but requires automated enforcement

**Severity: MEDIUM**  
**Score loss: -0.2**

The project correctly documents that tokens, service-role keys, Redis credentials, HMAC secrets and vault keys must remain server-side.

The environment example also separates public and server-only values.

However, production readiness requires automated enforcement rather than documentation alone.

### Required fix

Add CI secret scanning and a pre-push/pre-commit or server-side push protection mechanism.

GitHub secret scanning is designed to detect credentials in repository history and should be paired with immediate rotation if a real credential is exposed. citeturn0search2

---

## M-05 — No formal backup/restore acceptance test

**Severity: MEDIUM**  
**Score loss: -0.2**

The architecture contains retention/archival logic, but production readiness requires proving:

- Supabase backup/restore procedure;
- Mongo export/restore;
- Redis loss recovery;
- guild configuration recovery;
- secret-vault recovery;
- incident recovery after corrupted configuration.

### Required fix

Run a scheduled restore drill.

---

# 5. Lower-severity findings / lost points

## L-01 — Documentation drift

README and actual package state are not synchronized.

**Loss: -0.15**

## L-02 — Demo data is extensive and realistic

Useful for UI development, but the project must make it impossible to mistake fixtures for production data.

**Loss: -0.15**

## L-03 — Dependency update PR is closed/unmerged

PR #1 contains a broad dependency upgrade involving TypeScript, ESLint, Vitest, MongoDB, React, Tailwind, Supabase SSR, and other packages. It was closed without merging.

Do not blindly merge a large all-at-once upgrade. Split it into compatibility-tested groups.

**Loss: -0.10**

---

# 6. Architecture strengths

These should be preserved.

### Strong security boundaries

- HMAC-signed internal bot → dashboard requests.
- Timestamp freshness.
- Request IDs/replay protection.
- Timing-safe signature verification.
- Raw-body signing.
- Request-body size limits.
- Per-bot secrets.
- Fail-closed guild authorization.
- RLS for browser-facing data.
- Service-role isolation.
- HTTPS production origin requirement.
- TLS-enforced Mongo.
- Queue timeout accounting.
- Log redaction.

The internal config route also validates the bot ID, guild ID, request ID, content type, body size and configuration fields before writing.

### Strong database separation

The Supabase/Mongo/Redis split is architecturally reasonable:

```text
Supabase → identity / ownership / authority / security records
MongoDB  → high-volume activity state
Redis    → rate limits / counters / caches
```

### Good service isolation

Eight bots have separate workspaces and deployment lifecycles. That is appropriate for failure isolation.

---

# 7. Testing gaps that must be closed

The following test categories should be mandatory before release.

## Authentication

- OAuth callback success/failure.
- Session refresh.
- Expired session.
- Invalid session.
- Unauthorized dashboard route.
- Cross-origin unsafe request.
- Missing Origin.
- malformed Origin.

## Authorization

- Owner can access own guild.
- Owner cannot access another guild.
- Master can access permitted control-plane operations.
- Ordinary user cannot invoke master operations.
- Revoked guild becomes inaccessible.
- Unauthorized guild causes bot leave.

## HMAC

- valid request;
- wrong signature;
- wrong timestamp;
- expired timestamp;
- future timestamp;
- duplicate request ID;
- malformed request ID;
- unknown bot ID;
- wrong bot secret;
- body tampering;
- body over 64 KiB.

## Database

- Mongo TLS;
- Mongo index bootstrap;
- Mongo unavailable;
- Redis unavailable;
- Supabase unavailable;
- RLS;
- retention;
- restore.

## Discord

For every bot:

- startup;
- command registration;
- command authorization;
- guild authorization;
- shutdown;
- reconnect;
- API failure;
- rate-limit handling.

## Antinuke

This requires dedicated adversarial integration tests:

- mass bans;
- mass kicks;
- channel deletion;
- channel creation;
- role deletion;
- role creation;
- webhook creation;
- permission escalation;
- whitelist bypass;
- false positives;
- concurrent events;
- Redis loss;
- bot restart during incident.

---

# 8. Release blockers

Do NOT call the repository production-ready until all of these are true:

- [ ] C-01 fixed: remove hardcoded master identity.
- [ ] C-02 fixed: canonical Mongo TTL indexes.
- [ ] C-03 fixed: Mongo index failure cannot silently produce an unhealthy production service.
- [ ] H-01 fixed: README/version documentation synchronized.
- [ ] H-02 fixed: demo fixtures impossible in production unless explicitly enabled.
- [ ] H-03 fixed: full production smoke test.
- [ ] M-01 implemented: security scanning gates.
- [ ] All 8 bots start and pass health checks.
- [ ] Dashboard deploys successfully.
- [ ] Supabase migrations apply cleanly to an empty database.
- [ ] Supabase migrations apply cleanly to an existing test database.
- [ ] Mongo bootstrap succeeds on an empty database.
- [ ] Mongo bootstrap succeeds on a previously initialized database.
- [ ] Redis failure behavior is tested.
- [ ] HMAC replay protection is integration-tested.
- [ ] RLS is tested with at least two separate identities.
- [ ] Secret rotation is tested.
- [ ] Backup/restore drill succeeds.
- [ ] Rollback procedure is tested.

---

# 9. Final score after fixes

If the above blockers are addressed and the complete production smoke/E2E suite passes:

| Area | Target |
|---|---:|
| Architecture | 9.0 |
| Security | 9.2 |
| Authorization | 9.2 |
| Database | 9.0 |
| Bot runtime | 9.0 |
| Dashboard | 8.8 |
| Testing | 9.0 |
| CI/CD | 9.0 |
| Dependency hygiene | 8.8 |
| Documentation | 9.0 |
| Operations | 9.0 |
| **Overall** | **~9.0/10** |

**Current conclusion:** strong architecture, but **not production-ready yet**. The project is much closer to a hardening/integration phase than a rewrite. The most important immediate issues are the privileged identity hardcoding, Mongo index bootstrap conflict, and prevention of production demo-data fallback.

---

# 10. Audit evidence

Primary repository evidence reviewed:

- root `package.json`
- `README.md`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `dashboard/package.json`
- `dashboard/.env.vercel.example`
- `dashboard/proxy.ts`
- `dashboard/next.config.mjs`
- `dashboard/lib/demo.ts`
- `dashboard/lib/mongo.ts`
- `dashboard/app/api/internal/config/route.ts`
- `infra/supabase/schema.sql`
- `infra/mongo/init.js`
- `packages/shared/src/db/mongo.ts`
- GitHub issue/PR #1

The repository currently reports **private**, default branch `main`, and GitHub-reported size of approximately **946 KB** at audit time.

---

# 11. Recommended remediation order

```text
P0
├── Remove hardcoded master identity
├── Fix Mongo ai_context indexes
├── Make Mongo index failure fail readiness
└── Disable production fixture fallback

P1
├── Add production smoke environment
├── Add CodeQL/dependency/secret gates
├── Test all 8 bots
├── Test HMAC end-to-end
├── Test RLS with multiple identities
└── Test antinuke adversarial scenarios

P2
├── Canonicalize database migrations/index definitions
├── Synchronize README/dependency documentation
├── Add backup/restore drill
├── Define release/rollback process
└── Split dependency upgrades

P3
├── Improve observability
├── Add performance/load tests
├── Add chaos/failure tests
└── Final production security review
```
