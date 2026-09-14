#!/usr/bin/env node
/**
 * Fleet triage — one command that answers "is anything ACTUALLY broken?"
 *
 * The production monitor (npm run monitor:production) is deliberately
 * fail-closed: any down dependency fails the run. That is correct for a
 * gate but useless for diagnosis while the two KNOWN external blockers
 * persist (paused Atlas clusters, exhausted Upstash monthly quota). This
 * script separates signal from noise:
 *
 *   ok            authed health 200, every dependency true
 *   blocked:*     dependency down AND a direct probe of that dependency
 *                 matches the known external blocker signature
 *                 (atlas-pause: TLS alert 80 on the cluster TCP endpoint;
 *                  upstash-quota: "max requests limit exceeded")
 *   down          unauthenticated liveness probe failed — process or
 *                 service unreachable (NOVEL, unless a cold start)
 *   auth-failed   authenticated probe rejected — token mismatch (NOVEL)
 *   novel:*       any other failure, incl. supabase:false (Supabase is the
 *                 system of record; it has no known external blocker)
 *
 * Exit code 0 = healthy or known blockers only; 1 = novel failures found.
 * Credentials are read in-process from the gitignored cred file and never
 * printed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Direct-probe signatures for the two known, user-side external blockers. */
export const KNOWN_BLOCKERS = {
  atlas: {
    test: (message) => /tlsv1 alert internal error|alert number 80|cluster is paused/i.test(message),
    label: 'atlas-pause',
  },
  upstash: {
    test: (message) => /max requests limit exceeded/i.test(message),
    label: 'upstash-quota',
  },
};

/**
 * Pure classifier, exported for tests.
 *
 * @param {object} probe result of one service's two HTTP probes
 * @param {boolean} probe.liveOk unauthenticated /health returned 2xx
 * @param {number|null} probe.liveStatus unauthenticated HTTP status
 * @param {boolean} probe.authedOk authenticated /health returned 2xx or 503
 * @param {number|null} probe.authedStatus authenticated HTTP status
 * @param {object|null} probe.payload authenticated JSON body
 * @param {object} depSignatures per-dependency direct-probe outcome:
 *   { mongo: {up: boolean, known: boolean}, redis: {up: boolean, known: boolean} }
 * @returns {{level: 'ok'|'blocked'|'novel'|'down'|'auth-failed', detail: string, novel: boolean}}
 */
export function classifyBot({ liveOk, liveStatus, authedOk, authedStatus, payload, depSignatures }) {
  if (!liveOk) {
    return { level: 'down', detail: `liveness HTTP ${liveStatus ?? 'unreachable'}`, novel: true };
  }
  if (!authedOk || !payload || typeof payload !== 'object') {
    return {
      level: 'auth-failed',
      detail: `authenticated probe HTTP ${authedStatus ?? 'unreachable'}`,
      novel: true,
    };
  }
  const deps = payload.db_connections ?? {};
  const supabaseOk = deps.supabase === true;
  const downDeps = ['mongo', 'redis'].filter((dep) => deps[dep] !== true);

  if (supabaseOk && downDeps.length === 0) {
    return { level: 'ok', detail: payload.status === 'ok' ? 'all dependencies ready' : String(payload.status), novel: payload.status !== 'ok' };
  }
  if (!supabaseOk) {
    return { level: 'novel', detail: 'supabase down (no known external blocker)', novel: true };
  }

  const blocked = downDeps.filter((dep) => depSignatures[dep]?.known === true);
  const novel = downDeps.filter((dep) => depSignatures[dep]?.known !== true);
  if (novel.length > 0) {
    return {
      level: 'novel',
      detail: `${novel.join(', ')} down without a known blocker signature`,
      novel: true,
    };
  }
  return {
    level: 'blocked',
    detail: blocked
      .map((dep) => `${dep}:${KNOWN_BLOCKERS[dep === 'mongo' ? 'atlas' : 'upstash'].label}`)
      .join(', '),
    novel: false,
  };
}

const SERVICES = [
  { id: 'shanks', url: 'https://eiflow-shanks.onrender.com', header: 'Shanks' },
  { id: 'sanji', url: 'https://eiflow-sanji.onrender.com', header: 'Sanji' },
  { id: 'zoro', url: 'https://eiflow-zoro.onrender.com', header: 'Zoro' },
  { id: 'boahancock', url: 'https://royal-paradise-v2-4ery.onrender.com', header: 'Boa hancock' },
  { id: 'nami', url: 'https://eiflow-nami.onrender.com', header: 'Nami' },
  { id: 'luffy', url: 'https://eiflow-luffy.onrender.com', header: 'Luffy' },
  { id: 'niko-robin', url: 'https://eiflow-niko-robin.onrender.com', header: 'Niko Robin' },
  { id: 'cyrene', url: 'https://cyrene-2ukf.onrender.com', header: 'Cyrene' },
];

function readCredFile() {
  try {
    return readFileSync(path.join(ROOT, 'temp cred.txt'), 'utf8').replace(/\r/g, '');
  } catch {
    return null;
  }
}

function botHealthToken(raw, header) {
  const match = raw.match(new RegExp(`^${header}\\b[\\s\\S]*?- HEALTH_TOKEN=(\\S+)`, 'm'));
  return match?.[1] ?? null;
}

async function probeService(url, token) {
  const liveStart = Date.now();
  let liveOk = false;
  let liveStatus = null;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(30_000) });
    liveStatus = res.status;
    liveOk = res.ok;
  } catch {
    liveOk = false;
  }
  const liveMs = Date.now() - liveStart;

  let authedOk = false;
  let authedStatus = null;
  let payload = null;
  if (token) {
    try {
      const res = await fetch(`${url}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      authedStatus = res.status;
      authedOk = res.status === 200 || res.status === 503;
      payload = await res.json().catch(() => null);
    } catch {
      authedOk = false;
    }
  } else {
    authedOk = false;
    authedStatus = 'no token';
  }
  return { liveOk, liveStatus, liveMs, authedOk, authedStatus, payload };
}

/** Direct dependency probes — run once, shared by every service. */
async function probeDependencies(raw) {
  const signatures = { mongo: { up: false, known: false }, redis: { up: false, known: false } };

  const upstashUrl = raw?.match(/UPSTASH_REDIS_REST_URL="?([^"\n]+)"?/)?.[1];
  const upstashToken = raw?.match(/UPSTASH_REDIS_REST_TOKEN="?([^"\n]+)"?/)?.[1];
  if (upstashUrl && upstashToken) {
    try {
      const res = await fetch(`${upstashUrl.replace(/\/$/, '')}/ping`, {
        headers: { authorization: `Bearer ${upstashToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      signatures.redis.up = res.ok;
      signatures.redis.known = !res.ok && KNOWN_BLOCKERS.upstash.test(body);
    } catch {
      signatures.redis.known = false;
    }
  }

  const mongoUri = raw?.match(/connection string=(mongodb\+srv:\/\/eipoint-render\S+)/)?.[1];
  if (mongoUri) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8_000, tls: true });
      try {
        await client.db('eiflow').command({ ping: 1 });
        signatures.mongo.up = true;
      } catch (err) {
        signatures.mongo.known = KNOWN_BLOCKERS.atlas.test(String(err?.message ?? ''));
      } finally {
        await client.close().catch(() => undefined);
      }
    } catch {
      signatures.mongo.known = false;
    }
  }
  return signatures;
}

async function main() {
  const raw = readCredFile();
  const depSignatures = await probeDependencies(raw);
  const depSummary = [
    `direct mongo probe: ${depSignatures.mongo.up ? 'UP' : `down${depSignatures.mongo.known ? ' (KNOWN: atlas pause signature)' : ''}`}`,
    `direct redis probe: ${depSignatures.redis.up ? 'UP' : `down${depSignatures.redis.known ? ' (KNOWN: upstash quota signature)' : ''}`}`,
  ];
  console.log(depSummary.join(' | '));

  let novel = 0;
  let blocked = 0;
  let okCount = 0;
  for (const svc of SERVICES) {
    const token = raw ? botHealthToken(raw, svc.header) : null;
    const probe = await probeService(svc.url, token);
    const verdict = classifyBot({ ...probe, depSignatures });
    if (verdict.novel) novel += 1;
    else if (verdict.level === 'blocked') blocked += 1;
    else if (verdict.level === 'ok') okCount += 1;

    const deps = probe.payload?.db_connections;
    const depText = deps
      ? ` supa=${deps.supabase} mongo=${deps.mongo} redis=${deps.redis}`
      : '';
    console.log(
      `${svc.id.padEnd(12)} ${verdict.level.toUpperCase().padEnd(11)} ${verdict.detail}${depText} liveness=${probe.liveMs}ms`,
    );
  }

  console.log(
    `\ntriage: ${okCount} ok, ${blocked} blocked (known user-side blockers), ${novel} NOVEL`,
  );
  if (novel > 0) {
    console.log('novel failures present — investigate before touching infrastructure');
    process.exitCode = 1;
  } else {
    console.log('no novel failures — remaining red deps are the known user-side blockers (Atlas resume, Upstash quota)');
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
