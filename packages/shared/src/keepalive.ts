/**
 * Keep-alive ring ping for free-tier hosting.
 *
 * Render free web services spin down after ~15 minutes without inbound HTTP
 * traffic. Each bot pings one peer bot's `/health` endpoint on a fixed
 * cadence (default 5 min — well under the spin-down window). The peers form
 * a closed ring via the `KEEPALIVE_PING_URL` env var, so every bot receives
 * exactly one inbound ping per cycle and stays awake without any Redis,
 * cron, or external uptime service. An inbound ping also wakes a spun-down
 * peer, so the ring is self-healing: a single awake bot re-seeds the ring.
 *
 * Configuration (all optional — unset `KEEPALIVE_PING_URL` disables):
 *  - `KEEPALIVE_PING_URL`          peer origin, e.g. https://eiflow-nami.onrender.com
 *  - `KEEPALIVE_PING_INTERVAL_SEC` cadence, clamped 60..900 (default 300)
 */

export interface KeepaliveConfig {
  url: string;
  intervalSec: number;
}

export interface KeepaliveEnvSource {
  keepalivePingUrl?: string;
  keepalivePingIntervalSec?: number;
}

export const KEEPALIVE_DEFAULT_INTERVAL_SEC = 300;

/** Pure config parse — exported for tests. Returns null when disabled. */
export function parseKeepaliveConfig(env: KeepaliveEnvSource): KeepaliveConfig | null {
  const raw = env.keepalivePingUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.endsWith('/') ? raw.slice(0, -1) : raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return null;
  }
  const intervalSec = env.keepalivePingIntervalSec ?? KEEPALIVE_DEFAULT_INTERVAL_SEC;
  return { url: url.origin, intervalSec };
}

const PING_TIMEOUT_MS = 10_000;
/** Log a warning only after this many consecutive failures, then every 10th. */
const WARN_AFTER = 3;

export function startKeepalivePing(
  env: KeepaliveEnvSource,
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): NodeJS.Timeout | null {
  const config = parseKeepaliveConfig(env);
  if (!config) return null;

  let failures = 0;
  const ping = async (): Promise<void> => {
    try {
      const response = await fetch(`${config.url}/health`, {
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
        headers: { 'user-agent': 'eiflow-keepalive/1.0' },
      });
      // Any HTTP response proves the peer is awake — even 503 degraded counts.
      if (response.ok) {
        if (failures >= WARN_AFTER) log.info({ peer: config.url }, 'keep-alive ping recovered');
        failures = 0;
        return;
      }
      failures += 1;
    } catch {
      failures += 1;
    }
    if (failures === WARN_AFTER || failures % 10 === 0) {
      log.warn({ peer: config.url, failures }, 'keep-alive ping failing');
    }
  };

  const timer = setInterval(() => {
    void ping();
  }, config.intervalSec * 1000);
  // Node must not be held alive purely by the ring — the Discord gateway and
  // the health server own the process lifetime.
  timer.unref?.();

  // Stagger the first ping so eight simultaneously-deploying bots do not
  // stampede the same peer.
  const firstDelayMs = 30_000 + Math.floor(Math.random() * 60_000);
  const first = setTimeout(() => {
    void ping();
  }, firstDelayMs);
  first.unref?.();

  log.info(
    { peer: config.url, intervalSec: config.intervalSec, firstPingInSec: Math.round(firstDelayMs / 1000) },
    'keep-alive ring ping started',
  );
  return timer;
}
