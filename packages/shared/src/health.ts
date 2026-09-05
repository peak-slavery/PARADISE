import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import type { Kv } from './redis.js';
import type { TypedSupabase } from './db/supabase.js';
import type { MongoHandle } from './db/mongo.js';
import type { TaskQueue } from './queue.js';

export interface HealthDeps {
  env: Env;
  log: Logger;
  startedAt: number;
  kv: Kv;
  supabase: TypedSupabase | null;
  getMongo: () => MongoHandle | null;
  queue: TaskQueue;
  /** Documents written in the last hour (free-tier write guardrail). */
  writes1h: () => number;
}

export interface HealthBindOptions {
  port: number;
  botId: string;
  version: string;
  startedAt: number;
  log: Logger;
}

export interface HealthServer extends Server {
  setDependencies(deps: HealthDeps): void;
}

export interface HealthPayload {
  status: 'ok' | 'degraded';
  uptime: number;
  version: string;
  bot_id: string;
  ram_mb: number;
  redis_commands_today: number;
  db_write_count_1h: number;
  db_connections: { supabase: boolean; mongo: boolean; redis: boolean };
  queue: { active: number; pending: number; dropped: number };
}

const HEALTH_CACHE_MS = 10_000;
let cachedHealth: { payload: HealthPayload; expiresAt: number } | null = null;

function hasDiagnosticsAccess(req: IncomingMessage): boolean {
  const token = process.env.HEALTH_TOKEN?.trim();
  return Boolean(token && req.headers.authorization === `Bearer ${token}`);
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | false> {
  try {
    return await Promise.race([
      p,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), ms).unref?.()),
    ]);
  } catch {
    return false;
  }
}

async function pingSupabase(db: TypedSupabase | null): Promise<boolean> {
  if (!db) return false;
  const res = await withTimeout(
    db.from('servers').select('id').limit(1).then(({ error }) => !error),
    2_000,
  );
  return res === true;
}

async function pingMongo(getMongo: () => MongoHandle | null): Promise<boolean> {
  const handle = getMongo();
  if (!handle) return false;
  const res = await withTimeout(
    handle.db.command({ ping: 1 }).then(() => true, () => false),
    2_000,
  );
  return res === true;
}

export async function buildHealthPayload(deps: HealthDeps): Promise<HealthPayload> {
  const [supabase, mongo, redis] = await Promise.all([
    pingSupabase(deps.supabase),
    pingMongo(deps.getMongo),
    deps.kv.ping(),
  ]);

  return {
    status: 'ok',
    uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
    version: deps.env.botVersion,
    bot_id: deps.env.botId,
    ram_mb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    redis_commands_today: deps.kv.commandsUsed(),
    db_write_count_1h: deps.writes1h(),
    db_connections: { supabase, mongo, redis },
    queue: deps.queue.stats,
  };
}

/**
 * Minimal HTTP surface for UptimeRobot: GET /health hits every backing service
 * so a degraded bot reports degraded instead of silently 200ing.
 */
export function startHealthServer(options: HealthBindOptions): Promise<HealthServer> {
  let runtimeDeps: HealthDeps | null = null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: string): void => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    const url = (req.url ?? '/').split('?')[0] ?? '/';

    if (url !== '/' && url !== '/health') {
      send(404, JSON.stringify({ error: 'not found' }));
      return;
    }

    const detailed = hasDiagnosticsAccess(req);
    if (!runtimeDeps) {
      send(200, JSON.stringify({ status: 'starting', bot_id: options.botId, version: options.version }));
      return;
    }

    const healthDeps = runtimeDeps;
    const healthPromise =
      cachedHealth && cachedHealth.expiresAt > Date.now()
        ? Promise.resolve(cachedHealth.payload)
        : buildHealthPayload(healthDeps).then((payload) => {
            cachedHealth = { payload, expiresAt: Date.now() + HEALTH_CACHE_MS };
            return payload;
          });

    void healthPromise
      .then((payload) => {
        const anyDown = Object.values(payload.db_connections).some((v) => v === false);
        const status = anyDown ? 'degraded' : 'ok';
        // Liveness vs readiness. An unauthenticated probe (Render, uptime
        // monitors) asks "is this process alive?", which must NOT depend on a
        // dependency being reachable: a transient database blip would
        // otherwise make the platform restart every bot, cancelling the
        // in-process reconnect timer that would have recovered it. The body
        // still reports `degraded`, and authenticated callers keep the true
        // readiness signal (503) so monitoring is not blinded.
        send(
          detailed && anyDown ? 503 : 200,
          JSON.stringify(detailed ? { ...payload, status } : { status }),
        );
      })
      .catch((err: unknown) => {
        healthDeps.log.error({ err }, 'health check failed');
        send(500, JSON.stringify({ status: 'degraded', error: 'health check failed' }));
      });
  });

  const healthServer = server as HealthServer;
  healthServer.setDependencies = (deps: HealthDeps): void => {
    runtimeDeps = deps;
    cachedHealth = null;
  };
  server.on('error', (err) => {
    (runtimeDeps?.log ?? options.log).error({ err }, 'health server error');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '0.0.0.0', () => {
      options.log.info({ port: options.port }, 'health server listening');
      resolve(healthServer);
    });
  });
}
