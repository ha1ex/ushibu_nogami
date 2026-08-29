import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeRootHash, createSnapshot, finalizeManifest, loadSnapshot, storeResponse,
} from '../lib/raw-store.mjs';
import { requestKey, sha256Hex } from '../lib/canonical-json.mjs';

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
    'key', 'path', 'query', 'boundaryRole', 'url', 'status', 'contentType', 'contentLength',
    'observedHeaders', 'fetchedAt', 'durationMs', 'bodyBytes', 'bodySha256',
    'canonicalSha256', 'itemCount', 'reportedTotal', 'blob',
  ]);
});

test('storeResponse отклоняет повторный request с другим body', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord());
  const conflictingBody = '{"matches":3}';

  await assert.rejects(
    storeResponse(snapshot, responseRecord({ body: conflictingBody })),
    /already stored with a different body/i,
  );
  assert.equal(
    await readFile(join(root, 'responses', `${sha256Hex(conflictingBody)}.json`), 'utf8'),
    conflictingBody,
    'conflicting successful response must remain available for forensic inspection',
  );
});

test('storeResponse сохраняет malformed JSON до parse failure и связывает blob с manifest', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  const malformedBody = '{"broken":';

  await assert.rejects(
    storeResponse(snapshot, responseRecord({ path: '/api/tags', body: malformedBody })),
    /not valid JSON/i,
  );

  assert.equal(snapshot.manifest.requests.length, 1);
  const [entry] = snapshot.manifest.requests;
  assert.equal(entry.path, '/api/tags');
  assert.equal(entry.bodySha256, sha256Hex(malformedBody));
  assert.equal(entry.canonicalSha256, null);
  assert.equal(await readFile(join(root, entry.blob), 'utf8'), malformedBody);
});

test('одинаковые boundary start/end сохраняются отдельно и проходят resume', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord(), { boundaryRole: 'start' });
  await storeResponse(snapshot, responseRecord(), { boundaryRole: 'end', allowConflict: true });
  await finalizeManifest(snapshot, 'complete');

  const resumed = await loadSnapshot(root);
  assert.equal(resumed.manifest.requests.length, 2);
  assert.deepEqual(resumed.manifest.requests.map(({ boundaryRole }) => boundaryRole), ['start', 'end']);
  assert.equal(new Set(resumed.manifest.requests.map(({ bodySha256 }) => bodySha256)).size, 1);
});

test('loadSnapshot разрешает start-only boundary для безопасного resume', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord(), { boundaryRole: 'start' });
  await finalizeManifest(snapshot, 'incomplete');

  const resumed = await loadSnapshot(root);
  assert.deepEqual(
    resumed.manifest.requests.map(({ boundaryRole }) => boundaryRole),
    ['start'],
  );
});

test('loadSnapshot запрещает boundary end без start', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord(), { boundaryRole: 'start' });
  snapshot.manifest.requests[0].boundaryRole = 'end';
  snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
  await finalizeManifest(snapshot, 'incomplete');

  await assert.rejects(loadSnapshot(root), /boundary observation sequence/i);
});

test('loadSnapshot запрещает вторую matches-head boundary-группу с другим limit', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  const head = responseRecord({
    path: '/api/matches',
    query: { limit: 2, offset: 0 },
    url: 'https://stats.whoajor.com/api/matches?limit=2&offset=0',
    body: '{"matches":[],"total":0}',
  });
  await storeResponse(snapshot, head, { boundaryRole: 'start' });
  await storeResponse(snapshot, head, { boundaryRole: 'end', allowConflict: true });
  await finalizeManifest(snapshot, 'incomplete');

  const extraKey = requestKey('/api/matches', { limit: 3, offset: 0 });
  const extraPair = snapshot.manifest.requests.map((entry) => ({
    ...structuredClone(entry),
    key: extraKey,
    query: { limit: 3, offset: 0 },
    url: 'https://stats.whoajor.com/api/matches?limit=3&offset=0',
  }));
  snapshot.manifest.requests.push(...extraPair);
  snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
  await writeFile(snapshot.manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);

  await assert.rejects(loadSnapshot(root), /matches-head boundary key|boundary cardinality/i);
});

test('разные boundary bodies одного request key сохраняются и проходят resume', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(
    snapshot,
    responseRecord({ body: '{"matches":2}' }),
    { boundaryRole: 'start' },
  );
  await storeResponse(
    snapshot,
    responseRecord({ body: '{"matches":3}' }),
    { allowConflict: true, boundaryRole: 'end' },
  );
  await finalizeManifest(snapshot, 'unstable');

  const resumed = await loadSnapshot(root);
  assert.equal(resumed.manifest.requests.length, 2);
  assert.deepEqual(
    resumed.manifest.requests.map(({ key }) => key),
    ['GET /api/meta', 'GET /api/meta'],
  );
  assert.equal(new Set(resumed.manifest.requests.map(({ bodySha256 }) => bodySha256)).size, 2);
  assert.deepEqual(resumed.manifest.requests.map(({ boundaryRole }) => boundaryRole), ['start', 'end']);
});

test('loadSnapshot отклоняет обычный дубль request даже с одинаковым body', async () => {
  const { root, snapshot } = await createFixtureSnapshot();
  await storeResponse(snapshot, responseRecord());
  await finalizeManifest(snapshot, 'incomplete');
  snapshot.manifest.requests.push(structuredClone(snapshot.manifest.requests[0]));
  snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
  await writeFile(snapshot.manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);

  await assert.rejects(loadSnapshot(root), /ordinary request.*duplicate|repeats response/i);
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
