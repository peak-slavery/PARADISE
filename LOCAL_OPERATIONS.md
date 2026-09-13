# Local Operations

## Commands

- `npm run deploy:commands`: register and read back all eight global command sets.
- `npm run deploy:commands -- --guild`: register immediately in the development guild.
- `npm run check:local`: report credential presence and Supabase Discord provider status without printing secrets.
- `npm run check:local -- --providers`: also validate provider authentication using read-only model-list requests.
- `npm run check:bots`: inspect the local authenticated health endpoints on ports 3101-3108.
- `pm2 start ecosystem.config.cjs`: start the dashboard and all eight local bot launchers.
- `npm run test:local`: start a localhost-only PM2 smoke test, probe all nine endpoints, and always remove its named services.
- `pm2 status` / `pm2 logs`: inspect the PM2 fleet.
- `pm2 restart all` / `pm2 stop all`: restart or stop the local fleet.
- `node scripts/run-bot.mjs <botId>`: launch one bot using credentials from `temp cred.txt` in memory.
- `npm run dev:dashboard`: run the dashboard at `http://localhost:3000` using the local credential file in memory.

Registration is intentionally separate from bot startup. Do not bulk-register commands on every gateway reconnect.

## Provider Configuration

The existing descriptive key labels in `temp cred.txt` remain supported. Prefer explicit `NAME=value` entries for new keys:

```text
GROQ_API_KEY=
MISTRAL_API_KEY=
NVIDIA_NIM_API_KEY=
CEREBRAS_API_KEY=
BRAVE_SEARCH_API_KEY=
SERPAPI_KEY=
```

Optional model settings are `CYRENE_MODEL`, `ASSISTANT_MODEL`, `AGNES_IMAGE_MODEL`, `CYRENE_TTS_MODEL`, `CYRENE_TTS_VOICE`, `ZORO_SLM_MODEL`, `ZORO_SLM_MAX_TOKENS`, and `ZORO_SLM_CONTEXT_CHARS`. Zoro's application caps are 2,000 input characters, 64 output tokens, a 6-second request timeout, and bounded queue concurrency; these are stricter than Cerebras Free Trial limits (1 RPM, 30K uncached TPM, 90K total TPM, 1M TPH, and 1M TPD). Zoro and Shanks share one Cerebras quota, so classifier traffic competes with AutoMod review traffic. Environment variables take precedence for provider settings. Restart the affected bot after changing the credential file; it is not watched automatically. Never put provider keys in dashboard form fields.

Shanks reviews **Discord AutoMod triggers**, not every chat message. Configure a Discord keyword rule with `/automod`, ensure the bot has the required server permissions, and enable Message Content in the Discord developer portal. The runtime requests the AutoModerationExecution intent. Warnings are deduplicated for one minute. Zoro's independent message classifier uses the shared `CEREBRAS_API_KEY` and the bounded Zoro settings above.

## Discord OAuth

1. Enable Discord in Supabase Authentication > Sign In / Providers using the Discord application's client ID and client secret.
2. In the Discord developer portal, register the Supabase callback URL shown by that provider, typically `https://<project>.supabase.co/auth/v1/callback`.
3. In Supabase URL Configuration, allow `http://localhost:3000/auth/callback` for local work and the deployed dashboard's `/auth/callback` URL. Allow the `next` query variants used by the app.
4. Set the deployed `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS dashboard origin. The local launcher uses localhost so PKCE cookies and the callback stay on the same origin.
5. Start a new sign-in from `/login`. Completing Discord consent requires the operator's browser account.

Database authorization is separate from OAuth. Signing in never grants guild or master access by itself. Apply the existing Supabase schema and provision the authorized guild ownership rows before expecting servers to appear.

## Dashboard Scope

The command deck exposes supported runtime configuration, fleet enable/pause, server pause, embed composition, logs, security history, setup and master guild authorization. Enabled is not an online/health assertion. Game rules and provider quotas are not editable where the bots do not implement those settings. The One Piece-inspired Log Pose uses CSS 3D transforms and an original SVG ship, with reduced-motion support and no WebGL dependency.
