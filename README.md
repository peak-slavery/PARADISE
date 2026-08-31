# Ei Point

Eight isolated Discord bots plus a Vercel control-plane dashboard, running
entirely on free tiers across multiple accounts.

```
bots/*        8 isolated services (Render free tier, 1 account each)
packages/*    @eiflow/shared — the runtime contract every bot is built on
dashboard/    Next.js control plane (Vercel)
infra/        Supabase SQL schema + MongoDB index/TTL bootstrap
```

## Data split

| Store | Holds | Why |
|---|---|---|
| Supabase (Postgres) | `users`, `servers`, `bot_configs`, `mod_actions`, `security_events`, `antinuke_whitelist` | Relational, RLS, built-in Auth |
| MongoDB Atlas | `logs`, `xp`, `card_games`, `inventories`, `ai_context` | High write volume, flexible schema |
| Upstash Redis | rate limits, antinuke counters, AI/search cache | Sub-ms, TTL auto-expiry |

Both databases cap at ~500MB on the free tier. Splitting low-write config data
from high-write activity data is what keeps each under its ceiling.

## Bot roster

| # | Bot (character) | Commands |
|---|---|---|
| 1 | Shanks (Moderation) | `/warn` `/warn remove` `/mute` `/unmute` `/ban` `/unban` `/purge` `/automode log` |
| 2 | Sanji (Logging) | `/setlogchannel` `/logconfig` `/message logs` `/other logs channel` |
| 3 | Luffy (Card Game) | `/play` `/hand` `/score` `/deck` `/inventory` |
| 4 | Niko Robin (Search) | `/search` |
| 5 | Cyrene (AI Assistant) | `/ask` `/reset` `/cyrene` |
| 6 | Nami (Level Up) | `/rank` `/leaderboard` `/setlevelchannel` |
| 7 | Boa Hancock (Welcome) | `/setwelcome` `/setleave` `/testwelcome` |
| 8 | Zoro (Antinuke) | `/antinuke` `/whitelist` `/security` `/lockdown` `/scan` `/snapshot` `/threat` `/zoro` `/slm` |

## Getting started

```bash
npm install

# 1. Create .env from .env.example
cp .env.example .env

# 2. Apply the schemas
# Set SUPABASE_DB_URL in your shell/secret manager for migrations only.
# It is a direct Postgres connection string and must never be shipped to bots or the browser.
psql "$SUPABASE_DB_URL" -f infra/supabase/schema.sql
mongosh "$MONGODB_URI" infra/mongo/init.js

# 3. Register slash commands for a bot (offline, once per bot)
npm run deploy:commands -w @eiflow/bot-shanks

# 4. Run a bot
npm run dev -w @eiflow/bot-shanks
```

## Environment

Every bot reads the same contract (validated by zod, see
`packages/shared/src/env.ts`). Missing optional services degrade gracefully
instead of crashing: no Redis means in-process rate limiting, no Mongo means
logging is disabled, no Supabase means the server-lock fails open.

## Reliability rules

- Every reply is an embed. No raw text, no `console.log`.
- No unbounded growth: `logs` has a 60-day TTL, `mod_actions` archives at 90 days.
- Writes are batched (30s flush), never per-event.
- Nothing external (AI, search) blocks the gateway event loop: queue + timeout + fallback embed.
- Every bot exposes `GET /health` reporting real connectivity to all three stores.

## Deployment

The plan targets 8 separate Render accounts, one per bot, so a crash in one
never affects the others. UptimeRobot polls each `/health` every 5 minutes with
staggered start times to avoid eight simultaneous cold starts.
