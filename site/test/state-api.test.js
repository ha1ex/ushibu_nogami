import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operations = JSON.parse(await readFile(new URL('../assets/data/operations.json', import.meta.url), 'utf8'));
const Core = await import('../lib/state-core.js');
const { createStateHandler } = await import('../api/state.js');
const { runStateMutationCas, readTeamSnapshot, StateConflictError } = await import('../api/_store.js');

const allowed = Core.deriveAllowedKeys(operations);
const user = { id: 'tester', nick: 'Тестер', hash: 'unused', sessionVersion: 1 };

function mutation(suffix, key = 'action-m01-confirm-time', value = true) {
  return {
    mutationId: `mutation_${String(suffix).padStart(16, '0')}`,
    operations: [{ type: 'check.set', key, value }]
  };
}

function memoryAdapter(initial = null) {
  let value = initial === null ? null : structuredClone(initial);
  let generation = initial === null ? 0 : 1;
  let writes = 0;
  return {
    async read() {
      return value === null ? { exists: false, etag: null, value: null } : {
        exists: true, etag: `etag-${generation}`, value: structuredClone(value)
      };
    },
    async create(next) {
      writes += 1;
      if (value !== null) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      value = structuredClone(next); generation += 1;
    },
    async replace(etag, next) {
      writes += 1;
      if (etag !== `etag-${generation}`) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      value = structuredClone(next); generation += 1;
    },
    isConflict(error) { return error && error.code === 'conflict'; },
    value() { return structuredClone(value); },
    writes() { return writes; }
  };
}

test('CAS duplicate returns original revision without a second write', async () => {
  const adapter = memoryAdapter();
  const first = await runStateMutationCas({ adapter, allowlist: allowed }, mutation(1));
  const duplicate = await runStateMutationCas({ adapter, allowlist: allowed }, mutation(1));
  assert.deepEqual(first, { revision: 1, duplicate: false });
  assert.deepEqual(duplicate, { revision: 1, duplicate: true });
  assert.equal(adapter.writes(), 1);
});

test('concurrent different-key writers preserve both changes after a CAS retry', async () => {
  const base = Core.createEmptyDocument();
  const adapter = memoryAdapter(base);
  let blockedReads = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const originalRead = adapter.read;
  adapter.read = async () => {
    const snapshot = await originalRead();
    blockedReads += 1;
    if (blockedReads <= 2) {
      if (blockedReads === 2) release();
      await barrier;
    }
    return snapshot;
  };
  const [one, two] = await Promise.all([
    runStateMutationCas({ adapter, allowlist: allowed }, mutation(1, 'action-m01-confirm-time')),
    runStateMutationCas({ adapter, allowlist: allowed }, mutation(2, 'action-m01-confirm-lineup'))
  ]);
  assert.deepEqual([one.revision, two.revision].sort(), [1, 2]);
  assert.equal(adapter.value().checks['action-m01-confirm-time'], true);
  assert.equal(adapter.value().checks['action-m01-confirm-lineup'], true);
  assert.equal(adapter.value().revision, 2);
});

test('three write conflicts are exactly three total attempts and become a conflict error', async () => {
  let writes = 0;
  const adapter = {
    read: async () => ({ exists: true, etag: 'same', value: Core.createEmptyDocument() }),
    replace: async () => { writes += 1; throw Object.assign(new Error('conflict'), { code: 'conflict' }); },
    create: async () => { throw new Error('not used'); },
    isConflict: (error) => error && error.code === 'conflict'
  };
  await assert.rejects(
    () => runStateMutationCas({ adapter, allowlist: allowed }, mutation(3)),
    StateConflictError
  );
  assert.equal(writes, 3);
});

test('read failures and corrupt v4 documents fail closed', async () => {
  await assert.rejects(() => readTeamSnapshot({
    adapter: { read: async () => { throw new Error('private outage'); } }, allowlist: allowed
  }), /unavailable/i);
  await assert.rejects(() => readTeamSnapshot({
    adapter: { read: async () => ({ exists: true, etag: 'bad', value: { version: 4, checks: {} } }) }, allowlist: allowed
  }), /unavailable/i);
});

function createHandler(overrides = {}) {
  return createStateHandler({
    authenticate: async () => user,
    allowlist: allowed,
    readState: async () => ({ document: Core.createEmptyDocument() }),
    mutateState: async () => ({ revision: 1, duplicate: false }),
    ...overrides
  });
}

test('state GET has the exact public v4 response and no internal fields', async () => {
  const document = {
    ...Core.createEmptyDocument(), revision: 7,
    checks: { 'action-m01-confirm-time': true }, notes: { 'match-m01-note': 'ok' },
    scores: { 'match-m01-score': { ours: 13, theirs: 9, played: true } },
    history: [{ mutationId: 'A234567890123456', revision: 7 }]
  };
  const response = await createHandler({ readState: async () => ({ document, etag: 'secret' }) })
    .fetch(new Request('https://hq.test/api/state'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    me: { id: 'tester', nick: 'Тестер' },
    state: { checks: document.checks, notes: document.notes, scores: document.scores },
    revision: 7
  });
});

test('state method, auth, Origin and body limits map to exact generic errors', async () => {
  const unauthorized = createHandler({ authenticate: async () => null });
  assert.equal((await unauthorized.fetch(new Request('https://hq.test/api/state'))).status, 401);
  const handler = createHandler();
  const method = await handler.fetch(new Request('https://hq.test/api/state', { method: 'PUT' }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, POST');

  const body = JSON.stringify(mutation(4));
  for (const origin of [undefined, 'https://evil.test']) {
    const headers = { 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    const response = await handler.fetch(new Request('https://hq.test/api/state', { method: 'POST', headers, body }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden_origin' });
  }

  const exact = '{}'.padEnd(32768, ' ');
  const boundary = await handler.fetch(new Request('https://hq.test/api/state', {
    method: 'POST', headers: { origin: 'https://hq.test', 'content-type': 'application/json' }, body: exact
  }));
  assert.equal(boundary.status, 400);
  const oversized = await handler.fetch(new Request('https://hq.test/api/state', {
    method: 'POST', headers: { origin: 'https://hq.test', 'content-type': 'application/json' }, body: exact + ' '
  }));
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'payload_too_large' });
});

test('state POST accepts only the validated mutation and never leaks storage details', async () => {
  let received;
  const handler = createHandler({ mutateState: async (value) => { received = value; return { revision: 9, duplicate: false }; } });
  const response = await handler.fetch(new Request('https://hq.test/api/state', {
    method: 'POST', headers: { origin: 'https://hq.test', 'content-type': 'application/json' },
    body: JSON.stringify(mutation(5))
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(received, mutation(5));
  assert.deepEqual(await response.json(), { ok: true, revision: 9 });

  const broken = createHandler({ mutateState: async () => { throw new Error('/private/state/team.json etag secret'); } });
  const failed = await broken.fetch(new Request('https://hq.test/api/state', {
    method: 'POST', headers: { origin: 'https://hq.test', 'content-type': 'application/json' },
    body: JSON.stringify(mutation(6))
  }));
  assert.equal(failed.status, 502);
  const text = await failed.text();
  assert.deepEqual(JSON.parse(text), { error: 'state_unavailable' });
  assert.doesNotMatch(text, /private|etag|detail|secret/i);
});

test('state maps exhausted CAS to 409 without internal detail', async () => {
  const handler = createHandler({ mutateState: async () => { throw new StateConflictError(); } });
  const response = await handler.fetch(new Request('https://hq.test/api/state', {
    method: 'POST', headers: { origin: 'https://hq.test', 'content-type': 'application/json' }, body: JSON.stringify(mutation(7))
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'conflict' });
});
