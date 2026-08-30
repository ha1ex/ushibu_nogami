import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSnapshot } from '../collect.mjs';
import { CONTRACT } from '../lib/contract.mjs';
import { requestKey } from '../lib/canonical-json.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { loadSnapshot } from '../lib/raw-store.mjs';
import {
  classifyEndpointFamily,
  selectSampleEntries,
  verifySample,
} from '../lib/sampling.mjs';
import { runCli } from '../verify-sample.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const NOW = () => new Date('2026-08-30T09:00:00Z');

async function collectFixture(t, options = {}) {
  const fixture = createFixtureApi(options);
  const snapshotDir = await mkdtemp(join(tmpdir(), 'whoajor-sampling-'));
  t.after(() => rm(snapshotDir, { recursive: true, force: true }));
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  const manifest = await collectSnapshot({
    outputDir: snapshotDir,
    client,
    now: NOW,
    pageSize: options.pageSize ?? 1,
  });
  assert.equal(manifest.status, 'collected');
  return { fixture, snapshotDir, snapshot: await loadSnapshot(snapshotDir) };
}

function storedResponseClient(snapshot, { mismatchKey = null } = {}) {
  const calls = [];
  return {
    calls,
    async get(path, query = {}) {
      const identity = requestKey(path, query);
      calls.push(identity);
      const entry = snapshot.manifest.requests.find((candidate) => (
        candidate.key === identity && candidate.boundaryRole !== 'end'
      ));
      assert.ok(entry, `fixture snapshot must contain ${identity}`);
      let body = await readFile(join(snapshot.root, entry.blob), 'utf8');
      if (identity === mismatchKey) body = '[]';
      return {
        path,
        query,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body,
        durationMs: 0,
      };
    },
  };
}

test('endpoint classifier различает ровно 15 CONTRACT families и exact query', () => {
  const steamid = '76561198000000001';
  const cases = [
    ['meta', '/api/meta', {}],
    ['tags', '/api/tags', {}],
    ['draftConfig', '/api/draft-config', {}],
    ['matches', '/api/matches', { limit: 100, offset: 0 }],
    ['matchDetail', '/api/matches/match-1', {}],
    ['leaderboard', '/api/leaderboard', {}],
    ['playerSummary', `/api/players/${steamid}/summary`, {}],
    ['playerMaps', `/api/players/${steamid}/maps`, {}],
    ['playerWeapons', `/api/players/${steamid}/weapons`, {}],
    ['playerWeaponsByDay', `/api/players/${steamid}/weapons`, { by: 'day' }],
    ['playerMatches', `/api/players/${steamid}/matches`, {}],
    ['weapons', '/api/weapons', {}],
    ['weaponDetail', '/api/weapons/ak47', {}],
    ['weaponDetailByDay', '/api/weapons/ak47', { by: 'day' }],
    ['weaponSplits', '/api/weapon-splits', {}],
  ];

  assert.equal(cases.length, 15);
  assert.deepEqual(cases.map(([expected, path, query]) => (
    classifyEndpointFamily(path, query) === expected ? expected : null
  )), cases.map(([expected]) => expected));
  assert.deepEqual(cases.map(([expected]) => expected).sort(),
    Object.keys(CONTRACT.endpoints).sort());
  assert.equal(classifyEndpointFamily('/api/weapons', { by: 'day' }), null);
  assert.equal(classifyEndpointFamily('/api/weapons/ak47', { by: 'week' }), null);
  assert.equal(classifyEndpointFamily(`/api/players/${steamid}/weapons`, { by: 'day', extra: 1 }), null);
  assert.equal(classifyEndpointFamily('/api/matches', { limit: 100 }), null);
  assert.equal(classifyEndpointFamily('/api/matches/match-1/rounds', {}), null);
  assert.equal(classifyEndpointFamily('/api/players/1/summary', {}), null);
});

test('sample score равен sha256(snapshotId + identity) без разделителя', async () => {
  const selection = await selectSampleEntries({
    root: '.',
    manifest: {
      snapshotId: 'fixture',
      sourceCounts: { matches: 0, players: 0, weapons: 0 },
      requests: [{
        key: 'GET /api/meta',
        path: '/api/meta',
        query: {},
        boundaryRole: 'start',
        canonicalSha256: '0'.repeat(64),
        blob: 'unused.json',
      }],
    },
  }, { minimumSampleSize: 1 });

  assert.equal(
    selection.selected[0].score,
    'fb16003f995587e04507f5670762b7964a97bebcea98f553fce9fe0533a621c9',
  );
});

test('selection детерминирована при перестановке manifest и включает mandatory coverage', async (t) => {
  const { snapshot } = await collectFixture(t, {
    pageSize: 2,
    matchIds: ['zeta', 'beta', 'alpha', 'omega'],
  });
  const reversed = {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      requests: [...snapshot.manifest.requests].reverse(),
    },
  };

  const forwardSelection = await selectSampleEntries(snapshot, { minimumSampleSize: 10 });
  const reversedSelection = await selectSampleEntries(reversed, { minimumSampleSize: 10 });
  const forwardKeys = forwardSelection.selected.map(({ identity }) => identity);
  const reversedKeys = reversedSelection.selected.map(({ identity }) => identity);

  assert.deepEqual(forwardKeys, reversedKeys);
  assert.equal(new Set(forwardKeys).size, forwardKeys.length);
  assert.deepEqual(forwardSelection.coverage.missingEndpointFamilies, []);
  assert.deepEqual(
    Object.keys(forwardSelection.coverage.endpointFamilies).sort(),
    Object.keys(CONTRACT.endpoints).sort(),
  );
  assert.equal(
    forwardSelection.coverage.matchIndexPages.first,
    'GET /api/matches?limit=2&offset=0',
  );
  assert.equal(
    forwardSelection.coverage.matchIndexPages.last,
    'GET /api/matches?limit=2&offset=2',
  );
  assert.deepEqual(forwardSelection.coverage.matchDetails, {
    oldest: 'GET /api/matches/omega',
    newest: 'GET /api/matches/zeta',
    lexicographicFirst: 'GET /api/matches/alpha',
    lexicographicLast: 'GET /api/matches/zeta',
  });
  const mandatoryIdentities = new Set([
    ...Object.values(forwardSelection.coverage.endpointFamilies),
    ...Object.values(forwardSelection.coverage.matchIndexPages),
    ...Object.values(forwardSelection.coverage.matchDetails),
  ]);
  assert.ok([...mandatoryIdentities].every((identity) => forwardKeys.includes(identity)));
  assert.ok(forwardSelection.selected.every(({ score, identity }) => (
    score === reversedSelection.selected.find((item) => item.identity === identity).score
  )));
});

test('verifySample сверяет canonical hashes и атомарно пишет complete report', async (t) => {
  const { snapshot, snapshotDir } = await collectFixture(t);
  const client = storedResponseClient(snapshot);

  const report = await verifySample({
    snapshotDir,
    client,
    now: NOW,
    minimumSampleSize: 10,
  });
  const storedReport = JSON.parse(await readFile(join(snapshotDir, 'sampling-report.json'), 'utf8'));

  assert.equal(report.status, 'complete');
  assert.equal(report.contractVersion, snapshot.manifest.contractVersion);
  assert.equal(report.rootHash, snapshot.manifest.rootHash);
  assert.deepEqual(report.selectionAlgorithm, {
    mandatoryCoverage: 'all CONTRACT endpoint families + first/last match pages + oldest/newest/lexicographic-first/lexicographic-last match detail',
    score: 'sha256(snapshotId + identity)',
    target: 'max(30, ceil((matches + players + weapons) * 0.01))',
  });
  assert.deepEqual(storedReport, report);
  assert.deepEqual(report.reasons, []);
  assert.equal(report.checks.length, report.selectedCount);
  assert.ok(report.checks.every((check) => (
    check.status === 'match'
      && check.expectedCanonicalSha256 === check.actualCanonicalSha256
  )));
  assert.equal(new Set(client.calls).size, client.calls.length);
});

test('canonical mismatch пишет unstable report, а CLI возвращает nonzero', async (t) => {
  const { snapshot, snapshotDir } = await collectFixture(t);
  const mismatchKey = 'GET /api/tags';
  const client = storedResponseClient(snapshot, { mismatchKey });
  let stdout = '';

  const exitCode = await runCli([snapshotDir], {
    client,
    minimumSampleSize: 10,
    now: NOW,
    stdout: { write: (chunk) => { stdout += chunk; } },
  });
  const report = JSON.parse(await readFile(join(snapshotDir, 'sampling-report.json'), 'utf8'));
  const mismatch = report.checks.find(({ identity }) => identity === mismatchKey);

  assert.equal(exitCode, 1);
  assert.match(stdout, /"status":"unstable"/);
  assert.equal(report.status, 'unstable');
  assert.equal(mismatch.status, 'mismatch');
  assert.notEqual(mismatch.expectedCanonicalSha256, mismatch.actualCanonicalSha256);
  assert.ok(report.reasons.some(({ code, identity }) => (
    code === 'CANONICAL_HASH_MISMATCH' && identity === mismatchKey
  )));
});

test('default target не уменьшается и блокирует snapshot с менее чем 30 candidates', async (t) => {
  const { snapshot, snapshotDir } = await collectFixture(t);
  const client = storedResponseClient(snapshot);

  const report = await verifySample({ snapshotDir, client, now: NOW });

  assert.equal(report.sampleTarget, 30);
  assert.equal(report.candidateCount, 29);
  assert.equal(report.status, 'unstable');
  assert.ok(report.reasons.some(({ code }) => code === 'INSUFFICIENT_CANDIDATES'));
});
