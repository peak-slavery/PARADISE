import test from 'node:test';
import assert from 'node:assert/strict';
import { reportMongoReadiness } from './mongo-readiness.mjs';

test('mongo readiness reports missing URIs without secrets', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (value) => logs.push(value);
  try {
    assert.equal(await reportMongoReadiness('Primary Mongo', undefined), false);
    assert.deepEqual(logs, ['Primary Mongo: missing valid mongodb+srv URI']);
  } finally {
    console.log = originalLog;
  }
});
