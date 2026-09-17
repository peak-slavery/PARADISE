# Capacity Manager

> Verified 2026-09-16. This documents the implemented policy; it does not claim provider quotas are available.

`packages/shared/src/capacity.ts` is the central pure capacity policy for Redis, AI providers, search, and background workloads. It records service/provider/resource usage, quota, remaining capacity, utilization, health, cooldown, reset time, and a deterministic policy band.

## Thresholds

| Utilization | Band | Policy |
|---:|---|---|
| `<70%` | `normal` | Admit work normally |
| `70–<80%` | `cache-batch` | Admit, favor cache and batching |
| `80–<90%` | `aggressive-optimization` | Admit non-optional work; defer optional work |
| `90–<95%` | `shed-noncritical` | Retain critical/security/durable/core work; shed essential/optional work |
| `>=95%` | `emergency-protection` | Retain only critical/security work |

Invalid or missing quota data is fail-closed at `emergency-protection`. If a dependency is unhealthy, critical and security work remains admissible while non-critical work is shed.

## Redis integration

The shared `Kv` implementation exposes an optional `capacity()` snapshot. It uses the existing per-process command accounting and configured daily budget; it does not make quota claims beyond observed local usage. Authenticated `/health` diagnostics include `redis_capacity`; public liveness responses remain minimal and expose only status.

The existing Redis failure behavior is preserved: Upstash failures or missing configuration use bounded `MemoryKv`, and rate limits are not removed. The capacity snapshot marks the memory fallback unhealthy so callers can shed optional work rather than treating local fallback as equivalent to distributed capacity.

## Usage contract

Callers should record a snapshot before admitting expensive work and call `decideCapacity(snapshot, priority)`. Priority names map to the operational order in the master directive:

- `critical`: authentication, authorization, recovery
- `security`: moderation, anti-nuke, security controls
- `durable`: permanent user/game state
- `core`: core dashboard and essential durable service paths
- `essential`: important but deferrable bot/provider work
- `optional`: analytics, enrichment, background work

This policy is a headroom mechanism, not a mathematical guarantee of zero quota exhaustion. Provider-specific usage remains responsible for reporting accurate quota and reset data.

## Validation

`packages/shared/src/capacity.test.ts` covers exact threshold boundaries, invalid quota fail-closed behavior, priority shedding, unhealthy dependencies, and deterministic resource tracking.
