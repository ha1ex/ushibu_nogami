import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeRootHash, createSnapshot, finalizeManifest, loadSnapshot, storeResponse,
} from '../lib/raw-store.mjs';
import { sha256Hex } from '../lib/canonical-json.mjs';

const body = '{"matches":2}';

async function createFixtureSnapshot(metadata = {}) {
  const root = await mkdtemp(join(tmpdir(), 'whoajor-'));
  const snapshot = await createSnapshot(root, {
    snapshotId: 'fixture', contractVersion: '1.0.0', ...metadata,
  });
  return { root, snapshot };
}

function responseRecord(overrides = {}) {
  return {
    path: '/api/meta',
    query: {},
    url: 'https://stats.whoajor.com/api/meta',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body,
    durationMs: 12,
    ...overrides,
  };
}

test('storeResponse сохраняет exact body один раз и связывает его с request', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord());
  await storeResponse(snapshot, responseRecord({ durationMs: 8 }));

  const manifest = await finalizeManifest(snapshot, 'complete');
  assert.equal(manifest.requests.length, 1);
  assert.equal(manifest.requests[0].bodySha256, sha256Hex(body));
  assert.match(manifest.rootHash, /^[a-f0-9]{64}$/);
  assert.equal(
    await readFile(join(root, 'responses', `${manifest.requests[0].bodySha256}.json`), 'utf8'),
    body,
  );
  assert.deepEqual(Object.keys(manifest.requests[0]), [
    'key', 'path', 'query', 'url', 'status', 'contentType', 'contentLength',
    'observedHeaders', 'fetchedAt', 'durationMs', 'bodyBytes', 'bodySha256',
    'canonicalSha256', 'itemCount', 'reportedTotal', 'blob',
  ]);
});

test('storeResponse отклоняет повторный request с другим body', async () => {
  const { snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord());

  await assert.rejects(
    storeResponse(snapshot, responseRecord({ body: '{"matches":3}' })),
    /already stored with a different body/i,
  );
});

test('loadSnapshot не возобновляет снимок с усечённым или изменённым blob', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  const entry = await storeResponse(snapshot, responseRecord());
  await finalizeManifest(snapshot, 'incomplete');

  await writeFile(join(root, entry.blob), '{"matches":');

  await assert.rejects(loadSnapshot(root), /cannot resume.*body blob/i);
});

test('loadSnapshot не возобновляет снимок с изменённым blob той же длины', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  const entry = await storeResponse(snapshot, responseRecord());
  await finalizeManifest(snapshot, 'incomplete');

  await writeFile(join(root, entry.blob), '{"matches":3}');

  await assert.rejects(loadSnapshot(root), /cannot resume.*body blob/i);
});

test('loadSnapshot возобновляет снимок только после проверки manifest и blob', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord());
  await finalizeManifest(snapshot, 'incomplete');

  const resumed = await loadSnapshot(root);
  await storeResponse(resumed, responseRecord({ durationMs: 99 }));

  assert.equal(resumed.manifest.requests.length, 1);
  assert.equal(resumed.manifest.requests[0].bodyBytes, Buffer.byteLength(body));
});

test('root hash не зависит от длительности запроса и времени запуска', async () => {
  const first = await createFixtureSnapshot({ startedAt: '2026-08-29T07:00:00.000Z' });
  const second = await createFixtureSnapshot({ startedAt: '2026-08-29T08:00:00.000Z' });

  await storeResponse(first.snapshot, responseRecord({
    durationMs: 1, fetchedAt: '2026-08-29T07:00:01.000Z',
  }));
  await storeResponse(second.snapshot, responseRecord({
    durationMs: 999, fetchedAt: '2026-08-29T08:00:09.000Z',
  }));

  const firstManifest = await finalizeManifest(first.snapshot, 'complete');
  const secondManifest = await finalizeManifest(second.snapshot, 'complete');
  assert.equal(firstManifest.rootHash, secondManifest.rootHash);
  assert.equal(firstManifest.rootHash, computeRootHash(firstManifest.requests));
});
