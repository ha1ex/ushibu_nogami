import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp, readFile, readdir, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { collectSnapshot } from '../collect.mjs';
import { canonicalStringify, sha256Hex } from '../lib/canonical-json.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { computeRootHash } from '../lib/raw-store.mjs';
import { validateSnapshot } from '../lib/validation.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE_CLI = join(HERE, '..', 'validate.mjs');
const NOW = () => new Date('2026-08-29T07:00:00Z');
const PLAYER_1 = '76561198000000001';
const PLAYER_2 = '76561198000000002';

async function readManifest(dir) {
  return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
}

async function writeManifest(dir, manifest) {
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function rewritePayload(dir, predicate, mutate, { all = false } = {}) {
  const manifest = await readManifest(dir);
  const entries = manifest.requests.filter(predicate);
  assert.ok(entries.length > 0, 'fixture mutation must find a request');
  const selected = all ? entries : entries.slice(0, 1);
  for (const entry of selected) {
    const payload = JSON.parse(await readFile(join(dir, entry.blob), 'utf8'));
    const nextPayload = structuredClone(payload);
    mutate(nextPayload, entry);
    const body = JSON.stringify(nextPayload);
    const bodySha256 = sha256Hex(body);
    const blob = join('responses', `${bodySha256}.json`);
    await writeFile(join(dir, blob), body);
    entry.bodyBytes = Buffer.byteLength(body);
    entry.bodySha256 = bodySha256;
    entry.canonicalSha256 = sha256Hex(canonicalStringify(nextPayload));
    entry.blob = blob;
    entry.itemCount = Array.isArray(nextPayload)
      ? nextPayload.length
      : Object.values(nextPayload).find(Array.isArray)?.length ?? null;
    entry.reportedTotal = typeof nextPayload?.total === 'number' ? nextPayload.total : null;
  }
  manifest.rootHash = computeRootHash(manifest.requests);
  await writeManifest(dir, manifest);
}

async function removeRequests(dir, predicate) {
  const manifest = await readManifest(dir);
  const before = manifest.requests.length;
  manifest.requests = manifest.requests.filter((entry) => !predicate(entry));
  assert.ok(manifest.requests.length < before, 'fixture mutation must remove a request');
  manifest.rootHash = computeRootHash(manifest.requests);
  await writeManifest(dir, manifest);
}

async function buildCollectedFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'whoajor-validation-'));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-3', 'match-2', 'match-1'],
    detailPlayers: [PLAYER_1, PLAYER_2],
    roundPlayers: [PLAYER_1, PLAYER_2],
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  await collectSnapshot({ outputDir: dir, client, now: NOW, pageSize: 2 });
  await rewritePayload(dir, (entry) => entry.path === '/api/meta', (meta) => {
    meta.maps[0].n -= 1;
  });
  return dir;
}

function hasCode(report, bucket, code) {
  return report[bucket].some((event) => event.code === code);
}

async function expectHardError(code, mutate) {
  const dir = await buildCollectedFixture();
  await mutate(dir);
  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'incomplete');
  assert.ok(hasCode(report, 'errors', code), `${code} missing in ${JSON.stringify(report.errors)}`);
}

test('валидный fixture проходит и фиксирует неблокирующее расхождение карт', async () => {
  const dir = await buildCollectedFixture();
  const report = await validateSnapshot(dir);

  assert.equal(report.status, 'complete');
  assert.equal(report.errors.length, 0);
  assert.ok(hasCode(report, 'discrepancies', 'META_MAP_SUM_MISMATCH'));
  assert.ok(hasCode(report, 'warnings', 'INDEX_DETAIL_NAMING_DIFFERENCE'));
  assert.deepEqual(report.counts, {
    requests: 30,
    matches: 3,
    matchDetails: 3,
    players: 3,
    weapons: 2,
    tags: 1,
  });
  assert.match(report.rootHash, /^[a-f0-9]{64}$/);
});

test('manifest.status не подменяет независимый аудит exact blobs', async () => {
  const dir = await buildCollectedFixture();
  await removeRequests(dir, (entry) => entry.path === '/api/matches/match-1');
  const manifest = await readManifest(dir);
  manifest.status = 'complete';
  await writeManifest(dir, manifest);

  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'incomplete');
  assert.ok(hasCode(report, 'errors', 'MATCH_DETAIL_MISSING'));
});

test('BODY_HASH_MISMATCH блокирует изменённый exact blob', async () => {
  await expectHardError('BODY_HASH_MISMATCH', async (dir) => {
    const manifest = await readManifest(dir);
    const entry = manifest.requests.find(({ path }) => path === '/api/tags');
    const body = await readFile(join(dir, entry.blob), 'utf8');
    await writeFile(join(dir, entry.blob), body.replace('official', 'altered!'));
  });
});

test('ROOT_HASH_MISMATCH блокирует подменённый manifest root', async () => {
  await expectHardError('ROOT_HASH_MISMATCH', async (dir) => {
    const manifest = await readManifest(dir);
    manifest.rootHash = '0'.repeat(64);
    await writeManifest(dir, manifest);
  });
});

test('REQUEST_MISSING блокирует отсутствие контрактного singleton endpoint', async () => {
  await expectHardError('REQUEST_MISSING', (dir) => (
    removeRequests(dir, (entry) => entry.path === '/api/tags')
  ));
});

test('PAGE_GAP блокирует пропущенный ruling offset pageSize-1', async () => {
  await expectHardError('PAGE_GAP', (dir) => removeRequests(dir, (entry) => (
    entry.path === '/api/matches' && entry.query.offset === 1
  )));
});

test('TOTAL_MISMATCH блокирует inconsistent total между страницами', async () => {
  await expectHardError('TOTAL_MISMATCH', (dir) => rewritePayload(dir, (entry) => (
    entry.path === '/api/matches' && entry.query.offset === 1
  ), (page) => { page.total += 1; }));
});

test('MATCH_DETAIL_MISSING блокирует отсутствие detail каждого index match', async () => {
  await expectHardError('MATCH_DETAIL_MISSING', (dir) => (
    removeRequests(dir, (entry) => entry.path === '/api/matches/match-2')
  ));
});

test('DUPLICATE_PK блокирует дубль (match_id, steamid, round)', async () => {
  await expectHardError('DUPLICATE_PK', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/matches/match-1',
    (detail) => { detail.players[0].perRound.push({ ...detail.players[0].perRound[0] }); },
  ));
});

test('DUPLICATE_PK блокирует дубль (steamid, weapon) в weapon-splits', async () => {
  await expectHardError('DUPLICATE_PK', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/weapon-splits',
    (rows) => { rows.push({ ...rows[0] }); },
  ));
});

test('BROKEN_FK блокирует неизвестный SteamID в roster раунда', async () => {
  await expectHardError('BROKEN_FK', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/matches/match-1',
    (detail) => { detail.rounds[0].tSteamids.push('76561198999999999'); },
  ));
});

test('INVALID_STEAMID блокирует malformed SteamID', async () => {
  await expectHardError('INVALID_STEAMID', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/leaderboard',
    (rows) => { rows[0].steamid = 'STEAM_0:1:abc'; },
  ));
});

test('REQUIRED_FIELD_MISSING блокирует required-field schema drift', async () => {
  await expectHardError('REQUIRED_FIELD_MISSING', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/tags',
    (rows) => { delete rows[0].tag; },
  ));
});

test('FIELD_TYPE_MISMATCH блокирует required type drift', async () => {
  await expectHardError('FIELD_TYPE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/tags',
    (rows) => { rows[0].matches = '3'; },
  ));
});

test('WEAPON_AGGREGATE_MISMATCH блокирует расхождение index и detail сумм', async () => {
  await expectHardError('WEAPON_AGGREGATE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/weapons',
    (rows) => { rows[0].kills += 1; },
  ));
});

test('SNAPSHOT_BOUNDARY_CHANGED блокирует различающиеся start/end bodies', async () => {
  await expectHardError('SNAPSHOT_BOUNDARY_CHANGED', async (dir) => {
    const manifest = await readManifest(dir);
    const original = manifest.requests.find(({ path }) => path === '/api/meta');
    const payload = JSON.parse(await readFile(join(dir, original.blob), 'utf8'));
    payload.max_date = '2026-08-30';
    const body = JSON.stringify(payload);
    const bodySha256 = sha256Hex(body);
    const entry = {
      ...structuredClone(original),
      bodyBytes: Buffer.byteLength(body),
      bodySha256,
      canonicalSha256: sha256Hex(canonicalStringify(payload)),
      blob: join('responses', `${bodySha256}.json`),
      fetchedAt: '2026-08-29T07:05:00.000Z',
    };
    await writeFile(join(dir, entry.blob), body);
    manifest.requests.push(entry);
    manifest.rootHash = computeRootHash(manifest.requests);
    await writeManifest(dir, manifest);
  });
});

test('все документированные discrepancy/warning остаются неблокирующими', async () => {
  const dir = await buildCollectedFixture();
  await rewritePayload(dir, (entry) => entry.path === '/api/leaderboard', (rows) => {
    rows[0].wins = 1;
    rows[0].losses = 0;
    rows[0].upstream_note = 'known';
  });
  await rewritePayload(dir, (entry) => (
    entry.path === `/api/players/${PLAYER_1}/weapons` && entry.query.by === undefined
  ), (rows) => { rows[0].day = '2026-08-28'; });
  await rewritePayload(dir, (entry) => (
    entry.path === `/api/players/${PLAYER_1}/weapons` && entry.query.by === 'day'
  ), (rows) => { rows[0] = {
    weapon: 'ak47', shots: 20, hits: 6, kills: 2, rounds_with: 2, day: '2026-08-28',
  }; });

  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'complete');
  assert.equal(report.errors.length, 0);
  for (const code of ['META_MAP_SUM_MISMATCH', 'WINS_LOSSES_LT_MATCHES']) {
    assert.ok(hasCode(report, 'discrepancies', code), code);
  }
  for (const code of [
    'UNKNOWN_FIELD', 'INDEX_DETAIL_NAMING_DIFFERENCE', 'FILTER_PARAMETER_IGNORED',
  ]) {
    assert.ok(hasCode(report, 'warnings', code), code);
  }
});

test('повторный аудит детерминирован кроме operational checkedAt', async () => {
  const dir = await buildCollectedFixture();
  const first = await validateSnapshot(dir);
  const second = await validateSnapshot(dir);
  const withoutCheckedAt = ({ checkedAt, ...report }) => report;
  assert.deepEqual(withoutCheckedAt(first), withoutCheckedAt(second));
});

test('CLI атомарно пишет validation-report.json и возвращает 0 только для complete', async () => {
  const completeDir = await buildCollectedFixture();
  await execFileAsync(process.execPath, [VALIDATE_CLI, completeDir]);
  const completeReport = JSON.parse(await readFile(
    join(completeDir, 'validation-report.json'), 'utf8',
  ));
  assert.equal(completeReport.status, 'complete');

  const incompleteDir = await buildCollectedFixture();
  await removeRequests(incompleteDir, (entry) => entry.path === '/api/tags');
  await assert.rejects(
    execFileAsync(process.execPath, [VALIDATE_CLI, incompleteDir]),
    (error) => error.code === 1,
  );
  const incompleteReport = JSON.parse(await readFile(
    join(incompleteDir, 'validation-report.json'), 'utf8',
  ));
  assert.equal(incompleteReport.status, 'incomplete');
  assert.ok(hasCode(incompleteReport, 'errors', 'REQUEST_MISSING'));
  assert.ok((await readdir(incompleteDir)).every((name) => !name.startsWith('validation-report.json.tmp-')));
});
