# EI-point — CI / Security / Vercel Fix Pack

## Target
- **Repository:** `xyanncat/EI-point`
- **Target commit:** `81bdce04519f9826133be1432521fcc7c62ccae9`

This document contains concrete fixes for failed checks shown in GitHub Actions:
- `.github/dependabot.yml` — invalid configuration
- `CI / CodeQL (javascript-typescript)` — Code Scanning not enabled
- `CI / secret scan` — Gitleaks false positive from a Discord ID test fixture
- `Vercel` — deployment blocked

Passing application checks must not be weakened.

---

## 1. Fix `.github/dependabot.yml`

### Problem
The previous configuration contained:
```yaml
ignore:
  - dependency-name: next
    update-types: [version-update:ignore]
```
`version-update:ignore` is not a valid Dependabot update type.

### Recommended Replacement
```yaml
version: 2

updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday

    groups:
      development-dependencies:
        dependency-type: development

      production-dependencies:
        dependency-type: production

    commit-message:
      prefix: chore(deps)

    labels:
      - dependencies

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday

    groups:
      github-actions:
        patterns:
          - "*"

    commit-message:
      prefix: chore(actions)

    labels:
      - dependencies
```
Do not add the invalid `version-update:ignore` value back.

---

## 2. Fix the Gitleaks Secret-Scan Failure

### Problem
Gitleaks flags literal Discord snowflake-shaped values in:
`packages/shared/src/env.test.ts`

These are test fixtures, not production credentials, but the scanner detects their Discord-ID shape:
```ts
DISCORD_CLIENT_ID: '1544547167858069504',
OWNER_IDS: '123456789012345678',
MASTER_DISCORD_ID: '123456789012345678',
```

### Recommended Fix
Do not disable Gitleaks and do not create a broad Discord-ID allowlist.
Replace literal snowflake-shaped fixtures with deterministic generated test values:
```ts
const TEST_DISCORD_ID_A = '1'.repeat(18);
const TEST_DISCORD_ID_B = '2'.repeat(18);
```
Then use:
```ts
const env = loadEnv({
  BOT_ID: 'zoro',
  BOT_NAME: 'Zoro',
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: TEST_DISCORD_ID_A,
  OWNER_IDS: TEST_DISCORD_ID_A,
  MASTER_DISCORD_ID: TEST_DISCORD_ID_A,
  CEREBRAS_API_KEY: 'cerebras-key',
  OPENROUTER_API_KEY: 'openrouter-key',
  AGNES_IMAGE_API_KEY: 'agnes-key',
  CYRENE_TTS_MODEL: 'openai/tts-1',
  CYRENE_TTS_VOICE: 'alloy',
});
```
If tests require multiple IDs, use `TEST_DISCORD_ID_A` and `TEST_DISCORD_ID_B`.
Goal: Gitleaks -> PASS without disabling or weakening the scanner.

---

## 3. Fix CodeQL

### Observed Failure
The CodeQL job analyzed JS/TS code successfully but failed uploading SARIF:
`Code scanning is not enabled for this repository.`
This is a repository feature configuration issue, not an application vulnerability.

### Preferred Solution (If GitHub Code Security is available)
1. Repository Settings -> Code Security / Advanced Security.
2. Enable GitHub Code Scanning / CodeQL.
3. Keep CodeQL CI job enabled.
4. Upgrade CodeQL actions to v4:
   - `github/codeql-action/init@v4`
   - `github/codeql-action/analyze@v4`
5. SARIF upload permissions:
   ```yaml
   permissions:
     contents: read
     security-events: write
   ```

---

## 4. CodeQL Fallback (If GitHub Code Security is unavailable)
If GitHub Code Scanning cannot be enabled on the private repo, prevent upload failure:
```yaml
- name: Initialize CodeQL
  uses: github/codeql-action/init@v4
  with:
    languages: javascript-typescript

- name: Autobuild
  uses: github/codeql-action/autobuild@v4

- name: Analyze with CodeQL
  uses: github/codeql-action/analyze@v4
  with:
    upload: never
```
Preserves static analysis without attempting unavailable SARIF upload. Do not delete CodeQL.

---

## 5. Vercel Deployment Triage Sequence

The dashboard build inside GitHub CI is already passing. Do not rewrite dashboard code solely because Vercel check is red.

Sequence:
1. Fix Dependabot
2. Fix Gitleaks
3. Fix CodeQL
4. Push clean commit
5. GitHub CI green
6. Vercel deploy/retry
7. Investigate Vercel only if it still fails

If Vercel remains blocked on a green commit:
- Check Vercel deployment logs
- Check project root directory, build command, Node.js version
- Check production environment variables
- Check deployment protection & branch protection settings
- Do not bypass deployment protection

---

## 6. Verify Vercel Production Environment

Required production variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MONGODB_URI`
- `MONGODB_DB`
- `SECRET_VAULT_MASTER_KEY`
- `SECRET_VAULT_SALT`
- `HMAC_SECRETS_JSON`
- `NEXT_PUBLIC_SITE_URL`
- `DASHBOARD_URL`
- `DEV_GUILD_ID`
- `MAIN_GUILD_ID`
- `DEV_AUTH_CHANNEL_ID`
- `DEMO_MODE=false`

Never expose server secrets via `NEXT_PUBLIC_*`.

---

## 7. Preserve Existing Security Controls
Do not weaken:
- HMAC authentication between bots and dashboard
- Supabase RLS
- Service-role isolation
- CSRF protection
- Fail-closed guild authorization
- TLS-only MongoDB
- Redis rate limits & provider cooldowns
- Queue concurrency protection
- Credential/token redaction
- Production authentication requirements

---

## 8. GitHub Actions Maintenance
- Action internal Node runtime: GitHub warnings about Node 20 deprecation; update actions to `@v4`.
- Application runtime: Target Node 22 (`engines.node: ">=22"`). Do not change application runtime due to action runtime deprecation warnings.

---

## 9. Validation Commands
```bash
npm ci
npm run lint
npm test
npm audit --audit-level=high
npm run typecheck
npm run typecheck -w @eipoint/shared
npm run build -w @eipoint/dashboard
```

---

## 10. Expected Check State
- [x] `CI / dependency review`
- [x] `CI / CodeQL (javascript-typescript)`
- [x] `CI / secret scan`
- [x] `CI / build dashboard`
- [x] `CI / lint`
- [x] `CI / npm audit`
- [x] `CI / test`
- [x] `shared typecheck`
- [x] `all bot typechecks`
- [x] `Vercel`
- [ ] `CI / production smoke` (can be skipped until production is live)

---

## 11. Priority Execution Order
- **P0**:
  - Replace `.github/dependabot.yml`
  - Replace literal Discord snowflake fixtures in `packages/shared/src/env.test.ts`
  - Determine Code Security availability (CodeQL v4 with SARIF upload vs `upload: never`)
- **P1**:
  - Run local CI checks
  - Push changes
  - Confirm GitHub Actions & Vercel green
- **P2**:
  - Triage Vercel deployment if blocked
  - Run production smoke tests when environment is live

---

## 12. Non-Negotiables ("Do NOT make these changes")
- Do NOT disable Gitleaks or allowlist all Discord IDs
- Do NOT remove CodeQL or make security scans non-blocking
- Do NOT disable `npm audit` or `dependency review`
- Do NOT set `DEMO_MODE=true` in production
- Do NOT expose `SUPABASE_SERVICE_ROLE_KEY` or `MONGODB_URI`
- Do NOT remove HMAC verification or RLS
- Do NOT bypass Vercel deployment protection or rewrite dashboard without specific error
