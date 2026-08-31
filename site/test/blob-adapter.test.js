import assert from 'node:assert/strict';
import test from 'node:test';

const { createBlobJsonAdapter, CasConflictError } = await import('../api/_blob-json.js');

test('private Blob adapter reads uncached and uses result.blob.etag', async () => {
  const calls = [];
  const adapter = createBlobJsonAdapter({
    get: async (...args) => {
      calls.push(args);
      return {
        statusCode: 200,
        stream: new Response('{"version":4}').body,
        blob: { etag: 'nested-etag' }
      };
    },
    put: async () => { throw new Error('not used'); },
    PreconditionError: class extends Error {}
  });
  assert.deepEqual(await adapter.read('state/team.json'), {
    exists: true, etag: 'nested-etag', value: { version: 4 }
  });
  assert.deepEqual(calls, [['state/team.json', { access: 'private', useCache: false }]]);
});

test('private Blob adapter creates exclusively and replaces with ifMatch', async () => {
  const calls = [];
  const adapter = createBlobJsonAdapter({
    get: async () => null,
    put: async (...args) => { calls.push(args); return { etag: 'next' }; },
    PreconditionError: class extends Error {}
  });
  await adapter.create('state/team.json', { version: 4 });
  await adapter.replace('state/team.json', 'old-etag', { version: 4, revision: 1 });
  assert.deepEqual(calls[0], [
    'state/team.json', '{"version":4}',
    { access: 'private', addRandomSuffix: false, contentType: 'application/json', allowOverwrite: false }
  ]);
  assert.deepEqual(calls[1], [
    'state/team.json', 'old-etag' && '{"version":4,"revision":1}',
    { access: 'private', addRandomSuffix: false, contentType: 'application/json', allowOverwrite: true, ifMatch: 'old-etag' }
  ]);
});

test('replace classifies only precondition errors as conflicts', async () => {
  class PreconditionError extends Error {}
  const conflict = createBlobJsonAdapter({
    get: async () => null,
    put: async () => { throw new PreconditionError('etag mismatch'); },
    PreconditionError
  });
  await assert.rejects(() => conflict.replace('state/team.json', 'etag', {}), CasConflictError);

  const outage = createBlobJsonAdapter({
    get: async () => null,
    put: async () => { throw new Error('outage'); },
    PreconditionError
  });
  await assert.rejects(() => outage.replace('state/team.json', 'etag', {}), /outage/);
});

test('exclusive create re-reads an ambiguous failure and reports a conflict only if the blob now exists', async () => {
  let reads = 0;
  const adapter = createBlobJsonAdapter({
    get: async () => (++reads === 1 ? null : {
      statusCode: 200, stream: new Response('{}').body, blob: { etag: 'winner' }
    }),
    put: async () => { throw new Error('ambiguous create failure'); },
    PreconditionError: class extends Error {}
  });
  await adapter.read('state/team.json');
  await assert.rejects(() => adapter.create('state/team.json', {}), CasConflictError);
});
