# EI-point — Decisions

> Architectural and security decisions with the reasoning that justifies them.
> A new model should understand *why* before changing any of these.

## 1. Bots hold no production secrets

**Decision**: bots boot with only bootstrap config, then fetch secrets from
the dashboard vault via HMAC-signed `/api/internal/secret/{name}`.

**Why**: keeps credentials in one audited place (the dashboard's AES-GCM
vault) instead of duplicated across 8 Render services. Rotating a key touches
one store, not eight.

**Do not change** unless the vault itself is being replaced.

## 2. Compare-and-swap instead of multi-document transactions

**Decision**: atomicity via `findOneAndUpdate` filters on
(id, version, status, owner) plus best-effort compensation, not Mongo
sessions.

**Why**: the M0 free tier does not support multi-document transactions.
Every write carries its precondition in the filter, so a concurrent mutation
makes the update match zero documents instead of corrupting state.

**Trade-off**: compensation paths (e.g. currency rollback on pack-insert
failure) are best-effort; a paid tier would make them transactional.

## 3. Button interactions run through the shared dispatcher

**Decision**: added a `handleButton` option to `createBot` rather than letting
each bot attach its own `InteractionCreate` listener via `setup`.

**Why**: a bot-attached listener would bypass the shared authorization,
pause, dev-guild and rate-limit gates — a direct security regression. Routing
buttons through the dispatcher keeps one gated entry point.

**Constraint**: the dispatcher is in `packages/shared`, so this is shared
infrastructure — extend it, don't fork it.

## 4. `$setOnInsert` must be insert-only

**Decision**: the test harness models `$setOnInsert` as applying only on
insert, matching real MongoDB.

**Why**: `getCurrency` uses `$setOnInsert: { balance: 0 }` on an upsert. If
honoured on updates, every read would zero the player's balance. This was a
real bug in the fake collection, not in production code.

## 5. Limited Arts at exactly 0.001%

**Decision**: integer weight table summing to 100,000,000 with Limited Arts
at weight 1,000. `impliedProbability === 0.00001` is asserted to 8 decimals.

**Why**: floating-point percentage math drifts. Integer weights + a single
`weight / totalWeight` derivation is exact and auditable.

**Also**: Limited Arts is `eventOnly: true`, so standard packs exclude the
rank from their pool entirely — there is no "almost-rolled-it" path and no
reroll exploitation (one server-side draw, period).

## 6. No hardcoded privileged identity

**Decision**: master access resolves through the database `is_master_user()`
predicate; bot admin through `services.isOwner()` against `OWNER_IDS`.

**Why**: a hardcoded Discord ID is unrotatable and leaks through source. A
database predicate can be reprovisioned without a code change.

## 7. Demo mode fails closed on partial configuration

**Decision**: demo fixtures are served only when `hasConfiguredEnvironment()`
finds *zero* backend credentials.

**Why**: a partially-configured production deploy (some vars set, others
missing) must never silently serve fixture data to the public internet. It
returns 503 instead.

## 8. gitleaks allowlist is narrow and documented

**Decision**: `gitleaks.toml` extends the full default ruleset and allowlists
only 8 public Discord application client IDs, 2 fixture IDs, and 1 masked
former operator value.

**Why**: these are public identifiers in deployment config and install links,
not credentials. The scanner stays enabled and a negative test proves forged
tokens are still caught.

**Do not**: broaden this to make a scan pass. Fix the source instead.

## 9. Vercel deploys require the xyanncat commit author

**Decision**: repo-local git identity stays `xyanncat`.

**Why**: the hobby team is single-seat and linked to `xyanncat`; commits
authored by `peak-slavery` are blocked with `TEAM_ACCESS_REQUIRED`. This was
diagnosed from the actual deployment record, not guessed.

## 10. Unauthenticated `/health` returns 200 even when degraded

**Decision**: liveness and readiness are separate. Unauthenticated probes get
`{status:"degraded"}` with 200; authenticated probes get component detail and
a 503 when unhealthy.

**Why**: free-tier Render services must answer liveness probes to avoid being
spun down and to let the keep-alive ring work. Reporting 503 to a liveness
probe would be self-inflicted downtime.

## 11. Never PUT a partial env array to Render

**Decision**: always GET → merge → PUT the complete env set.

**Why**: Render's PUT replaces the whole set. A partial PUT once wiped every
bot's DISCORD_TOKEN/BOT_ID/HMAC_SECRET and crashed all 8 deploys.
