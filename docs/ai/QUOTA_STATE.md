# EI-point — Quota State

> Current quota posture. No secrets.

## Capacity policy

- `packages/shared/src/capacity.ts` is the central threshold policy: normal
  below 70%, cache/batch at 70%, aggressive optimization at 80%, shed
  non-critical work at 90%, emergency protection at 95%+.
- Invalid quota data fails closed. Critical/security work is retained during
  pressure; optional and non-critical work is shed according to the band.
- Authenticated bot health exposes the observed Redis capacity snapshot;
  public health remains minimal. This is headroom control, not a quota bypass
  or a guarantee of zero exhaustion.


- Status: exhausted at the documented 500000/500000 monthly request quota.
- Impact: Redis calls fail and the runtime uses bounded per-process MemoryKv
  fallback. Fleet-wide rate-limit coordination is weaker until the quota is
  restored, but expensive-provider controls do not become unlimited.
- Operator options: upgrade the plan, reduce heartbeat/request volume, or wait
  for reset while accepting the documented fallback.

## Render and Vercel

- Render services use free-tier deployment/runtime limits and a keep-alive ring.
- Vercel dashboard uses the hobby deployment plan. The repo-local commit author
  must remain `xyanncat` for deployment authorization.

## MongoDB Atlas

- Both configured clusters are paused, so capacity cannot currently be tested.
- No workload redistribution or duplicate database was introduced without
  measured availability and operator approval.

## Telemetry and providers

- Non-critical telemetry and optional providers remain secondary to core
  authorization and durable state. No quota bypass or unauthorized account
  duplication was performed.
