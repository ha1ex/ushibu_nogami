import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/store-core.js', import.meta.url), 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'store-core.js' });
const Core = sandbox.StoreCore;
const plain = (value) => JSON.parse(JSON.stringify(value));

const first = {
  mutationId: 'A234567890123456',
  operations: [{ type: 'note.set', key: 'match-m01-note', value: 'offline' }]
};
const second = {
  mutationId: 'B234567890123456',
  operations: [{ type: 'check.set', key: 'action-m01-confirm-time', value: true }]
};

test('outbox append is immutable and preserves FIFO mutations', () => {
  const original = [first];
  const next = Core.appendMutation(original, second);
  assert.notStrictEqual(next, original);
  assert.deepEqual(plain(original), [first]);
  assert.deepEqual(plain(next), [first, second]);
  assert.notStrictEqual(next[0], first);
});

test('client mutation validation enforces the explicit 128-character key boundary', () => {
  const longKey = 'k'.repeat(129);
  const allowed = { checks: new Set([longKey]), notes: new Set(), scores: new Set() };
  assert.throws(() => Core.validateMutation({
    mutationId: 'K234567890123456',
    operations: [{ type: 'check.set', key: longKey, value: true }]
  }, allowed), /key|128/i);
});

test('server base is replayed through every pending mutation in order', () => {
  const base = { checks: {}, notes: { 'match-m01-note': 'server' }, scores: {} };
  const later = {
    mutationId: 'C234567890123456',
    operations: [{ type: 'note.set', key: 'match-m01-note', value: 'latest' }]
  };
  const visible = Core.replay(base, [first, second, later]);
  assert.deepEqual(plain(visible), {
    checks: { 'action-m01-confirm-time': true }, notes: { 'match-m01-note': 'latest' }, scores: {}
  });
  assert.deepEqual(base, { checks: {}, notes: { 'match-m01-note': 'server' }, scores: {} });
});

test('ack removes exactly the matching first mutation and keeps monotonic revision', () => {
  const model = { base: { checks: {}, notes: {}, scores: {} }, outbox: [first, second], revision: 12 };
  const acknowledged = Core.acknowledge(model, first.mutationId, 4);
  assert.deepEqual(plain(acknowledged.outbox), [second]);
  assert.equal(acknowledged.revision, 12);
  assert.equal(acknowledged.base.notes['match-m01-note'], 'offline');
  assert.throws(() => Core.acknowledge(model, second.mutationId, 13), /first|FIFO/i);
});

test('score apply is typed and does not alias caller objects', () => {
  const value = { ours: 13, theirs: 9, played: true };
  const result = Core.applyOperations({ checks: {}, notes: {}, scores: {} }, [
    { type: 'score.set', key: 'match-m01-score', value }
  ]);
  value.ours = 0;
  assert.deepEqual(plain(result.scores['match-m01-score']), { ours: 13, theirs: 9, played: true });
});

test('outbox ownership isolates another user and restores the same user pending list', () => {
  const switched = Core.selectUserOutbox({
    current: [first], ownerId: 'alice', userId: 'tester', restored: [second]
  });
  assert.deepEqual(plain(switched.active), [second]);
  assert.deepEqual(plain(switched.archive), { userId: 'alice', outbox: [first] });
  assert.deepEqual(plain(switched.quarantine), []);

  const sameUser = Core.selectUserOutbox({ current: [first], ownerId: 'tester', userId: 'tester', restored: [] });
  assert.deepEqual(plain(sameUser.active), [first]);
  assert.equal(sameUser.archive, null);

  const unowned = Core.selectUserOutbox({ current: [first], ownerId: null, userId: 'tester', restored: [] });
  assert.deepEqual(plain(unowned.active), []);
  assert.deepEqual(plain(unowned.quarantine), [first]);
});
