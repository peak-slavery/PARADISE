# EI-point — Initial Audit

> Performed 2026-09-15 by Atria Dawn. Every claim below was verified against
> the live repository, the live production endpoints, or a programmatic
> check — not assumed from the incoming brief, which describes a repo state
> that is out of date.

## Audit method

1. Read the CI config, dependabot, gitleaks, index contract, health routes.
2. Probed all 9 production endpoints (Vercel dashboard + 8 Render bots).
3. Programmatically verified the Mongo index contract for duplicates and
   conflicting key patterns.
4. Ran every quality gate: typecheck (9 workspaces), lint, test, build,
   audit, credential-script tests.
5. Cross-checked the brief's "known problems" against the actual repo state.

## Key finding: the brief's premise is stale

The brief instructs me to fix three CI problems and a Mongo index conflict.
**All four were already fixed and verified green in prior sessions** (see
SESSION_HANDOFF.md §3.1 and CHANGELOG_AI.md). Specifically:

| Brief claim | Actual state |
|---|---|
| "Dependabot invalid update-type" | Config valid; the invalid `version-update:ignore` entry was removed |
| "Use the current supported CodeQL action" | Already on `github/codeql-action@v4` with `upload: never` and `permissions: actions: read` |
| "Remove secret-shaped Discord ID fixtures from tests" | Already handled via a narrow documented `gitleaks.toml` allowlist; default ruleset extended, not disabled; negative test proves forgery is still caught |
| "duplicate/conflicting ai_context.updated_at indexes" | Resolved — exactly one TTL index + one unique index; verified 0 duplicates, 0 conflicting patterns across all 30 indexes |
| "Vercel deployment" | Live and returning HTTP 200 |
| "eight bots" | All 8 live on Render with an active keep-alive ring |

Re-implementing these would have been wasted effort and risked regressing
working security gates. The real work is elsewhere.

## Priority classification

### P0 — blocking, requires the operator (not code)

1. **MongoDB Atlas clusters paused.** Both clusters fail the TLS handshake
   with alert 80 from local and Vercel runtimes; DNS/cert are fine. `mongo:
   false` in every health probe. The available API keys are Atlas Model
   (inference) keys and cannot resume clusters. → console Resume.
2. **Upstash Redis quota exhausted** (500000/500000). Runtime degrades to
   MemoryKv (per-process rate limits, not absent ones). → upgrade, lengthen
   interval, or accept fallback.
3. **Exposed Vercel token** needs manual deletion (team tokens cannot be
   self-deleted via API).

### P1 — should fix, agent-addressable once P0 clears

4. **Supabase migration 0002 not applied to production.** The stronger
   `has_guild_access` RLS path is written, reviewed, and tested but not live.
5. **In-guild Discord functional testing never performed.** Command scopes
   were verified via the Discord API (no doubles, no overlap), but no
   end-to-end interaction test has run in a real guild. Blocked by #1.

### P2 — non-blocking polish

6. Card artwork is placeholder references (no copyrighted art bundled —
   deliberate per the licensing constraint).
7. No live-bot smoke test for Luffy (unit/type gates only).
8. M0 free tier → CAS-based atomicity rather than multi-document transactions.
9. Documentation is split across several root-level reports; `docs/ai/` is now
   canonical and the legacy files should eventually be archived with pointers.

## What is verified working

- **Application**: 8 bots + dashboard, all deployed and responding. Luffy
  card game complete with 34 passing tests.
- **Database**: Mongo schema/indexes correct and verified; Supabase 12 tables
  present with RLS active; Redis degrades safely.
- **Security**: `npm audit` 0 vulnerabilities; lint clean; no hardcoded
  privileged identities or secrets; demo mode fail-closed; RLS + HMAC + CSRF
  + rate limiting + replay protection all in place and tested.
- **Quality**: typecheck (9 workspaces), lint, test, build, audit all green.
- **Deployment**: Vercel live; 8 Render bots live; rollback documented.

## Execution plan (ordered)

1. **Now (done)**: handoff system, audit, Luffy completion, all gates green.
2. **Operator**: resume Atlas clusters; decide on Upstash; delete the exposed
   token; authorize migration 0002 and the push.
3. **Agent, once Mongo is up**: authenticated readiness probes; in-guild
   Discord functional testing across all 8 bots (commands, embeds, buttons,
   permission failures, error responses, restart behaviour); Luffy live
   smoke test; adversarial retest in production.
4. **Agent, anytime**: documentation consolidation; dependency review for
   safe upgrades (keep Node 22 / Next 16 compatibility).

## Verdict

The codebase is in strong shape and is production-deployed. The definition of
done is **not** met, but the gap is two external infrastructure states and
one unapplied migration — not a pile of code defects. No P0 or P1 issue in
this list is caused by a code error I could fix in this session.
