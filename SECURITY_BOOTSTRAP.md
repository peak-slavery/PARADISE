# Paradise Engine Security Bootstrap

This document contains setup instructions and secret names only. Never add
plaintext credentials, private keys, tokens, connection strings, or generated
vault keys to this file or to the repository.

## Immediate credential rotation

Credentials pasted into chat must be treated as compromised. Before deploying:

1. Rotate the Supabase service-role key and any other Supabase secret key.
2. Rotate both MongoDB database-user passwords and review Atlas network access.
3. Rotate the Upstash Redis token.
4. Revoke and regenerate the Firebase service-account key.
5. Revoke and regenerate the Cloudflare API/R2 credentials.
6. Review provider audit logs for unexpected access.

The project should only be provisioned with the newly generated values.

## Host environment

The dashboard host needs its own Supabase auth/RLS values and vault key material:

```text
NEXT_PUBLIC_SUPABASE_URL=<dashboard Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dashboard Supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<dashboard Supabase service-role key>
SECRET_VAULT_MASTER_KEY=<32 random bytes, base64>
SECRET_VAULT_SALT=<16 random bytes, base64>
HMAC_SECRETS_JSON=<JSON map of bot ids to unique HMAC secrets>
DEV_GUILD_ID=<fixed development guild id>
MAIN_GUILD_ID=<fixed main guild id>
DEV_AUTH_CHANNEL_ID=<private review channel id>
```

Do not place MongoDB, Redis, Firebase, Cloudflare, or runtime Supabase
credentials in Render/Vercel bot environment variables. The bots fetch their
allowlisted records through the signed internal vault endpoint.

Generate vault key material locally with a cryptographically secure generator:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
```

Keep both values in an offline password manager backup. Losing the master key
makes the encrypted records unrecoverable.

## Vault record names

Provision records through the authenticated master-only `PUT /api/secret/<name>`
endpoint. The request body is:

```json
{
  "plaintext": "<value supplied locally, never committed>",
  "provider": "mongodb",
  "label": "Human-readable label",
  "metadata": {"region": "provider-region"}
}
```

Required records:

| Name | Provider | Purpose |
| --- | --- | --- |
| `mongodb.primary.uri` | `mongodb` | Primary activity/state database URI |
| `mongodb.primary.database` | `mongodb` | Primary database name |
| `mongodb.secondary.uri` | `mongodb` | Audit/backup database URI |
| `mongodb.secondary.database` | `mongodb` | Audit/backup database name |
| `redis.primary.url` | `redis` | Upstash REST URL |
| `redis.primary.token` | `redis` | Upstash REST token |
| `supabase.runtime.url` | `supabase` | Runtime Supabase URL, if bots require it |
| `supabase.runtime.service_key` | `supabase` | Runtime service key, if bots require it |
| `provider.brave.api_key` | `other` | Niko Robin Brave Search provider |
| `provider.serpapi.api_key` | `other` | Niko Robin SerpAPI provider |
| `provider.groq.api_key` | `other` | Cyrene Groq provider |
| `provider.gemini.api_key` | `other` | Cyrene Gemini provider |
| `provider.openrouter.api_key` | `other` | Cyrene OpenRouter provider |
| `provider.mistral.api_key` | `other` | Cyrene Mistral provider |
| `provider.groq_automod.api_key` | `other` | Zoro AutoMod SLM provider |
| `firebase.admin.service_account` | `firebase` | Full service-account JSON |
| `firebase.storage.bucket` | `firebase` | Storage bucket, when used |
| `cloudflare.account_id` | `cloudflare` | Cloudflare account id |
| `cloudflare.api_token` | `cloudflare` | Scoped Workers/D1 token |
| `cloudflare.r2.access_key_id` | `cloudflare` | R2 access key id |
| `cloudflare.r2.secret_access_key` | `cloudflare` | R2 secret |
| `cloudflare.r2.endpoint` | `cloudflare` | R2 endpoint |
| `cloudflare.d1.database_id` | `cloudflare` | D1 database id |
| `core.guild.dev` | `core` | Fixed development guild id |
| `core.guild.main` | `core` | Fixed main guild id |
| `core.guild.dev.auth_channel` | `core` | Private authorization-review channel id |

The signed internal endpoint enforces the same per-bot allowlist:

| Bot | Runtime records | Provider records |
| --- | --- | --- |
| Shanks, Sanji, Boa Hancock, Nami, Luffy | MongoDB, Redis, runtime Supabase | None |
| Niko Robin | MongoDB, Redis, runtime Supabase | Brave Search, SerpAPI |
| Cyrene | MongoDB, Redis, runtime Supabase | Groq, Gemini, OpenRouter, Mistral |
| Zoro | MongoDB, Redis, runtime Supabase | Groq AutoMod SLM |

Discord tokens are bootstrap credentials and must be configured directly in the
corresponding Render service; they are never requested through the vault.

## Hosting configuration

### Render

Deploy each bot as its own Render web service from `render.yaml`. The Blueprint
uses the `free` plan (0.1 CPU, 512 MB RAM per service), `rootDir: .`, `npm ci`,
the matching workspace start command, `PORT=3000`, and `/health`. Render must
be given every `sync: false` value for each service, including its unique
`DISCORD_TOKEN`, `HMAC_SECRET`, `DASHBOARD_URL`, and guild routing values.
Provider keys should be provisioned as the provider records above rather than
duplicated in Render. The dashboard URL must be the deployed Vercel origin
and the dashboard's production `HMAC_SECRETS_JSON` must contain one unique
strong value for every bot.

Free-plan caveat: each service will spin down after ~15 minutes of inactivity
and cold-start on the next request. Configure a cron or uptime monitor that
hits each service's `/health` endpoint every 5–10 minutes to keep the gateway
connection warm and prevent user-visible disconnects.

### Vercel

In Vercel Project Settings set **Root Directory** to `dashboard/` and select
Next.js. Keep the repository root `vercel.json` schema-only; the project root is
a Vercel setting, not a Render `rootDir`. Configure the values in
`dashboard/.env.vercel.example` for the Production environment, especially
`NEXT_PUBLIC_SITE_URL` and `DASHBOARD_URL`, and register the same canonical OAuth
callback origin in Supabase. Add equivalent non-production values only when a
preview environment is intentionally configured.

The Firebase service-account JSON must be sent as a JSON string. Preserve the
private key's newline escapes; do not paste it into a source file.

## MongoDB 2 audit/backup design

MongoDB 2 is not a credential chain. It is an optional secondary audit sink:
- Audit log documents are batched and copied to `mongodb.secondary.*`.
- The secondary client uses a separate pool capped at five connections.
- Secondary connection or write failures never block commands or primary data.
- Audit metadata is recursively redacted for tokens, passwords, private keys,
  service keys, connection strings, URLs, cookies, and authorization values.
- The secondary `logs` collection receives the same 60-day TTL policy.

This gives backup logging without introducing a database-to-database secret
dependency. Anyone able to read MongoDB 2 can still read its audit data, so
Atlas access must be restricted by least-privilege database user, TLS, and
network allowlist.

## Provisioning order

1. Apply `infra/supabase/schema.sql` to the dashboard Supabase project.
2. Deploy the dashboard with only dashboard Supabase values, vault key material,
   HMAC configuration, and fixed guild routing values.
3. Sign in as the master Discord account.
4. Add the vault records above through the master-only API.
5. Configure each bot with identity, Discord token, HMAC secret, and
   `DASHBOARD_URL` only. Provider credentials remain in the vault.
6. Restart one bot and verify primary MongoDB, Redis, and signed vault reads.
7. Verify the secondary audit connection and a redacted document in its `logs`
   collection.
8. Invite the bot to a new guild and verify the private dev-channel review
   embed, pending lock, master approval, and temporary expiry behavior.

## Verification and safety

- `GET /api/secret` returns metadata only.
- `GET /api/secret/<name>` returns metadata only.
- `POST /api/secret/<name>/reveal` requires a reason, master access, Mongo audit
  storage, and returns plaintext only in that response.
- Bot secret reads require HMAC verification, a unique request nonce, and a
  per-bot secret allowlist.
- `PUT /api/secret/<name>` revokes the previous active record and invalidates
  the in-process plaintext cache.
- Do not run `git add` on local env files or provider JSON files.
- Do not print credentials while debugging. Log only provider name, record name,
  status, and non-sensitive error codes.
