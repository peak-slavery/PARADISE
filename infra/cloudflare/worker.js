/**
 * Ei Link Watchdog primary runner for Cloudflare Workers.
 *
 * The Worker is intentionally dependency-light. It imports the same core used
 * by the OCI runner and uses a Durable Object for durable, redacted state.
 * Tokens, recovery credentials, and bot URLs are runtime bindings only.
 */
import {
  DEFAULT_AUDIT_RETENTION,
  DEFAULT_EXPECTED_BOT_IDS,
  runWatchdogCycle,
} from '../../scripts/watchdog-core.mjs';

const EXPECTED_BOT_IDS = [...DEFAULT_EXPECTED_BOT_IDS];
export const WATCHDOG_CRON = '*/5 * * * *';
const STATE_KEY = 'watchdog-state-v2';
const AUDIT_KEY = 'watchdog-audit-v2';

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function requiredSecret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalText(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function healthUrl(env, botId) {
  const name = `${botId.toUpperCase().replace(/-/g, '_')}_URL`;
  const value = optionalText(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function healthUrls(env) {
  const urls = {};
  for (const botId of EXPECTED_BOT_IDS) {
    urls[botId] = healthUrl(env, botId);
  }
  return urls;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseState(value) {
  return value && typeof value === 'object' ? value : null;
}

function parseAudit(value) {
  return value && Array.isArray(value.events) ? value : { events: [] };
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    },
  });
}

function recoveryConfig(env) {
  const enabled = optionalText(env, 'WATCHDOG_RECOVERY_ENABLED') === 'true';
  return {
    enabled,
    url: optionalText(env, 'WATCHDOG_RECOVERY_URL'),
    token: env.WATCHDOG_RECOVERY_TOKEN,
    allowedHost: optionalText(env, 'WATCHDOG_RECOVERY_HOST'),
    fetchImpl: fetch,
    timeoutMs: positiveInteger(env.WATCHDOG_RECOVERY_TIMEOUT_MS, 10_000),
  };
}

function redactError(error) {
  const message = safeError(error);
  if (/invalid|malformed|missing|unexpected/i.test(message)) return 'invalid_contract';
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  if (/fetch|network|connection|socket/i.test(message)) return 'network';
  return 'runner_error';
}

class WatchdogObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.lock = Promise.resolve();
  }

  async withLock(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'ei-link-watchdog' });
    }
    if (url.pathname !== '/run' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    return this.withLock(() => this.run());
  }

  async run() {
    const now = new Date();
    const [storedState, storedAudit] = await Promise.all([
      this.state.storage.get(STATE_KEY),
      this.state.storage.get(AUDIT_KEY),
    ]);
    const previousState = parseState(storedState);
    const previousAudit = parseAudit(storedAudit);
    const tokens = parseJson(
      requiredSecret(this.env, 'BOT_HEALTH_TOKENS_JSON'),
      'BOT_HEALTH_TOKENS_JSON',
    );
    const urls = healthUrls(this.env);
    const timeoutMs = positiveInteger(this.env.WATCHDOG_TIMEOUT_MS, 10_000);
    const cycle = await runWatchdogCycle({
      expectedBotIds: EXPECTED_BOT_IDS,
      tokens,
      urls,
      previousState,
      fetchImpl: fetch,
      recovery: recoveryConfig(this.env),
      now,
      timeoutMs,
    });

    const retention = positiveInteger(
      this.env.WATCHDOG_AUDIT_RETENTION,
      DEFAULT_AUDIT_RETENTION,
    );
    const events = [...previousAudit.events, ...cycle.audit.events].slice(-retention);
    const audit = {
      generated_at: now.toISOString(),
      schema_version: 1,
      events,
    };
    await Promise.all([
      this.state.storage.put(STATE_KEY, cycle.state),
      this.state.storage.put(AUDIT_KEY, audit),
    ]);
    return jsonResponse({
      status: cycle.results.every((item) => item.ok) ? 'ok' : 'degraded',
      ready: cycle.results.filter((item) => item.ok).length,
      total: cycle.results.length,
      summary: cycle.summary,
    });
  }
}

export { WatchdogObject };

export default {
  async fetch(request, env, context) {
    const id = env.WATCHDOG_STATE.idFromName('primary');
    const object = env.WATCHDOG_STATE.get(id);
    try {
      return await object.fetch(request);
    } catch (error) {
      console.warn(`watchdog request failed: ${redactError(error)}`);
      return jsonResponse({ status: 'error', error: redactError(error) }, 500);
    }
  },

  async scheduled(event, env, context) {
    const id = env.WATCHDOG_STATE.idFromName('primary');
    const object = env.WATCHDOG_STATE.get(id);
    try {
      const response = await object.fetch(new Request('https://watchdog.internal/run', {
        method: 'POST',
      }));
      const payload = await response.clone().json().catch(() => null);
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error ?? `watchdog HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      console.warn(`watchdog scheduled run failed: ${redactError(error)}`);
      return { status: 'error', error: redactError(error) };
    }
  },
};
