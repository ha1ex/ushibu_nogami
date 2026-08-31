import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operations = JSON.parse(await readFile(new URL('../assets/data/operations.json', import.meta.url), 'utf8'));
const Core = await import('../lib/state-core.js');
const allowed = Core.deriveAllowedKeys(operations);
const id = (suffix = '0000000000000000') => `mutation_${suffix}`.slice(0, 64);

test('allowlist is derived from operations, including actions and the training report', () => {
  assert.ok(allowed.checks.has('action-m01-confirm-time'));
  assert.ok(allowed.checks.has('action-training-inferno-report'));
  assert.ok(allowed.checks.has('training-inferno-report-complete'));
  assert.ok(allowed.notes.has('match-m01-note'));
  assert.ok(allowed.notes.has('opponent-pocelui-note'));
  assert.ok(allowed.notes.has('map-dust-2-note'));
  assert.ok(allowed.notes.has('training-inferno-report'));
  assert.ok(allowed.scores.has('match-m01-score'));
  assert.equal(allowed.checks.has('__proto__'), false);
});

test('mutation validation enforces exact root, operation and ID shapes', () => {
  const valid = {
    mutationId: 'A234567890123456',
    operations: [{ type: 'check.set', key: 'action-m01-confirm-time', value: true }]
  };
  assert.deepEqual(Core.validateMutation(valid, allowed), valid);
  for (const mutationId of ['123456789012345', 'a'.repeat(65), 'unsafe/id-1234567', 'кириллица12345678']) {
    assert.throws(() => Core.validateMutation({ ...valid, mutationId }, allowed), /mutation/i);
  }
  assert.throws(() => Core.validateMutation({ ...valid, extra: true }, allowed), /shape|field/i);
  assert.throws(() => Core.validateMutation({ ...valid, operations: [] }, allowed), /operations/i);
  assert.throws(() => Core.validateMutation({ ...valid, operations: Array(51).fill(valid.operations[0]) }, allowed), /operations/i);
  assert.throws(() => Core.validateMutation({ ...valid, operations: [{ ...valid.operations[0], extra: 1 }] }, allowed), /shape|field/i);
  assert.throws(() => Core.validateMutation({ ...valid, operations: [{ ...valid.operations[0], key: '__proto__' }] }, allowed), /key/i);
  const longKey = 'k'.repeat(129);
  const extended = { checks: new Set([...allowed.checks, longKey]), notes: allowed.notes, scores: allowed.scores };
  assert.throws(() => Core.validateMutation({
    ...valid, operations: [{ type: 'check.set', key: longKey, value: true }]
  }, extended), /key|128/i);
});

test('check, Unicode note and structured score boundaries are strict', () => {
  const mutation = (operation) => ({ mutationId: 'B234567890123456', operations: [operation] });
  assert.equal(Core.validateMutation(mutation({ type: 'note.set', key: 'match-m01-note', value: '😀'.repeat(2000) }), allowed).operations[0].value.length, 4000);
  assert.throws(() => Core.validateMutation(mutation({ type: 'note.set', key: 'match-m01-note', value: '😀'.repeat(2001) }), allowed), /note|2000/i);
  assert.throws(() => Core.validateMutation(mutation({ type: 'check.set', key: 'action-m01-confirm-time', value: 1 }), allowed), /boolean/i);
  assert.deepEqual(Core.validateMutation(mutation({
    type: 'score.set', key: 'match-m01-score', value: { ours: 0, theirs: 99, played: true }
  }), allowed).operations[0].value, { ours: 0, theirs: 99, played: true });
  for (const value of [
    { ours: -1, theirs: 9, played: true },
    { ours: 13.5, theirs: 9, played: true },
    { ours: 13, theirs: 100, played: true },
    { ours: 13, theirs: 9, played: 1 },
    { ours: 13, theirs: 9, played: true, extra: true }
  ]) assert.throws(() => Core.validateMutation(mutation({ type: 'score.set', key: 'match-m01-score', value }), allowed), /score/i);
});

test('operations apply in array order and duplicate IDs keep their original revision', () => {
  const empty = Core.createEmptyDocument();
  const mutation = {
    mutationId: 'C234567890123456',
    operations: [
      { type: 'note.set', key: 'match-m01-note', value: 'first' },
      { type: 'note.set', key: 'match-m01-note', value: 'last' },
      { type: 'check.set', key: 'action-m01-confirm-time', value: true }
    ]
  };
  const first = Core.applyMutation(empty, mutation);
  assert.equal(first.document.revision, 1);
  assert.equal(first.document.notes['match-m01-note'], 'last');
  assert.equal(first.document.checks['action-m01-confirm-time'], true);
  const duplicate = Core.applyMutation(first.document, mutation);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.revision, 1);
  assert.strictEqual(duplicate.document, first.document);
});

test('history retains the last 256 mutation revisions', () => {
  let document = Core.createEmptyDocument();
  for (let index = 0; index < 260; index += 1) {
    document = Core.applyMutation(document, {
      mutationId: `history_${String(index).padStart(16, '0')}`,
      operations: [{ type: 'check.set', key: 'action-m01-confirm-time', value: index % 2 === 0 }]
    }).document;
  }
  assert.equal(document.history.length, 256);
  assert.equal(document.history[0].mutationId, 'history_0000000000000004');
  assert.equal(document.history.at(-1).revision, 260);
});

test('v3 conversion keeps compatible values and strictly migrates score text', () => {
  const source = {
    checks: { 'action-m01-confirm-time': true, unknown: true, 'action-m01-confirm-lineup': false },
    notes: {
      'match-m01-note': 'confirmed',
      'training-inferno-report': 'five attended',
      'match-m01-score': '13:9',
      'match-m02-score': 'won 13:9',
      unknown: 'drop me'
    }
  };
  const converted = Core.convertV3(source, allowed);
  assert.deepEqual({ ...converted.document.checks }, { 'action-m01-confirm-time': true });
  assert.deepEqual({ ...converted.document.notes }, {
    'match-m01-note': 'confirmed', 'training-inferno-report': 'five attended'
  });
  assert.deepEqual({ ...converted.document.scores }, {
    'match-m01-score': { ours: 13, theirs: 9, played: true }
  });
  assert.equal(converted.document.revision, 0);
  assert.deepEqual(converted.report.kept.scores, ['match-m01-score']);
  assert.ok(converted.report.dropped.some((entry) => entry.key === 'match-m02-score' && entry.reason === 'incompatible_score'));
  assert.ok(converted.report.dropped.some((entry) => entry.key === 'unknown'));
});

test('v4 parser fails closed on corrupt state instead of sanitizing it', () => {
  const valid = Core.createEmptyDocument();
  assert.equal(Core.parseStoredDocument(valid, allowed).document.version, 4);
  for (const changed of [
    { ...valid, revision: -1 },
    { ...valid, checks: { unknown: true } },
    { ...valid, notes: { 'match-m01-note': '' } },
    { ...valid, scores: { 'match-m01-score': { ours: 100, theirs: 0, played: true } } },
    { ...valid, history: [{ mutationId: 'D234567890123456', revision: 1 }] }
  ]) assert.throws(() => Core.parseStoredDocument(changed, allowed), /state|document|revision|key|score|history/i);
});

test('v4 history is the contiguous retained suffix ending at document revision', () => {
  const base = Core.createEmptyDocument();
  for (const changed of [
    { ...base, revision: 2, history: [{ mutationId: 'A234567890123456', revision: 1 }] },
    { ...base, revision: 1000, history: [{ mutationId: 'A234567890123456', revision: 1000 }] },
    { ...base, revision: 3, history: [
      { mutationId: 'A234567890123456', revision: 1 },
      { mutationId: 'B234567890123456', revision: 3 }
    ] }
  ]) assert.throws(() => Core.parseStoredDocument(changed, allowed), /history/i);

  const retained = {
    ...base,
    revision: 258,
    history: Array.from({ length: 256 }, (_, index) => ({
      mutationId: `suffix_${String(index).padStart(16, '0')}`,
      revision: index + 3
    }))
  };
  assert.equal(Core.parseStoredDocument(retained, allowed).document.history[0].revision, 3);
});
