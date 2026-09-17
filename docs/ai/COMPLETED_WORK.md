# EI-point — Completed Work

> Verified completed work. No secrets.

## 2026-09-16 audit pass

- Audited repository structure, workspaces, CI, deployment checks, dashboard
  middleware, HMAC internal config, Mongo index bootstrap, Supabase RLS, and
  production demo-mode gates.
- Confirmed `npm run check:deploy` passes all 32 checks.
- Confirmed the internal config route uses bounded raw-body parsing, per-bot
  HMAC verification, timestamp freshness, constant-time comparison, strict
  request IDs, and an atomic Supabase nonce RPC.
- Confirmed Mongo index bootstrap failure does not return a usable Mongo handle.
- Confirmed production dashboard auth explicitly requires `DEMO_MODE=false` and
  required public auth configuration; production data paths require the full
  server-side environment.
- Confirmed tracked files contain no `temp cred.txt` or tracked environment
  secret file.
- Confirmed Luffy filesystem registry and full workspace validation:
  79/79 Luffy tests, scanner/manifest validation, workspace tests, typechecks,
  lint, dashboard build, and `npm audit --audit-level=high` with zero
  vulnerabilities.
- Created the required AI handoff artifacts in `docs/ai/`.

## 2026-09-16 hardening pass

- Fixed a silent-corruption gap in the Mongo restore drill: it verified only
  document counts, so a truncated or field-mangled restore reported success. It
  now verifies field-level parity, with 8 regression tests covering corrupted,
  truncated, reordered, injected, retyped, lost-field, and empty cases.
- Added the Luffy card smoke test (`npm run smoke:luffy`), covering manifest
  integrity, artwork containment, content hashes, the 100,000,000 weight total,
  Limited Arts at exactly 0.001%, runtime-catalog parity, and Mongo
  `card_definitions` parity when a database is reachable. Wired into CI and
  enforced by `check:deploy`.
- Made the smoke test fail closed when its TypeScript loader is missing
  (`LUFFY_SMOKE_REQUIRE_CATALOG=1` in CI), and pinned `tsx` at the repo root so
  the command no longer relies on workspace hoisting.
- Strengthened Supabase RLS tests from policy-name string matching to real
  security assertions (no browser writes to `guild_access`, self-scoped reads
  only, unrevoked-access requirement, no destructive migration SQL); proved
  non-vacuous by injecting a privilege-escalation policy and confirming failure.
- Fixed the local stack harness spurious dashboard-timeout failure and the
  mongosh `db`-shadowing bootstrap defect, and hardened the Supabase migration
  runner (contiguous sequence, baseline restriction, checksum-conflict abort,
  removed-migration drift detection, transactional ledger bootstrap).
- Consolidated four duplicated hardcoded bot fleet lists into
  `scripts/fleet.mjs`; a non-bot directory under `bots/` is now rejected rather
  than counted.
- Verified the runtime locally via PM2 (9/9 services online, bots HTTP 200,
  authenticated readiness correctly degraded) as a substitute for the
  suspended Render fleet.

## Previously completed

See `CHANGELOG_AI.md`, `PROJECT_STATE.md`, and `SESSION_HANDOFF.md` for the
chronological implementation record, including OAuth, RLS, bot gates, Luffy
cards, CI, Render, and Vercel work.
