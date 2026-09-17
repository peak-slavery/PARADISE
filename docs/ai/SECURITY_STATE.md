# EI-point — Security State

> Verified posture. This file contains no secrets, tokens, keys, or
> connection strings — only presence/format assertions where relevant.

## Summary

No known critical or high-severity application vulnerabilities. The security
gates (`npm audit`, gitleaks, CodeQL, dependency-review) are all enabled and
green. No security scanner is disabled to make a check pass.

## Authentication & authorization

- **Dashboard login**: Discord OAuth via Supabase Auth. Provider enabled,
  correct client ID/secret and redirect URIs configured and verified against
  Discord's authorize endpoint.
- **Session**: cookie-backed, hardened, server-side. Provider tokens never
  reach the browser.
- **Guild visibility**: enforced by Supabase RLS per request. The Next.js
  layout check is defence in depth only — every page and route handler
  authorizes independently because layout and page render concurrently.
- **Master access**: resolved exclusively through the database
  `is_master_user()` predicate. **No hardcoded privileged Discord identity**
  exists in the codebase.
- **Fail-closed**: unauthorized guild IDs return an indistinguishable 404 so
  the response never discloses that another tenant's guild exists.
- **Bot admin**: `services.isOwner()` against `OWNER_IDS` — no privileged ID
  is hardcoded in any command file.

## Verified protections

| Area | Status | Notes |
|---|---|---|
| RLS | active, tested | `supabase-rls.test.ts` covers base + 0002 policies |
| HMAC | verified | Internal bot→dashboard secret fetch is HMAC-signed |
| CSRF | enabled | Same-origin sign-out; CSRF tokens preserved |
| CORS / origin | enforced | `site-origin.test.ts` |
| SSRF | mitigated | URL allowlists on outbound fetches |
| Rate limiting | active | Redis-backed; degrades to MemoryKv (never open) |
| Replay | mitigated | `internal_request_nonces` + HMAC freshness |
| Multi-tenant isolation | verified | RLS + per-request authorization |
| Secret redaction in logs | active | `AUDIT_SECRET_KEY` scrubber in `bot.ts` |
| Error disclosure | bounded | `renderFailure` maps to generic user messages |
| Command injection | n/a surface | No shell-out from user input |
| Path traversal | mitigated | Sanitized inputs; bounded strings |
| Dependency security | green | `npm audit --audit-level=high` → 0 |
| Supply chain | green | dependency-review-action on PRs |
| Bot token security | ok | Tokens only in vault/console, never in source |
| Discord permissions | verified | Command scopes checked via Discord API |

## Card-economy security (Luffy)

Adversarially tested. Every input from the Discord interaction is validated
server-side; no client-supplied value is ever trusted.

- **Forged IDs**: ownership is re-checked inside the atomic update filter, so
  passing another player's instance id fails the CAS.
- **Double-selling**: CAS on (instance_id, version, status, owner, guild) —
  the second seller's precondition no longer matches.
- **Trade races**: instance locking + trade version CAS; double-acceptance
  and stale-ownership are both rejected.
- **Negative/overflow currency**: integer-only berries, `safeAdd`/`safeSub`
  guards, `$gte` conditional debits.
- **Duplication**: unique indexes on instance_id and trade_id; supply caps
  enforced by `countDocuments` before issuance.
- **Command spam**: routed through the shared rate limiter, including buttons.

## Demo mode

`DEMO_MODE` is false in production. Demo fixtures are served only when
`hasConfiguredEnvironment()` finds zero backend credentials — so a
partially-configured internet-facing deploy fails closed rather than serving
fixtures.

## Secret management

- Credentials live only in the gitignored `temp cred.txt` (local) and in the
  Vercel/Render/Supabase consoles. PM2 never receives credential values.
- `NEXT_PUBLIC_*` vars are public-by-design only (Supabase URL/anon key, site
  URL). No service-role key, vault key, or HMAC secret is ever prefixed.
- gitleaks allowlist is narrow and documented: 8 public Discord application
  client IDs, 2 fixture IDs, 1 masked former operator value. The full default
  ruleset is extended (`useDefault = true`), never disabled. A negative test
  proved freshly-forged tokens are still caught.

## Open security items

1. **Exposed Vercel token** — needs manual operator revocation (KNOWN_ISSUES §3).
2. **Supabase migration 0002 unapplied** — the stronger `has_guild_access`
   RLS path is written and tested but not yet live (KNOWN_ISSUES §4).
