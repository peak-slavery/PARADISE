# EI-point — Infrastructure State

> Verified infrastructure posture. No secrets.

## Dashboard

- Vercel dashboard is deployed at `https://ei-point-dashboard.vercel.app`.
- Unauthenticated `/api/health` is liveness-only and returns HTTP 200 by design.
- Production authentication and demo-mode gates are fail-closed in code.

## Discord bots

- Eight Render services are deployed and respond on their health endpoints.
- The keep-alive ring is configured across the fleet.
- Command scopes were previously verified with public commands global and the
  operator command restricted to the development guild.
- Real interaction testing remains blocked by MongoDB availability.

## MongoDB

- Primary and secondary Atlas clusters are configured but currently paused.
- Index definitions are centralized in `infra/mongo/indexes.cjs` and consumed by
  the shared runtime. Index bootstrap failures return no usable Mongo handle.

## Supabase

- Supabase is the authoritative identity, authorization, guild, configuration,
  and security-state store.
- Migration 0002 is present locally but awaits production application.

## Redis

- Upstash is used for ephemeral rate limits, cooldowns, counters, and caches.
- Runtime fallback is bounded MemoryKv; it does not fabricate durable state.

## Other providers

- Cloudflare, Firebase, AWS, and Sentry are not authoritative stores for core
  identity or economy state. No new provider was introduced in this audit pass.
