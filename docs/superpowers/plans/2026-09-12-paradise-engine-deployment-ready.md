# Paradise Engine Deployment-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved deployment-readiness migration without exposing credentials: Zoro uses Cerebras `qwen-3.8-27b` with hard local limits, Cyrene keeps Groq/Mistral text routes and gains isolated image/TTS routes, and all env/policy/deployment surfaces remain coherent.

**Architecture:** Keep provider adapters behind the existing bot-local seams and preserve the shared `Env` contract as the only runtime configuration source. Use the existing queue for bounded upstream work, fail open for moderation and fail to a user-facing embed for media, and hydrate only bot-scoped provider secrets through the existing vault policy. Do not rename Zoro’s Cerebras credential to Cyrene’s `GROQ_API_KEY`; remove `GROQ_AUTOMOD_API_KEY` entirely.

**Tech Stack:** TypeScript, Node 22 `fetch`, Zod, Vitest, Discord.js, Next.js dashboard, Render Blueprint.

**Spec:** User-approved deployment-ready phase plan in the conversation on 2026-09-12.

## Global Constraints

- Treat previously exposed credential values as compromised; rotation and vault seeding are external operator actions and are not performed by code edits.
- Never read, print, commit, persist, or transmit values from `temp cred.txt`; local loaders may parse it in memory only.
- `GROQ_API_KEY` belongs to Cyrene’s Groq text route; Zoro must use `CEREBRAS_API_KEY` only.
- Cerebras Free Trial `qwen-3.8-27b` limits are 1 RPM, 30K uncached TPM, 90K total TPM, 1M TPH, and 1M TPD; application caps are stricter: 2,000 input characters, 64 output tokens, 6-second timeout, and bounded queue concurrency.
- Zoro moderation is fail-open: transport, timeout, non-2xx, empty, and malformed responses never punish or escalate content.
- Media requests validate and truncate input, run through the existing queue, and always end in a Discord response rather than an unhandled rejection.
- Do not add dependencies when Node 22, `fetch`, and existing Discord.js primitives suffice.

### Task 1: Normalize environment and secret policy

**Files:**
- Modify: `packages/shared/src/env.ts`
- Test: `packages/shared/src/env.test.ts`
- Modify: `packages/shared/src/logger.ts`
- Modify: `packages/secret-policy/src/index.ts`
- Test: `packages/secret-policy/src/index.test.ts`
- Modify: `bots/zoro/.env.example`

- [ ] Remove `GROQ_AUTOMOD_API_KEY`, `groqAutomodApiKey`, `hasAutomodSlm`, `AUTOMOD_SLM_MODEL`, and the obsolete logger redaction entry.
- [ ] Add `AGNES_IMAGE_MODEL` defaulting to `agnes-image-2.5-flash`, `CYRENE_TTS_MODEL`, `CYRENE_TTS_VOICE`, `ZORO_SLM_MODEL` defaulting to `qwen-3.8-27b`, `ZORO_SLM_MAX_TOKENS` constrained to `1..64`, and `ZORO_SLM_CONTEXT_CHARS` constrained to `1..2000`.
- [ ] Expose those fields on `Env`, map them in `loadEnv`, and expose `hasCerebras`, `hasAgnesImage`, and `hasTts` without retaining duplicate provider-specific aliases.
- [ ] Keep `CEREBRAS_API_KEY` in the Shanks and Zoro provider mappings, add Agnes and OpenRouter TTS mappings to Cyrene, and remove `provider.groq_automod`.
- [ ] Update tests to assert Cerebras is present for Zoro and legacy Groq AutoMod fields are absent from the contract.
- [ ] Run `npm run typecheck --workspaces --if-present` and the two focused Vitest suites.

### Task 2: Finish Zoro Cerebras classifier

**Files:**
- Modify: `bots/zoro/src/lib/slm.ts`
- Create: `bots/zoro/src/lib/slm.test.ts`
- Modify: `bots/zoro/src/commands/slm.ts`
- Modify: `bots/zoro/src/commands/zoro.ts`
- Modify: `bots/zoro/src/index.ts`

- [ ] Lock the model to `qwen-3.8-27b` and clamp configuration through the shared env limits; never accept an arbitrary provider model.
- [ ] Use `https://api.cerebras.ai/v1/chat/completions` with `CEREBRAS_API_KEY`, `temperature: 0`, `max_tokens <= 64`, and user content capped at 2,000 characters.
- [ ] Return benign fail-open results for all upstream failures and avoid logging credentials or raw user content.
- [ ] Keep event and `/slm test` calls inside `services.queue.run` with `timeoutMs: 6000` and `maxPending: 16`.
- [ ] Add tests for strict parser behavior, confidence clamping, payload model/token/input caps, non-2xx, timeout, malformed output, and disabled-key behavior using mocked `fetch`.
- [ ] Run the Zoro test, typecheck, and full workspace tests.

### Task 3: Isolate Cyrene media providers and commands

**Files:**
- Modify: `bots/cyrene/src/lib/providers.ts`
- Create: `bots/cyrene/src/lib/image.ts`
- Create: `bots/cyrene/src/lib/tts.ts`
- Create: `bots/cyrene/src/lib/media.test.ts`
- Create: `bots/cyrene/src/commands/imagine.ts`
- Create: `bots/cyrene/src/commands/speak.ts`
- Modify: `bots/cyrene/src/commands/model.ts`
- Modify: `bots/cyrene/src/index.ts`
- Modify: `packages/shared/src/env.ts`

- [ ] Preserve `/cyrene` Groq and `/ask` Mistral route isolation.
- [ ] Implement Agnes image generation with a 1,000-character prompt cap, queue timeout 30 seconds, response content-type/size checks, and Discord attachment delivery.
- [ ] Implement OpenRouter TTS using `OPENROUTER_API_KEY`, `CYRENE_TTS_MODEL`, and `CYRENE_TTS_VOICE`; cap text at 800 characters, validate audio content, and default replies ephemeral.
- [ ] Keep voice instructions in provider request configuration, not in user-visible chat context.
- [ ] Add unit tests for prompt/text validation, route isolation, and non-2xx/empty media responses.
- [ ] Run Cyrene tests and typecheck before continuing.

### Task 4: Update in-memory local loaders and deployment manifests

**Files:**
- Modify: `scripts/run-bot.mjs`
- Modify: `scripts/deploy-commands-all.mjs`
- Modify: `scripts/check-local-config.mjs`
- Modify: `scripts/validate-prod-creds.mjs`
- Modify: `render.yaml`
- Modify: `.env.example`
- Modify: `dashboard/.env.example`
- Modify: `dashboard/.env.vercel.example`
- Modify: `scripts/check-deploy.mjs`
- Modify or test: `scripts/credential-keys.test.mjs`, `scripts/render-config.test.mjs`

- [ ] Support explicit `NAME=value` and current descriptive credential lines with environment precedence, without writing secret values.
- [ ] Inject Cyrene Groq/Mistral/Agnes/OpenRouter values, Shanks/Zoro shared Cerebras, and Niko Robin provider values only into the target child environment.
- [ ] Remove every `GROQ_AUTOMOD_API_KEY` and old Zoro model reference from manifests and validation.
- [ ] Add Render sync-false entries for the new provider secrets and safe model defaults; keep vault-managed backend secrets out of YAML.
- [ ] Extend deployment validation to fail on stale AutoMod-Groq references and missing new env contract entries.
- [ ] Run loader tests and `npm run check:deploy`.

### Task 5: Update dashboard/operator readiness and documentation

**Files:**
- Modify: `dashboard/lib/setup.ts`
- Modify: `dashboard/app/dashboard/[guildId]/setup/page.tsx`
- Modify: `dashboard/lib/bots.ts`
- Modify: `SECURITY_BOOTSTRAP.md`
- Modify: `LOCAL_OPERATIONS.md`
- Modify: `HOST_READINESS_AUDIT.md`
- Modify: `DEPLOY.md`

- [ ] Replace all Groq AutoMod wording with Cerebras Zoro wording and show model/provider presence only, never key values.
- [ ] Add Agnes and OpenRouter TTS readiness rows and four-route model diagnostics.
- [ ] Document the shared Cerebras quota trade-off and hard local limits.
- [ ] Document external credential rotation and vault seeding without embedding or repeating secret values.
- [ ] Run a stale-reference scan and dashboard tests.

### Task 6: Full verification and production handoff

**Files:**
- No new production source files; update tests only if a verified failure requires it.

- [ ] Run `npm ci` only if lockfile/package metadata changed; otherwise run `npm test`.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run check:deploy`, and `npm run build`.
- [ ] Run `git diff --check` and scan tracked files for `GROQ_AUTOMOD_API_KEY`, `provider.groq_automod`, `groqAutomodApiKey`, and stale Zoro Groq model names.
- [ ] Report that credential rotation, Supabase schema application, OAuth configuration, Vercel deployment, Render deployment, command registration, and live smoke tests remain operator-side actions requiring fresh credentials.
