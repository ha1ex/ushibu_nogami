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
import { canonicalStringify, requestKey, sha256Hex } from '../lib/canonical-json.mjs';
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

async function buildCollectedFixture(fixtureOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'whoajor-validation-'));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-3', 'match-2', 'match-1'],
    detailPlayers: [PLAYER_1, PLAYER_2],
    roundPlayers: [PLAYER_1, PLAYER_2],
    ...fixtureOptions,
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
  }, { all: true });
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
    requests: 32,
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

test('INVALID_STEAMID блокирует полностью согласованный короткий numeric ID', async () => {
  const dir = await buildCollectedFixture();
  const replaceSteamid = (value) => {
    if (Array.isArray(value)) return value.forEach(replaceSteamid);
    if (!value || typeof value !== 'object') return;
    for (const [field, nested] of Object.entries(value)) {
      if (nested === PLAYER_1) value[field] = '1';
      else replaceSteamid(nested);
    }
  };
  await rewritePayload(dir, () => true, replaceSteamid, { all: true });
  const manifest = await readManifest(dir);
  for (const entry of manifest.requests) {
    entry.path = entry.path.replace(PLAYER_1, '1');
    entry.key = requestKey(entry.path, entry.query);
    if (typeof entry.url === 'string') entry.url = entry.url.replace(PLAYER_1, '1');
  }
  manifest.rootHash = computeRootHash(manifest.requests);
  await writeManifest(dir, manifest);

  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'incomplete');
  assert.ok(hasCode(report, 'errors', 'INVALID_STEAMID'));
});

test('REQUIRED_FIELD_MISSING блокирует required-field schema drift', async () => {
  await expectHardError('REQUIRED_FIELD_MISSING', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/tags',
    (rows) => { delete rows[0].tag; },
  ));
});

test('optional descriptor принимает отсутствие workshopMap и voiceRecorded из live schema', async () => {
  const dir = await buildCollectedFixture({ legacyOptionalMatchFields: true });

  const report = await validateSnapshot(dir);

  assert.equal(report.status, 'complete');
  assert.equal(report.errors.length, 0);
});

test('FIELD_TYPE_MISMATCH блокирует required type drift', async () => {
  await expectHardError('FIELD_TYPE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/tags',
    (rows) => { rows[0].matches = '3'; },
  ));
});

test('FIELD_TYPE_MISMATCH блокирует несуществующую календарную ISO-дату', async () => {
  await expectHardError('FIELD_TYPE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/meta',
    (meta) => { meta.min_date = '2026-02-30'; },
    { all: true },
  ));
});

test('FIELD_TYPE_MISMATCH требует RFC3339 time у timestamp field', async () => {
  await expectHardError('FIELD_TYPE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/draft-config',
    (draft) => { draft.publishedAt = '2026-08-29'; },
  ));
});

test('строгая дата принимает live date-only, local time, SQL time и RFC3339 offset', async () => {
  const dir = await buildCollectedFixture();
  await rewritePayload(dir, (entry) => entry.path === '/api/meta', (meta) => {
    meta.min_date = '2023-11-16T19:08:00';
    meta.max_date = '2026-08-27T20:04:00';
  }, { all: true });
  await rewritePayload(dir, (entry) => entry.path === '/api/draft-config', (draft) => {
    draft.publishedAt = '2026-08-02 10:01:29';
  });
  await rewritePayload(dir, (entry) => (
    entry.path === `/api/players/${PLAYER_1}/matches`
  ), (rows) => {
    rows[0].started_at = '2026-08-28T18:00:00.123+03:00';
  });
  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'complete');
  assert.equal(report.errors.length, 0);
});

test('WEAPON_AGGREGATE_MISMATCH блокирует расхождение index и detail сумм', async () => {
  await expectHardError('WEAPON_AGGREGATE_MISMATCH', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/weapons',
    (rows) => { rows[0].kills += 1; },
  ));
});

test('SNAPSHOT_BOUNDARY_CHANGED блокирует различающиеся start/end bodies', async () => {
  await expectHardError('SNAPSHOT_BOUNDARY_CHANGED', (dir) => rewritePayload(
    dir,
    (entry) => entry.path === '/api/meta' && entry.boundaryRole === 'end',
    (meta) => { meta.max_date = '2026-08-30'; },
  ));
});

test('boundary audit требует ровно start/end для meta и matches head', async () => {
  await expectHardError('SNAPSHOT_BOUNDARY_CHANGED', (dir) => removeRequests(
    dir,
    (entry) => entry.path === '/api/meta' && entry.boundaryRole === 'end',
  ));
});

test('boundary audit блокирует end перед start', async () => {
  await expectHardError('SNAPSHOT_BOUNDARY_CHANGED', async (dir) => {
    const manifest = await readManifest(dir);
    const startIndex = manifest.requests.findIndex((entry) => (
      entry.path === '/api/meta' && entry.boundaryRole === 'start'
    ));
    const endIndex = manifest.requests.findIndex((entry) => (
      entry.path === '/api/meta' && entry.boundaryRole === 'end'
    ));
    [manifest.requests[startIndex], manifest.requests[endIndex]] = [
      manifest.requests[endIndex], manifest.requests[startIndex],
    ];
    await writeManifest(dir, manifest);
  });
});

test('boundary audit блокирует вторую complete matches-head группу с другим limit', async () => {
  await expectHardError('DUPLICATE_PK', async (dir) => {
    const manifest = await readManifest(dir);
    const headPair = manifest.requests.filter((entry) => (
      entry.path === '/api/matches' && entry.query.offset === 0
    ));
    assert.deepEqual(headPair.map(({ boundaryRole }) => boundaryRole), ['start', 'end']);
    const extraKey = requestKey('/api/matches', { limit: 3, offset: 0 });
    manifest.requests.push(...headPair.map((entry) => ({
      ...structuredClone(entry),
      key: extraKey,
      query: { limit: 3, offset: 0 },
      url: entry.url.replace('limit=2', 'limit=3'),
    })));
    manifest.rootHash = computeRootHash(manifest.requests);
    await writeManifest(dir, manifest);
  });
});

test('обычный duplicate request не маскируется dedup логикой validator', async () => {
  await expectHardError('DUPLICATE_PK', async (dir) => {
    const manifest = await readManifest(dir);
    const tags = manifest.requests.find(({ path }) => path === '/api/tags');
    manifest.requests.push(structuredClone(tags));
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

test('UNKNOWN_FIELD дедуплицируется по структурному пути без миллионов row warnings', async () => {
  const dir = await buildCollectedFixture();
  await rewritePayload(dir, (entry) => entry.path.endsWith('/maps'), (rows) => {
    rows.splice(0, rows.length, ...Array.from({ length: 100 }, (_, index) => ({
      map: `fixture_map_${index}`,
      matches: 1,
      rounds_played: 2,
      rounds_won: 1,
      kills: 2,
      deaths: 1,
      rating2: 1.05,
      upstream_note: 'same schema extension',
    })));
  }, { all: true });

  const report = await validateSnapshot(dir);
  const upstreamWarnings = report.warnings.filter(({ code, location }) => (
    code === 'UNKNOWN_FIELD' && location.endsWith('.upstream_note')
  ));

  assert.equal(report.status, 'complete');
  assert.equal(upstreamWarnings.length, 1);
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

test('CLI принимает literal -- из корневой pnpm-команды', async () => {
  const completeDir = await buildCollectedFixture();

  await execFileAsync(process.execPath, [VALIDATE_CLI, '--', completeDir]);

  const report = JSON.parse(await readFile(join(completeDir, 'validation-report.json'), 'utf8'));
  assert.equal(report.status, 'complete');
});
