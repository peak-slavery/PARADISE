# Paradise Engine — Deep Audit Report

**Date:** 2026-09-13
**Scope:** `packages/shared`, `packages/secret-policy`, `bots/*` (8 bots), `dashboard/`, `infra/`, `scripts/`, root config
**Method:** read-only static analysis + targeted runtime experiments to confirm findings
**Repo state:** working tree has uncommitted changes vs `1f543dd`; `.claude/worktrees/agent-*` excluded (stale Sep-5 copy)

---

## Executive Summary

This is a **well-above-average codebase**. The security-critical surfaces are not merely present but genuinely well-built: HMAC verification is constant-time with a length pre-check, the bot→dashboard internal API enforces per-bot secret isolation with cross-bot impersonation prevention, the vault is correct AEAD, and the antinuke engine is role-hierarchy-aware with fail-closed exemption handling.

The defects cluster in **one theme: state that is implicitly shared but treated as local.** A serverless cache invalidated on one instance, a log buffer whose drop policy contradicts its own log message, an XP counter whose read-then-write is not atomic, and (from the prior `bot.ts` pass) a shutdown flag doing double duty. None are remotely exploitable; all are silent-correctness problems that produce wrong data under exactly the conditions the code was written to survive.

**Counts:** 2 Critical · 7 Major · 11 Minor · 6 Informational

Genuinely notable positives — these are *not* common:
- **Zero** `as any`, `@ts-ignore`, or `@ts-expect-error` in the entire codebase.
- All 13 dashboard API routes carry an explicit authorization check.
- The one inline type assertion on parsed JSON (`internal/secret/[name]/route.ts:100`) is *explicitly validated* on the following line rather than trusted.

---

## Critical

### C-1 — Secret rotation does not invalidate the cache on other serverless instances
**File:** `dashboard/lib/secret-vault.ts:122-128` (cache), `:171` (invalidation), `:34` (definition)

```ts
type VaultCacheEntry = { plaintext: string; expiresAt: number };
const cache = new Map<string, VaultCacheEntry>();   // :34  module-global
const CACHE_TTL_MS = 5 * 60_000;                    // :11

export async function loadSecret(name, client) {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.plaintext;   // :123
  ...
}

export async function rotateSecret(...) {
  ...
  cache.delete(input.name);   // :171  ← clears only THIS instance
}
```

**Root cause.** `cache` is module-level, so each serverless instance holds its own `Map`. `rotateSecret` runs on whichever instance handled the rotation; every other warm instance keeps its stale plaintext until `CACHE_TTL_MS` expires.

**Impact.** After a credential rotation, bots that fetch the secret from a different warm instance receive the **old credential for up to 5 minutes**. If the rotation was performed *because the old credential leaked*, the exposure window you were trying to close stays open for another five minutes. The code reads as if rotation is immediate — `cache.delete` is right there — which makes this more dangerous than a simple missing invalidation, because the author will reasonably assume it works.

**Fix.** Never cache decryptable plaintext across requests without a shared invalidation channel. Two options:

```ts
// Option A (best): version the cache against a cheap DB value.
// Store a `rotated_at` on the record; include it in the cache key.
const record = await loadSecretRecord(name, client);
const key = `${name}:${record.rotated_at}`;
const cached = cache.get(key);
if (cached && cached.expiresAt > Date.now()) return cached.plaintext;
// stale entries for old rotated_at values age out on their own; add a sweep.

// Option B: drop the process-local cache entirely and cache in Redis/Upstash
// with a bounded TTL, so every instance shares one invalidation point.
```

Whichever you choose, the TTL should also drop to ≤30s for rotated material — 5 minutes is long for a value whose whole purpose is being replaceable.

---

### C-2 — Log-buffer overflow discards the *newest* audit entries and keeps the oldest
**File:** `packages/shared/src/log-sink.ts:57-61` (policy), `:80` (failure path), `packages/shared/src/bot.ts:484`

```ts
const retain = (docs: T[]): void => {
  const dropped = Math.max(0, docs.length - maxBuffered);
  buffer = dropped === 0 ? docs : docs.slice(0, maxBuffered);   // :59  keeps FIRST n
  if (dropped > 0) opts.onDrop?.(dropped);
};
...
} catch (err) {
  retain([...batch, ...buffer]);   // :80  failed OLD batch prepended to newer buffer
  failed += batch.length;
  opts.onError?.(err, batch.length);
}
```

```ts
// bot.ts:484 — what the operator is told:
log.warn({ dropped }, 'primary audit log buffer capped; dropping newest entries');
```

**Verified by experiment** (`maxBuffered = 5`, failed batch `[old1..old3]`, buffer `[new4..new8]`):

```
retained: old1,old2,old3,new4,new5
dropped : 3
--> newest entries new6,new7,new8 were DISCARDED
```

**Root cause.** Two compounding issues. (1) `slice(0, maxBuffered)` implements a *drop-newest* policy on first-in order, which is defensible on its own. (2) But `:80` re-inserts the **previously-failed older batch at the head**, so during a prolonged outage the buffer fills up with entries that have *already failed once* while current entries are discarded. The `onDrop` message then asserts the opposite of the behaviour.

**Impact.** In an incident — the exact moment audit logs matter — the trail retains stale, already-failed entries and silently discards the live activity you're trying to reconstruct. An operator reading `dropping newest entries` will conclude the newest are lost and can re-derive them; in fact the *oldest* are pinned and the newest are gone, which inverts their forensic reasoning.

**Fix.** Make the policy match the intent — newest entries are the valuable ones for an audit trail:

```ts
const retain = (docs: T[]): void => {
  const dropped = Math.max(0, docs.length - maxBuffered);
  // Keep the TAIL: most recent entries matter most for an audit trail.
  buffer = dropped === 0 ? docs : docs.slice(docs.length - maxBuffered);
  if (dropped > 0) opts.onDrop?.(dropped);
};
```

And decide explicitly what `:80` should do. Failed-then-retained-forever is how a buffer wedges; cap the retry age so a permanently-bad batch is dropped rather than monopolising the buffer:

```ts
} catch (err) {
  // Don't let an un-writable batch starve newer entries indefinitely.
  retain([...buffer, ...batch]);   // newer first; oldest failed batch evicted first
  failed += batch.length;
  opts.onError?.(err, batch.length);
}
```

Then make both `bot.ts:484` and `:500` messages match whatever you choose. A wrong log message in an audit path is worse than no message.

---

## Major

### M-1 — XP uses read-then-`$set`, so concurrent writers silently lose updates
**File:** `bots/nami/src/lib/xp.ts:196-230`

```ts
const cursor = collection.find({ $or: filters }, { projection: {...} });   // :197 READ
for await (const doc of cursor) current.set(keyOf(...), { xp: doc.xp, level: doc.level });

for (const [key, delta] of batch) {
  const base = current.get(key) ?? { xp: 0, level: 0 };
  const xp = Math.max(0, base.xp + delta.xp);      // :212 compute from SNAPSHOT
  ops.push({ updateOne: { filter: {...}, update: { $set: { xp, level, ... } }, upsert: true } });
}
```

**Root cause.** XP is computed in application code from a snapshot read, then written with `$set` — a classic lost-update pattern. In-process concurrency is correctly guarded by `this.flushing` (`:148`), so this is not a local race. The hazard is **any second writer**: a second process, a manual admin adjustment, a dashboard write, or a future replica. Whichever writer commits second overwrites the other's XP total with its own stale-derived absolute value.

**Impact.** Silent XP loss that is extremely hard to diagnose — the numbers are plausible, just wrong. It also permanently prevents horizontal scaling of the XP writer, which the current architecture happens to need (one bot per process), so the bug is latent rather than active. That's precisely why it should be fixed now, while it's cheap.

**Fix.** Use an atomic increment and read back only for level-up detection:

```ts
ops.push({
  updateOne: {
    filter: { guild_id: guildId, user_id: userId },
    update: {
      $inc: { xp: delta.xp, messages: delta.messages, voice_seconds: delta.voiceSeconds },
      $set: { updated_at: updatedAt },
    },
    upsert: true,
  },
});
```

Level-up detection then needs the post-write value — use `findOneAndUpdate` with `returnDocument: 'after'` for the subset where `base.level` is near a threshold, or accept eventual detection on the next flush. The `$inc` change is the load-bearing part.

---

### M-2 — Multi-level jumps emit only one level-up event
**File:** `bots/nami/src/lib/xp.ts:213-214`

```ts
const level = levelForXp(xp);
if (level > base.level) levelUps.push({ guildId, userId, level, xp });   // single event
```

**Verified:** old level 0 → new level 10 yields **one** event, for level 10. Levels 1–9 are never announced.

**Impact.** A member who earns a large XP grant (admin `/givexp`, voice-session backfill, a batch flush after an outage) silently skips milestone announcements — no level-up message, no reward role assignment if those are keyed off the event. Users perceive it as a missed feature; operators see no error.

**Fix.** Emit one event per crossed level, bounded by `MAX_LEVEL` (already defined in `levels.ts`, so the loop is naturally safe):

```ts
if (level > base.level) {
  for (let l = base.level + 1; l <= level; l += 1) {
    levelUps.push({ guildId, userId, level: l, xp });
  }
}
```

If bulk announcements would be spammy, cap the loop (e.g. announce only the final level plus the first) — but make that an explicit product decision rather than an accident of the arithmetic.

---

### M-3 — `Buffer.from(x, 'base64')` never throws, making vault key validation partly dead
**File:** `dashboard/lib/secret-vault.ts:36-47`

```ts
let decoded: Buffer;
try {
  decoded = Buffer.from(value, 'base64');   // :41  NEVER throws
} catch {
  throw new Error(`${name} must be base64`);   // :43  unreachable
}
if (decoded.length !== expectedBytes) throw new Error(`${name} must decode to ${expectedBytes} bytes`);
```

**Verified by experiment:**

```
Buffer.from('not!valid!base64!!!', 'base64')  → NO THROW, length=10, garbage bytes
Buffer.from('!!!', 'base64')                  → NO THROW, length=0
```

**Root cause.** Node's base64 decoder is permissive: it skips invalid characters and never raises. The `try/catch` is therefore dead code, and the `must be base64` diagnostic can never fire.

**Impact.** Low direct risk — the `expectedBytes` length check at `:45` catches most malformed input, so a bad key still fails loudly. The real cost is *diagnostic*: an operator who pastes a key with a typo gets `SECRET_VAULT_MASTER_KEY must decode to 32 bytes` when the actual problem is that it isn't base64 at all. During an incident that ambiguity costs time.

**Fix.** Validate the alphabet explicitly before decoding:

```ts
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
if (!B64.test(value) || value.length % 4 !== 0) {
  throw new Error(`${name} must be valid base64`);
}
const decoded = Buffer.from(value, 'base64');
if (decoded.length !== expectedBytes) { ... }
```

---

### M-4 — HMAC secret resolution has two inconsistent paths that can silently diverge
**Files:** `dashboard/lib/hmac.ts:24`, `dashboard/app/api/internal/secret/[name]/route.ts:20-41`, `dashboard/app/api/internal/config/route.ts:50-51`

The internal routes implement a strict per-bot resolver: it requires **all** `BOT_IDS` present, every value a strong secret (`isStrongSecret`), all values **distinct**, and falls back to `HMAC_SECRET` only outside production. The shared helper does none of this:

```ts
// hmac.ts:24
function secretKey(): string {
  return process.env.HMAC_SECRET ?? '';
}
```

`verifyWithEnvSecret` and `signWithEnvSecret` — the exported, obviously-named helpers — use that flat lookup. Any new route reaching for the natural-looking helper gets the weaker path, which in production may be an empty or legacy shared secret.

**Impact.** This is a latent-pattern risk rather than an active bug: today's routes use the strict resolver correctly. But the codebase presents two functions named almost identically, one safe and one not, and the unsafe one is the one a developer would reach for by default. The next internal route added is a coin flip.

**Fix.** Make the strict resolver the only shared primitive, and have the flat helper refuse to serve production:

```ts
// hmac.ts
function secretKey(): string {
  const perBot = process.env.HMAC_SECRETS_JSON?.trim();
  if (process.env.NODE_ENV === 'production' && !perBot) {
    throw new Error('HMAC_SECRETS_JSON is required in production');
  }
  return process.env.HMAC_SECRET ?? '';
}
```

Better still, extract the per-bot resolver out of the two route files into `dashboard/lib/hmac.ts` so there is exactly one implementation, and delete the flat path.

---

### M-5 — `/api/secret/[name]/reveal` quota has a TOCTOU window and is counted per-user, not globally
**File:** `dashboard/app/api/secret/[name]/reveal/route.ts:39-53`

```ts
const recent = await db.collection('logs').countDocuments(
  { action: 'secret.reveal', user_id: access.userId, created_at: { $gte: since } },
  { limit: REVEAL_LIMIT },
);
if (recent >= REVEAL_LIMIT) { return 429; }
// ... then loadSecret + insertOne audit row
```

Two distinct issues:

1. **TOCTOU.** The count and the subsequent `insertOne` are separate operations with an `await` gap. Concurrent requests all observe `recent < 5` and all proceed. With serverless parallelism, a burst can exceed the intended quota. The audit row is written *after* the secret is returned, so the counter lags the action.
2. **Per-user scoping.** `user_id: access.userId` means the limit is 5 per *user*. The route is master-only, so today there is one user — but the quota silently becomes 5×N if a second master is ever added, which the `is_master` column already permits.

**Impact.** The quota is a speed bump, not a hard control. Given this is the single highest-blast-radius endpoint (one call drains a provider credential), "approximately 5" under concurrency is weaker than it reads.

**Fix.** Make the audit insert the rate-limit *token* rather than a passive record — check-then-act collapses into act-then-count:

```ts
// Insert first; count only rows that already existed.
const since = new Date(Date.now() - REVEAL_WINDOW_MS);
await db.collection('logs').insertOne({ /* audit row, action: 'secret.reveal', ... */ });

const recent = await db.collection('logs').countDocuments(
  { action: 'secret.reveal', created_at: { $gte: since } },   // drop user_id scoping
);
if (recent > REVEAL_LIMIT) {
  // Always record the attempt for forensics, but refuse the secret.
  return NextResponse.json({ error: 'Reveal rate limit exceeded' },
    { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '900' } });
}
const value = await loadSecret(name);
```

Because the audit write now happens first, a rejected attempt is still logged — which is what you want for an abuse signal. Add a unique index on `(action, created_at)` bucketing or a dedicated `secret_reveal_quota` collection with a TTL if the `logs` scan becomes hot.

---

### M-6 — `nonceWritesSinceCleanup` is per-instance, so nonce cleanup is unreliable
**File:** `dashboard/lib/internal-auth.ts:3, 14-27`

```ts
let nonceWritesSinceCleanup = 0;   // :3  module-global, per serverless instance

nonceWritesSinceCleanup += 1;
if (nonceWritesSinceCleanup >= 100) {   // :15
  nonceWritesSinceCleanup = 0;
  await supabase.from('internal_request_nonces').delete().lt('created_at', cutoff);
}
```

**Root cause.** The counter is per-instance. With many warm instances, each writes 99 nonces before one triggers cleanup, so the effective cleanup threshold is `99 × instanceCount`, not 99. Instances that are recycled before reaching 100 never clean up at all.

**Impact.** The bookkeeping table grows faster than the comment intends and cleanup becomes probabilistic. Not a security hole — replay protection itself is sound (the unique-constraint insert is the actual mechanism, and it works regardless) — but a table designed to be bounded is not.

**Fix.** Decouple cleanup from a local counter. Either schedule it opportunistically against wall-clock, or move it to a single writer:

```ts
// Time-based, so every instance contributes without coordination:
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
  lastCleanup = Date.now();
  void (async () => {
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    await supabase.from('internal_request_nonces').delete().lt('created_at', cutoff);
  })().catch(() => undefined);
}
```

Fire-and-forget is correct here — the nonce insert already established replay protection, so cleanup latency is irrelevant to correctness. A cron job or pg_cron is the cleanest option if the platform supports it.

---

### M-7 — `withShutdownTimeout` resolves `true` on timeout but leaves the operation running
**File:** `packages/shared/src/bot.ts:115-130` (and its use at `:730`)

```ts
export function withShutdownTimeout(operation: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);   // "timed out"
    ...
    operation.then(() => { clearTimeout(timer); resolve(false); }, ...);
  });
}
```

On timeout the helper reports `true` and the caller immediately calls `process.exit(1)` (`bot.ts:764`). The underlying cleanup promise is never cancelled — it continues running until the process dies. That is *intended* (Node gives you no way to abort an in-flight async chain), but the signature returns `false` for "completed" and `true` for "timed out", which is an easy polarity to misread, and the operation's later rejection has no handler attached once the race resolves.

**Impact.** Mostly a readability/robustness smell, but there is a real edge: after timeout the abandoned chain can still reject, producing an `unhandledRejection` in the window between `resolve(true)` and `process.exit(1)`. `installProcessGuards` may turn that into a Sentry event, so a shutdown-timeout incident generates a spurious second error that obscures the first.

**Fix.** Return an explicit result and attach a swallow-handler to the abandoned branch:

```ts
export type ShutdownOutcome = 'completed' | 'timed-out';

export function withShutdownTimeout(operation: Promise<void>, timeoutMs: number): Promise<ShutdownOutcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // The chain cannot be cancelled; make sure its eventual rejection
      // does not surface as an unhandled rejection during process exit.
      operation.catch(() => undefined);
      resolve('timed-out');
    }, timeoutMs);
    timer.unref?.();
    operation.then(() => { clearTimeout(timer); resolve('completed'); },
                   (error) => { clearTimeout(timer); reject(error); });
  });
}
```

---

## Minor

### m-1 — `envBytes`'s "must be base64" branch is unreachable
Same root cause as **M-3** (`secret-vault.ts:42-44`). Listed separately because it is the *same dead-code pattern* in a second location, which suggests it may be copied further.

### m-2 — `controlCache` is never evicted
`packages/shared/src/bot.ts:417, 521-545`. A `Map` with a 15s TTL refreshed on access and never swept. Bounded in practice by guild count, but it grows monotonically with every guild the bot has ever seen.

```ts
if (controlCache.size > 1_000) {
  const now = Date.now();
  for (const [key, entry] of controlCache) {
    if (entry.expiresAt <= now) controlCache.delete(key);
  }
}
```

### m-3 — `logs.stop()` stops only the primary sink
`packages/shared/src/bot.ts:491`: `stop: () => baseSink.stop()`. `shutdown()` compensates at `:750-751`, so the normal path is fine — but the `LogSink` contract is a trap for any other caller. Make it symmetric with `shutdown`.

### m-4 — `stats().flushed` aggregates only the primary sink
`packages/shared/src/bot.ts:492-496`. `buffered` and `failed` sum both sinks; `flushed` reads only `baseSink`. Straightforward inconsistency — sum both.

### m-5 — `buildDashboardEmbed` is typed `| null` but has no null path
`packages/shared/src/bot.ts:262-265, 358`. The guard at `:358` is dead. Either implement an empty-embed check (which would also fix the "Discord 400 on a contentless embed" issue) or drop `| null` from the signature. See also the prior `bot.ts` audit's F-08.

### m-6 — `reason()` sanitises the same option twice
`packages/shared/src/bot.ts:210-213`. Two `getString` and two `sanitizeReason` calls per invocation. Read once into a local:

```ts
reason(fallback) {
  const value = sanitizeReason(interaction.options.getString('reason') ?? undefined);
  return value === 'No reason provided' ? (fallback ?? 'No reason provided') : value;
}
```

### m-7 — `LOCAL_ONLY` uses a strict string compare and fails open
`packages/shared/src/bot.ts:378`: `process.env.LOCAL_ONLY === 'true' ? '127.0.0.1' : undefined`. `LOCAL_ONLY=1` or `TRUE` silently binds to `0.0.0.0`. Fail-safe direction for a flag intended to *restrict* exposure:

```ts
const localOnly = ['true', '1', 'yes'].includes(String(process.env.LOCAL_ONLY).toLowerCase());
host: localOnly ? '127.0.0.1' : undefined,
```

### m-8 — Audit redaction is simultaneously over- and under-inclusive
`packages/shared/src/bot.ts:66, 73`. Line 66 redacts **every** `http(s)://` value, destroying legitimate audit context (which dashboard URL triggered an action). Meanwhile the key-name regex at `:45` only inspects keys, so a secret stored under an innocuous key (`{ note: "MTA5..." }`) is truncated to 512 chars but **not** redacted.

Narrow the URL rule to credential-bearing schemes, and add a value-level token heuristic:

```ts
if (/^(?:mongodb(?:\+srv)?|postgres|redis|rediss):\/\//i.test(input)) return '[redacted]';
if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input)) return '[redacted]';
if (/^[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/.test(input)) return '[redacted]'; // Discord bot token
return input.slice(0, 512);
```

### m-9 — `unlimitedCommands` bypasses the limiter entirely
`packages/shared/src/bot.ts:644-655`. Cyrene marks `['userinfo','serverinfo','about','help']` exempt. The exemption is absolute — a future expensive command added to that list becomes unthrottled with no second line of defence. Grant a much higher limit rather than none.

### m-10 — `cachedHealth` is module-global rather than per-server
`packages/shared/src/health.ts:46-47, 169-172`. One `let cachedHealth` shared by every `startHealthServer` call in a process. `setDependencies` clears it, masking the issue in production (one server per process), but concurrent instances cross-contaminate in tests. Move it inside the closure.

### m-11 — Health endpoint discloses `bot_id`/`version` before dependencies are wired
`packages/shared/src/health.ts:132-135`. Unauthenticated callers normally receive only `{status}`; during the startup window they also get `bot_id` and `version`. Minor fingerprinting surface — return `{status:'starting'}` only.

---

## Informational

### i-1 — Two module-level mutable caches exist in a serverless package
`secret-vault.ts:34` and `vault-client.ts:9` (`packages/shared`, client-side equivalent). Both are per-instance by construction. C-1 is the concrete consequence for the first; the second affects bots, where one-process-per-bot makes it benign today. Worth a comment in both stating the serverless assumption explicitly.

### i-2 — `ephemeral` is deprecated in discord.js 14.27
Verified in `node_modules/discord.js/typings/index.d.ts:7226-7227`: *"@deprecated Use InteractionReplyOptions.flags instead."* Five sites in `bot.ts` (`:168, 593, 605, 609, 620`) plus `responses.ts`. Functional today; a forced fix on the next major. Batch it with other cleanup.

### i-3 — `stats().flushed` / `dropped` semantics differ between the two writers
`log-sink.ts` exposes `{buffered, flushed, failed}`; `XpTracker` exposes `pending` and a separate `dropped`. No shared `BatchWriter` interface is used by both, though the XP tracker's own comment (`xp.ts:12-15`) notes it deliberately avoids `createBatchWriter`. The `write(batch)` hook mentioned in that comment **does** now exist (`log-sink.ts:23`) — so the XP tracker could be simplified, or the comment is stale.

### i-4 — `.claude/worktrees/agent-a2e34e4f16af259c4/` contains a full stale repo copy
A complete duplicate tree from 2026-09-05, including its own `packages/shared`, test files, and `package.json`. It will confuse greps, IDE indexing, and any tooling that walks the repo (it appeared as 6 phantom workspace manifests in my own inventory). Recommend removing it and adding `.claude/worktrees/` to `.gitignore` if it isn't already.

### i-5 — `ensureIndexes` shares the connect retry
`packages/shared/src/db/mongo.ts:178`. Eight `createIndex` calls (three `{unique:true}`) run inside the same `try` as `client.connect()`. A unique-constraint violation on pre-existing bad data is classified as a connection failure, retried (it can never succeed), and the healthy connection is then discarded — the bot runs with no database at all. Split schema prep out of the transport retry. *Flagged in the prior pass; restated here for completeness.*

### i-6 — Hardcoded master ID appears in three layers
`packages/shared/src/bot.ts:44`, `dashboard/lib/authz.ts`, `infra/supabase/schema.sql`, plus `render.yaml` `OWNER_IDS` ×8. Not a credential, but a privilege identifier duplicated with no single source of truth. Rotating the operator requires coordinated edits in four places.

---

## Verified Correct — do not re-litigate

These were actively checked and found sound. Recording them prevents wasted future effort.

| Area | Finding |
|---|---|
| **HMAC** (`dashboard/lib/hmac.ts`) | Constant-time comparison via `timingSafeEqual`, with an explicit length check *before* the call (`:67`) — correct, since `timingSafeEqual` throws on length mismatch. Hex-only timestamp regex, `Number.isSafeInteger` guard, bounded ±300s skew, static failure enum. Textbook. |
| **Internal API** (`internal/secret/[name]/route.ts`) | Per-bot secret isolation requiring *all* bots present, each value strong and **distinct** (`:28-32`); `payload.bot_id !== botId` binds body to header, preventing cross-bot impersonation (`:101`); streaming body cap with `reader.cancel()` (`:47-71`); nonce replay rejection; `BOT_SECRET_ALLOWLIST` 403 before vault access. |
| **Antinuke exemptions** (`bots/zoro/src/lib/enforce.ts:129-157`) | Explicitly documents and implements *"a failed lookup must never become a whitelist bypass"* — the catch returns `false` (untrusted). Positive-only owner/self checks. |
| **Role hierarchy** (`enforce.ts:190-195`) | Filters removable roles by `role.position < botHighest`, excludes `managed` and `@everyone`. This is the exact check most antinuke bots omit and the #1 source of runtime 403s. |
| **Vault crypto** (`secret-vault.ts`) | AES-256-GCM, `scryptSync(N=16384,r=8,p=1)`, 12-byte random IV per seal, auth tag length asserted on both seal and open, 16 KiB plaintext bound. |
| **Queue** (`queue.ts`) | `this.flushing` guard prevents concurrent flushes; timeouts deliberately retain the concurrency slot until the task settles (`:77-79`) so timeouts cannot exceed the cap; timers `unref`'d. I hypothesised an unhandled-rejection bug in the timeout race and **disproved it** — `Promise.race` attaches handlers to both branches. |
| **AI bounds** (`bots/cyrene`) | Prompt capped at 1000 chars, `AbortSignal.timeout` on provider calls, queue timeout + `maxPending`, 1-per-10s per-user cooldown that **fails closed** (`.catch(() => ({ allowed: false }))`, `:160-161`), context window capped at 10 turns via `$slice`. |
| **XP tracker concurrency** (`nami/src/lib/xp.ts`) | The `this.flushing` guard (`:148`) and `flushBatch`'s copy-then-subtract (`:155-174`) correctly prevent double-counting and in-process races. |
| **Type safety** | Zero `as any` / `@ts-ignore` / `@ts-expect-error` repo-wide. The single inline assertion on parsed JSON (`internal/secret/[name]/route.ts:100`) is explicitly validated on the next line. `as unknown as` appears only in tests and one `BigInt` widening. |
| **API authorization** | All 13 dashboard API routes carry an explicit `authorizeMaster` / `authorizeGuild` / `verifyRequest` / `getCurrentUser` check. No unguarded handler found. |
| **`env.ts` memoisation** | `let cached` in `packages/shared/src/env.ts:234` is per-process, which is correct for a bot runtime (one env per process). |

---

## Recommendations, Ordered

**Do first (correctness under failure — all small, low-risk patches):**
1. **C-1** — Version the secret cache against `rotated_at`, or move it to shared Redis. A stale credential after a rotation-for-cause is the worst finding here.
2. **C-2** — Keep the newest entries in `retain()`, and correct the two `onDrop` messages so they describe actual behaviour.
3. **M-2** — Emit one level-up event per crossed level.
4. **M-5** — Insert the audit row *before* the quota check to close the TOCTOU window and count globally.
5. **M-7** — Return an explicit outcome enum and swallow the abandoned branch's rejection.

**Do next (structural, still contained):**
6. **M-1** — Switch XP to `$inc`. Cheap now; a migration headache once data exists.
7. **M-3** — Explicit base64 alphabet validation, for diagnosis quality.
8. **M-6** — Time-based nonce cleanup instead of a per-instance counter.
9. **M-4** — Collapse the two HMAC secret resolvers into one, so the safe path is the only path.

**Then (hygiene, batch into one pass):**
10. All Minor items, plus `i-2` (discord.js deprecation) and `i-4` (delete the stale worktree).

**Architectural note.** Four of the findings (C-1, M-5, M-6, and the earlier `bot.ts` shutdown bug) are the same upstream mistake wearing different hats: **implicitly-shared state treated as local.** The dashboard and the bots both run in environments where a process is not a singleton, and the code repeatedly assumes it is. A short written convention in the repo — *"module-level mutable state is per-instance; anything that must be authoritative across instances belongs in Redis/Postgres"* — would prevent the next four findings at the design stage rather than the review stage. That is a cheaper intervention than fixing them one at a time, and this codebase is well-organised enough that a convention like this would actually stick.

---

*Read-only audit. No files were modified.*
