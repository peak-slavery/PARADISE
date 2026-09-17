# EI-point — Architecture

> Verified structure as implemented (not as intended). No secrets.

## Topology

```
                      ┌─────────────────────────────────────────┐
   Discord ──────────►│  8 Discord bots (discord.js 14, tsx)     │
   (8 applications)   │  shanks sanji zoro boahancock            │
                      │  nami luffy niko-robin cyrene            │
                      └───────────────┬─────────────────────────┘
                                      │ HMAC-signed internal API
                                      ▼
                      ┌─────────────────────────────────────────┐
                      │  Next.js 16 dashboard (Vercel)          │
                      │  ei-point-dashboard.vercel.app          │
                      │  - Discord OAuth (Supabase Auth)        │
                      │  - Secret vault (AES-GCM, master key)   │
                      │  - RLS-enforced guild views             │
                      └───┬──────────┬──────────────┬───────────┘
                          │          │              │
                  ┌───────▼──┐  ┌────▼─────┐  ┌────▼─────┐
                  │ Supabase │  │ MongoDB  │  │ Upstash  │
                  │ (RLS)    │  │ Atlas    │  │ Redis    │
                  └──────────┘  └──────────┘  └──────────┘
```

Bots do NOT hold production secrets directly. They boot, then call the
dashboard's `/api/internal/secret/{name}` with an HMAC signature to fetch
their secrets from the dashboard vault. This keeps credentials in one place.

## Layout

| Path | Purpose |
|---|---|
| `dashboard/` | Next.js 16 app (port 3000). Deployed to Vercel. |
| `bots/<name>/src/commands/` | Slash commands per bot (auto-discovered) |
| `bots/<name>/src/lib/` | Bot-specific logic (e.g. luffy's card engine) |
| `bots/<name>/src/index.ts` | Entrypoint → `createBot()` |
| `packages/shared/` | Runtime: bot bootstrap, auth, queue, embeds, db |
| `packages/secret-policy/` | Secret-handling policy helpers |
| `infra/mongo/indexes.cjs` | Canonical Mongo index contract |
| `infra/supabase/` | Migrations (0001 base, 0002 guild_access) |
| `scripts/*.mjs` | 26 ops scripts; 6 are `*.test.mjs` run by `npm test` |
| `docs/ai/` | This directory — persistent model memory |

## Shared runtime (`packages/shared/src/bot.ts`)

`createBot(options)` wires: env → logger → Supabase → Mongo → Redis (Kv) →
batched log writer → task queue → embed factory → `LazyCommandRunner`.

**Interaction dispatch** (single `InteractionCreate` handler):
1. Button with `guild-auth:` prefix → master-only guild authorization flow.
2. Any other button → `options.handleButton` (if registered), passing through
   the same authorization, pause, dev-guild and rate-limit gates as a slash
   command. Luffy uses this for collection pagination.
3. Chat input command → `buildContext` → gates → `runner.execute`.

**Gates, in order**: guild authorization → control state (enabled/paused) →
dev-guild operator-only check → dev-command scope check → per-guild RBAC role
allowlist → rate limiter → `guard()` wrapper (UserError/ServiceUnavailable
expected, everything else to Sentry).

## Luffy card engine (`bots/luffy/src/lib/cards/`)

```
rarity.ts   frozen 11-rank weight table + pickRankFromTable + impliedProbability
catalog.ts  data-driven CARD_DEFINITIONS (18) + CARD_PACKS (5)
engine.ts   pure: ID generation, openPack, computeSellValue, serial numbers,
            safeAdd/safeSub overflow guards
store.ts    repository: all CAS-atomic economy/trade/admin flows + events
render.ts   reusable embed rendering (cards, collections, packs)
```

**Atomicity model** (M0 free tier — no multi-document transactions):
- Ownership/status/version compare-and-swap via `findOneAndUpdate` filters.
- Pack purchase: conditional `$gte` debit → insert instances → insert
  acquisitions, with best-effort currency rollback on insert failure.
- Trade: lock instances (`status='locked_trade'` + lock_token) → revalidate
  recipient ownership/expiry/balance → CAS trade to accepted → transfer both
  directions → settle currency.
- Sell: CAS (id, version, status, owner, guild) → credit → ledger →
  acquisition record.

## Environments

- **Local**: PM2 via `ecosystem.config.cjs` (ports 3000 + 3101-3108),
  `npm run test:local` starts/probes/cleans up.
- **Production**: Vercel (dashboard) + Render free tier (8 bots, keep-alive
  ring so free-tier services do not spin down).

## Key invariants

- Bots never trust client-supplied currency, ownership, guild/user IDs, or
  card IDs — all validated server-side.
- Redis failure degrades to MemoryKv; it never silently grants unlimited
  expensive-provider access.
- Demo fixtures are served ONLY when zero backend credentials are configured;
  a partially-configured production deploy fails closed instead.
