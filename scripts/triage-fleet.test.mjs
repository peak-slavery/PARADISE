import test from 'node:test';
import assert from 'node:assert/strict';

const { classifyBot, KNOWN_BLOCKERS } = await import('./triage-fleet.mjs');

test('all dependencies up classifies ok and non-novel', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: true,
    authedStatus: 200,
    payload: { status: 'ok', db_connections: { supabase: true, mongo: true, redis: true } },
    depSignatures: { mongo: { up: true, known: false }, redis: { up: true, known: false } },
  });
  assert.equal(verdict.level, 'ok');
  assert.equal(verdict.novel, false);
});

test('mongo and redis down with known signatures classifies blocked, not novel', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: true,
    authedStatus: 503,
    payload: { status: 'degraded', db_connections: { supabase: true, mongo: false, redis: false } },
    depSignatures: {
      mongo: { up: false, known: true },
      redis: { up: false, known: true },
    },
  });
  assert.equal(verdict.level, 'blocked');
  assert.equal(verdict.novel, false);
  assert.match(verdict.detail, /atlas-pause/);
  assert.match(verdict.detail, /upstash-quota/);
});

test('dependency down without a known signature is novel', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: true,
    authedStatus: 503,
    payload: { status: 'degraded', db_connections: { supabase: true, mongo: false, redis: true } },
    depSignatures: { mongo: { up: false, known: false }, redis: { up: true, known: false } },
  });
  assert.equal(verdict.level, 'novel');
  assert.equal(verdict.novel, true);
  assert.match(verdict.detail, /mongo down without a known blocker/);
});

test('supabase down is always novel (system of record, no known blocker)', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: true,
    authedStatus: 503,
    payload: { status: 'degraded', db_connections: { supabase: false, mongo: false, redis: false } },
    depSignatures: {
      mongo: { up: false, known: true },
      redis: { up: false, known: true },
    },
  });
  assert.equal(verdict.level, 'novel');
  assert.equal(verdict.novel, true);
});

test('failed liveness probe classifies down and novel', () => {
  const verdict = classifyBot({
    liveOk: false,
    liveStatus: 0,
    authedOk: false,
    authedStatus: null,
    payload: null,
    depSignatures: { mongo: { up: false, known: true }, redis: { up: false, known: true } },
  });
  assert.equal(verdict.level, 'down');
  assert.equal(verdict.novel, true);
});

test('missing or rejected auth token classifies auth-failed and novel', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: false,
    authedStatus: 'no token',
    payload: null,
    depSignatures: { mongo: { up: true, known: false }, redis: { up: true, known: false } },
  });
  assert.equal(verdict.level, 'auth-failed');
  assert.equal(verdict.novel, true);
  assert.match(verdict.detail, /no token/);
});

test('a platform-suspended service is blocked, never novel', () => {
  // Render serves a suspension page instead of reaching our process. This must
  // not be reported as an application failure, or operators will debug code
  // that never ran.
  const verdict = classifyBot({
    liveOk: false,
    liveStatus: 503,
    suspended: true,
    authedOk: false,
    authedStatus: 'service suspended',
    payload: null,
    depSignatures: { mongo: { up: false, known: true }, redis: { up: false, known: true } },
  });
  assert.equal(verdict.level, 'blocked');
  assert.equal(verdict.novel, false);
  assert.match(verdict.detail, /suspended/);
});

test('suspension classification takes precedence over the down verdict', () => {
  const suspended = classifyBot({
    liveOk: false,
    liveStatus: 503,
    suspended: true,
    authedOk: false,
    authedStatus: null,
    payload: null,
    depSignatures: { mongo: { up: false, known: true }, redis: { up: false, known: true } },
  });
  const notSuspended = classifyBot({
    liveOk: false,
    liveStatus: 503,
    suspended: false,
    authedOk: false,
    authedStatus: null,
    payload: null,
    depSignatures: { mongo: { up: false, known: true }, redis: { up: false, known: true } },
  });
  assert.equal(suspended.level, 'blocked');
  assert.equal(notSuspended.level, 'down');
  assert.equal(notSuspended.novel, true);
});

test('known-blocker signature matchers recognize the production error strings', () => {
  assert.ok(
    KNOWN_BLOCKERS.atlas.test(
      'tlsv1 alert internal error:ssl3_read_bytes:tlsv1 alert internal error:SSL alert number 80',
    ),
  );
  assert.ok(KNOWN_BLOCKERS.atlas.test('Cluster is paused'));
  assert.ok(!KNOWN_BLOCKERS.atlas.test('connection timeout'));
  assert.ok(
    KNOWN_BLOCKERS.upstash.test(
      'ERR max requests limit exceeded. Limit: 500000, Usage: 500000',
    ),
  );
  assert.ok(!KNOWN_BLOCKERS.upstash.test('PONG'));
  assert.ok(!KNOWN_BLOCKERS.upstash.test('WRONGTYPE error'));
});

test('degraded status with all deps up is surfaced as novel', () => {
  const verdict = classifyBot({
    liveOk: true,
    liveStatus: 200,
    authedOk: true,
    authedStatus: 200,
    payload: { status: 'degraded', db_connections: { supabase: true, mongo: true, redis: true } },
    depSignatures: { mongo: { up: true, known: false }, redis: { up: true, known: false } },
  });
  assert.equal(verdict.level, 'ok');
  assert.equal(verdict.novel, true);
});
