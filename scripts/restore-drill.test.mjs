import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRestoreParity } from './restore-drill.mjs';

const SOURCE = [
  { _id: 'a', bot_id: 'shanks', action: 'ban', level: 'info', message: 'first' },
  { _id: 'b', bot_id: 'zoro', action: 'purge', level: 'warn', message: 'second' },
];

/** Docs as the drill inserts them: `_id` dropped, `restored_at` added. */
const restoredFrom = (rows, timestamp = new Date('2026-09-16T00:00:00Z')) =>
  rows.map(({ _id, ...row }) => ({ ...row, restored_at: timestamp }));

test('an intact restore passes parity', () => {
  assert.equal(verifyRestoreParity(SOURCE, restoredFrom(SOURCE)), '');
});

test('order does not affect parity', () => {
  const reversed = [...SOURCE].reverse();
  assert.equal(verifyRestoreParity(SOURCE, restoredFrom(reversed)), '');
});

test('a corrupted field value fails parity despite matching counts', () => {
  // This is the exact gap count-only verification missed.
  const corrupted = restoredFrom(SOURCE);
  corrupted[0].message = 'CORRUPTED';
  assert.equal(corrupted.length, SOURCE.length, 'count still matches');
  assert.match(verifyRestoreParity(SOURCE, corrupted), /does not match the exported source record/);
});

test('a truncated restore fails parity', () => {
  assert.match(verifyRestoreParity(SOURCE, restoredFrom(SOURCE.slice(0, 1))), /count mismatch/);
});

test('an injected extra field fails parity', () => {
  const injected = restoredFrom(SOURCE);
  injected[0].unexpected = 'injected';
  assert.match(verifyRestoreParity(SOURCE, injected), /does not match the exported source record/);
});

test('a changed value type fails parity', () => {
  const retyped = restoredFrom(SOURCE);
  retyped[0].level = 42;
  assert.match(verifyRestoreParity(SOURCE, retyped), /does not match the exported source record/);
});

test('a lost field fails parity', () => {
  const dropped = restoredFrom(SOURCE);
  delete dropped[1].message;
  assert.match(verifyRestoreParity(SOURCE, dropped), /does not match the exported source record/);
});

test('empty batches are parity-clean rather than falsely failing', () => {
  assert.equal(verifyRestoreParity([], []), '');
});
