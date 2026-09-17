# EI-point — Work Queue for Luna (GPT-5.6)

> Handoff note for the next model session. Derived from the master directive's
> model-role roster and the verified repository state on 2026-09-16.
> Luna's declared role: frontend/dashboard refinement, UI/UX, targeted
> debugging, release review, and independent verification.
> No secrets in this file.

## Role boundary

Luna should pick tasks that match the roster above. Out of scope for Luna:
- The filesystem-driven Luffy card registry implementation is now complete
  locally. Luna may review its docs or UI-facing behavior, but should not alter
  registry/security semantics without explicit reassignment.
- Operator-only infrastructure actions (Atlas resume, Vercel token deletion,
  Upstash capacity decision, Supabase migration 0002 application).
- Any change to security gates, auth flows, HMAC, or RLS policy semantics.

## Task 1 — Dashboard UI/UX refinement pass

Files: `dashboard/components/auth/SignInPanel.tsx`,
`dashboard/components/dashboard/DashboardShell.tsx`,
`dashboard/components/dashboard/ConfigForm.tsx`,
`dashboard/app/dashboard/page.tsx`, `dashboard/app/dashboard/layout.tsx`.

- Verify the master control panel and the normal-user view stay consistent
  after the OAuth/visibility hardening: same navigation shell, per-guild
  actions gated identically, no dead links for non-master users.
- Audit loading, empty, and error states on every dashboard route (guild list,
  config, logs, security). Every async surface needs a visible pending state
  and a recoverable error state.
- Confirm destructive or sensitive actions (config save, secret reveal, sign
  out) have explicit confirmation or same-origin protections in the UI layer.
- Check responsive behavior down to mobile widths; the shell must remain
  navigable and config forms usable.

Acceptance: a written findings list with file/line references; UI fixes may be
implemented directly, but each must keep the existing authorization checks
intact (UI visibility is never treated as authorization).

## Task 2 — Real-browser verification of the deployed dashboard

Target: `https://ei-point-dashboard.vercel.app` (live).

- Clean login via Discord OAuth, callback, and session persistence.
- Master user: all authorized servers visible, master control panel present.
- Normal user: only servers with a verified relationship; unauthorized guild
  IDs return the indistinguishable 404 path.
- Logout, session expiry, and retry of a protected route after logout.

Acceptance: a short verification report (what was tested, observed result).
Note: views backed by MongoDB (logs, activity) will show degraded data until
the Atlas clusters are resumed — do not report that as a dashboard defect.

## Task 3 — Documentation sync

- `README.md`: verify framework and version claims against the actual
  lockfile/workspace (Next.js 16, Node 22+, React 18, discord.js 14,
  MongoDB 6, workspaces layout) and correct any drift.
- `docs/ai/`: cross-check PROJECT_STATE, SECURITY_STATE, TEST_STATE, and
  DEPLOYMENT_STATE claims against the code they describe; fix any stale
  statements (test counts, gate names, file paths).
- The directive expects doc names like `SECURITY.md`, `DATABASE.md`,
  `LUFFY_CARDS.md`; the actual files use `_STATE` suffixes. Either add
  thin index pages under the expected names that point at the real files, or
  document the mapping in `docs/ai/AI_HANDOFF.md` — do not duplicate content.

## Task 4 — Independent release review (read-only)

- Re-review the completed OAuth/authorization hardening (auth callback route,
  proxy, servers data layer) and the Luffy card game implementation for logic
  bugs, missing edge-case tests, or doc/implementation mismatches.
- Deliver findings as a prioritized list (severity + file:line). Fixing is
  allowed only for clear, low-risk defects; anything touching authorization,
  economy atomicity, or the in-flight registry design must be reported, not
  patched.

## Standing constraints (all tasks)

- Never read, print, or commit `temp cred.txt`; never hardcode IDs or secrets.
- No commits or pushes without explicit operator authorization.
- Do not weaken or bypass any security gate to make a task easier.
- Prefer reversible changes; update `docs/ai/LUNA_TASKS.md` statuses when a
  task is completed so the next session sees current state.
