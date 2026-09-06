# Paradise Engine — Deploy Guide

End-to-end walkthrough for taking the bot network and dashboard from a fresh
clone to active in production. Pair this with `SECURITY_BOOTSTRAP.md` for the
credential-rotation steps you must do before the first deploy.

---

## 0. Architecture in one paragraph

The dashboard is a Next.js 16 app that lives on Vercel. It is the **only**
host that holds the production secrets (MongoDB URIs, Supabase service-role
key, Upstash Redis token, per-bot API keys). Each of the eight bots is a
small Node service that lives on Render. On boot, a bot opens `/health`, then
makes a single HMAC-signed POST to the dashboard's
`/api/internal/secret/{name}` endpoint to fetch every secret it needs, and
caches the result in process memory for five minutes. The bot and the
dashboard share one HMAC secret per bot, configured out-of-band on each
side. This is why `render.yaml` does not declare any vault-managed secret —
adding one there would defeat the entire architecture.

## 1. Pre-flight

```bash
npm ci
npm run typecheck
npm run test
npm run check:deploy
```

`check:deploy` is the local gate that mirrors what Render and Vercel will see
on the next deploy: it walks `render.yaml`, the bot packages, the dashboard
bundle, the shared runtime, and the `.env.example` files and exits non-zero
if any required artifact is missing. Treat any failure as a deploy blocker.

## 2. Rotate the secrets

Read `SECURITY_BOOTSTRAP.md` and follow the rotation list before pasting any
value into a provider. Anything that has been typed into a chat, ticket, or
browser dev tools must be considered compromised.

## 3. Dashboard (Vercel)

1. Import this repo as a Vercel project. The `vercel.json` at the repo root
   declares `framework: "nextjs"`, the `iad1` region, and the canonical
   `npm run build` command — Vercel will use them as-is.
2. Project Settings → Environment Variables. Add the variables listed in
   `dashboard/.env.vercel.example` (every key in that file, with empty
   defaults replaced by real values). `DEMO_MODE` must be `false` in
   production.
3. Deploy. The build uses the secret vault only after the Supabase
   `on_auth_user_created` trigger has been installed (step 4).
4. The first request that requires Supabase auth will 503 until the schema
   is loaded. That is expected.

## 4. Supabase schema

```bash
psql "$SUPABASE_DB_URL" < infra/supabase/schema.sql
```

The schema is idempotent (`CREATE OR REPLACE` everywhere). It provisions
the `users` table mirror, the `guild_whitelists`, `server_settings`,
`bot_states`, `audit_logs`, and `secret_vaults` tables, plus the RLS
policies. The `owns_guild` helper is `SECURITY DEFINER`; if your Supabase
project has a stricter `SECURITY DEFINER` lint than the one this repo was
developed against, run the lint after the schema loads and address each
finding before opening the dashboard to the public.

## 5. Seed the bot secrets on the dashboard

The dashboard stores all vault secrets encrypted at rest. To add a secret:

1. Sign in to the dashboard as the master owner.
2. Open **Settings → Secret Vault**.
3. For each provider (`mongodb`, `supabase`, `redis`, `firebase`,
   `cloudflare`), add the URI / token. The vault re-encrypts on save.

Each bot fetches its own subset on boot — the mapping is encoded in
`packages/secret-policy` and referenced by
`packages/shared/src/vault-client.ts`.

## 6. Provision the per-bot HMAC secrets

Every bot has a unique 32+ char secret. Store the full map in
`HMAC_SECRETS_JSON` on the dashboard (one entry per bot id) and in the
matching env var on each Render service.

```json
{
  "niko-robin": "<64 hex chars>",
  "boahancock": "<64 hex chars>",
  "nami": "<64 hex chars>",
  "cyrene": "<64 hex chars>",
  "zoro": "<64 hex chars>",
  "shanks": "<64 hex chars>",
  "luffy": "<64 hex chars>",
  "sanji": "<64 hex chars>"
}
```

Rotate the secret by adding a new value with a new `id`; the dashboard
accepts the most recent one during the rotation window and the bots pick it
up on the next 5-minute cache expiry.

## 7. Bots (Render)

1. Connect this repo to Render as a Blueprint. Render reads `render.yaml`
   and creates the eight web services. Each service inherits the
   `&bot-common` anchor — that is where the HMAC secret, Discord token,
   dashboard URL, and health token live. Per-service overrides only carry
   the bot id, name, embed colour, Discord client id, and (for the AI bots)
   the per-provider API keys.
2. For each service, open **Environment** and set the `sync: false` values
   that Render has not generated for you. The minimum you must enter:
   - `DISCORD_TOKEN` (from the Discord developer portal)
   - `HMAC_SECRET` (the same value stored in the dashboard's
     `HMAC_SECRETS_JSON` for that bot)
   - `DASHBOARD_URL` (your Vercel deployment URL, e.g.
     `https://paradise-engine.vercel.app`)
   - `DEV_GUILD_ID` / `MAIN_GUILD_ID` / `DEV_AUTH_CHANNEL_ID` (Discord
     snowflake ids for the development guild, main guild, and the private
     review channel)
3. `HEALTH_TOKEN` is generated by Render (`generateValue: true`); record it
   for the uptime monitor (step 9).
4. Trigger a deploy. The first `npm run deploy:commands` call during the
   build will fail if the Discord token is wrong — that is the fastest
   signal you have a credentials problem.
5. Watch the service logs for `boot ok`. The bot is live the moment the
   gateway `ready` event fires.

## 8. (Alternative) Paid-tier note

The free plan on Render will spin services down after ~15 minutes of
inactivity, which means a cold start on the next message. The free plan
also caps outbound WebSocket lifetime aggressively. If you intend to keep
the network live 24/7, move the bots to a paid Render instance, a small
VM, or Railway / Fly.io. The only file you have to touch on the bots'
behalf is the host: the bots themselves are environment-agnostic.

## 9. Uptime monitor

Once each bot reports `boot ok`, point an external uptime monitor (Uptime
Robot, BetterStack, or a simple cron hitting `curl --fail`) at
`https://<service>.onrender.com/health` with header
`Authorization: Bearer ${HEALTH_TOKEN}`. Render's own health check covers
the same endpoint without auth and is a fine backup.

## 10. Smoke test

1. From a Discord account that is **not** the master, run a bot command in
   the main guild. It should reply with the standard embed.
2. Sign in to the dashboard. The session should land on `/dashboard`. The
   sidebar should list each guild the master owns.
3. From the dashboard, post an embed to one of your guilds. The bot should
   deliver it within one interlink poll cycle (default 2s).
4. Stop one bot (suspend the Render service, or run it locally with an invalid
   `DISCORD_TOKEN` to confirm the startup guard fires). Confirm the dashboard
   surfaces the offline state.

## 11. Operations

- **Add a new bot** — `node scripts/new-bot.mjs <id> <hexColour> "<name>"`,
  then add a new `&bot-common`-style service to `render.yaml` and a new
  `HMAC_SECRETS_JSON` entry on the dashboard.
- **Rotate a secret** — paste the new value into the dashboard vault, then
  add a new entry to `HMAC_SECRETS_JSON` keyed on the same bot id. Old
  bots continue to work until their 5-minute cache expires.
- **Run retention** — `npm run archive:retention` from a host that has
  `MONGODB_URI` and `SUPABASE_URL` in its env. The script archives audit
  logs older than `RETENTION_DAYS` to Supabase and deletes the Mongo
  originals.
- **Pre-deploy re-check** — `npm run check:deploy` from `main` before any
  push. The validator catches the silent regressions that show up in
  production at 3am.

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Dashboard authentication is not configured` 503 on every dashboard request | `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset on Vercel | Re-add the env vars, redeploy |
| Bot `boot ok` but every command 403s on a guild | Whitelist row missing for that guild | Use the dashboard review flow to add a `guild_whitelists` row |
| Vault fetch returns 404 in bot logs | `HMAC_SECRETS_JSON` on the dashboard is missing that bot id | Add the bot id to the JSON map |
| `/health` returns 401 from external uptime | `HEALTH_TOKEN` missing in the monitor's request | Re-copy the value Render generated; do not paste it anywhere public |
| `DISCORD_TOKEN` rotation looks stuck | Old token still cached in a 5-minute vault cache | Restart the bot (Render → Manual Deploy) — bypasses the cache |
