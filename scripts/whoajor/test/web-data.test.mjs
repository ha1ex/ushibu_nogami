import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp, readFile, readdir, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(HERE, '..', 'generate-web-data.mjs');
const VERIFIER = join(HERE, '..', 'verify-web-data.mjs');
const RECOMMENDATIONS = join(HERE, '..', 'config', 'match-recommendations.json');
const EXPECTED_ROOT = '84a051d7989725f22fd8bc37969f9308b2282edcdc61bf6b3477a021d8c71ee2';

async function generate() {
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-web-data-'));
  const result = await execFileAsync(process.execPath, [GENERATOR, '--output', outputDir])
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error) => ({
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
    }));
  assert.equal(result.code, 0, result.stderr);
  return outputDir;
}

async function fileTree(root, relative = '') {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await fileTree(root, path));
    else files.push([path, await readFile(join(root, path))]);
  }
  return files;
}

async function loadBuild(outputDir) {
  const current = JSON.parse(await readFile(join(outputDir, 'current.json'), 'utf8'));
  const versionDir = join(outputDir, current.version);
  const manifest = JSON.parse(await readFile(join(versionDir, 'manifest.json'), 'utf8'));
  return { current, versionDir, manifest };
}

async function loadDataset(versionDir, manifest, dataset) {
  const assets = manifest.assets.filter((asset) => asset.dataset === dataset);
  assert.ok(assets.length > 0, `${dataset} missing`);
  const rows = [];
  for (const asset of assets) {
    const payload = JSON.parse(await readFile(join(versionDir, asset.path), 'utf8'));
    rows.push(...payload.rows);
  }
  return rows;
}

function inspectSteamIds(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectSteamIds(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.notEqual(key, 'source_json', `${path}.${key}`);
    if (/steamids$/i.test(key)) {
      assert.ok(Array.isArray(nested), `${path}.${key} must be an array`);
      assert.ok(nested.every((item) => typeof item === 'string'), `${path}.${key}`);
    } else if (/steamid$/i.test(key) && nested !== null) {
      assert.equal(typeof nested, 'string', `${path}.${key}`);
    }
    inspectSteamIds(nested, `${path}.${key}`);
  }
}

test('generator publishes canonical pointer and exact source counts', async () => {
  const outputDir = await generate();
  const current = JSON.parse(await readFile(join(outputDir, 'current.json'), 'utf8'));
  assert.equal(current.root, EXPECTED_ROOT);
  assert.equal(current.version, 'v1-84a051d7989725f2');

  const manifest = JSON.parse(await readFile(
    join(outputDir, current.version, 'manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.contractVersion, '1.1.0');
  assert.equal(manifest.root, EXPECTED_ROOT);
  assert.deepEqual(manifest.window, {
    recentStart: '2026-05-29',
    recentEnd: '2026-08-27',
    allTimeStart: '2023-11-16T19:08:00',
    allTimeEnd: '2026-08-27T20:04:00',
  });
  assert.deepEqual(manifest.counts, {
    players: 81,
    matches: 368,
    rounds: 7903,
    maps: 46,
    weapons: 39,
    trendPlayers: 20,
    trendMatches: 2987,
    playerRounds: 76516,
    matchPlayerWeapons: 29887,
    playerClutches: 9629,
  });
});

test('generator exports complete safe shards with canonical hashes', async () => {
  const outputDir = await generate();
  const { versionDir, manifest } = await loadBuild(outputDir);
  assert.deepEqual(manifest.source, {
    file: 'whoajor.sqlite.gz',
    gzipSha256: '917af8cec282dc68fa00ffbcbd2117b0b4587c02da0313ebe8359f7fca8b1234',
    sqliteSha256: '0cc8105931ef2491c29504eb5b0ef115d77090def76bd0adcf1b3ab5fff2d4a1',
    dataFingerprint: '5a0e563128ab92cc2bad823852850c2fd3668155120f216a0116694b4de578a7',
  });
  assert.ok(manifest.assets.length > 10);

  const totals = {};
  const rowsByDataset = new Map();
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(versionDir, asset.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(gzipSync(bytes, { mtime: 0 }).length, asset.gzipBytes, asset.path);
    assert.ok(asset.gzipBytes <= 500 * 1024, `${asset.path}: ${asset.gzipBytes}`);
    const payload = JSON.parse(bytes.toString('utf8'));
    assert.equal(payload.root, EXPECTED_ROOT);
    assert.equal(payload.dataset, asset.dataset);
    assert.equal(payload.rows.length, asset.count);
    inspectSteamIds(payload);
    totals[asset.dataset] = (totals[asset.dataset] ?? 0) + payload.rows.length;
    rowsByDataset.set(asset.dataset, [
      ...(rowsByDataset.get(asset.dataset) ?? []),
      ...payload.rows,
    ]);
  }

  assert.deepEqual(
    Object.fromEntries(Object.entries(totals).filter(([dataset]) => [
      'players', 'matches', 'matchRounds', 'maps', 'weapons', 'trendPlayers',
      'trendMatches', 'playerRounds', 'roundRosters', 'matchPlayerWeapons',
      'playerClutches', 'matchPlayers',
    ].includes(dataset))),
    {
      players: 81,
      matches: 368,
      matchRounds: 7903,
      maps: 46,
      weapons: 39,
      trendPlayers: 20,
      trendMatches: 2987,
      playerRounds: 76516,
      roundRosters: 76516,
      matchPlayerWeapons: 29887,
      playerClutches: 9629,
      matchPlayers: 3819,
    },
  );

  const grains = {
    matchPlayerWeapons: (row) => `${row.matchId}|${row.steamid}|${row.weapon}`,
    playerWeaponStats: (row) => `${row.steamid}|${row.weapon}`,
    playerWeaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponSplits: (row) => `${row.steamid}|${row.weapon}`,
  };
  for (const [dataset, grain] of Object.entries(grains)) {
    const rows = rowsByDataset.get(dataset) ?? [];
    assert.ok(rows.length > 0, `${dataset} missing`);
    assert.equal(new Set(rows.map(grain)).size, rows.length, `${dataset} duplicate logical rows`);
  }
});

test('generator maps 30 roster players and closes reviewed match plans over calculations', async () => {
  const outputDir = await generate();
  const { versionDir, manifest } = await loadBuild(outputDir);
  const rosters = await loadDataset(versionDir, manifest, 'rosters');
  assert.equal(rosters.length, 5);
  assert.equal(rosters.flatMap((team) => team.players).length, 30);
  assert.equal(new Set(rosters.flatMap((team) => team.players.map(({ steamid }) => steamid))).size, 30);
  assert.ok(rosters.every((team) => team.players.length === 6));
  assert.ok(rosters.flatMap((team) => team.players).every((player) => (
    typeof player.steamid === 'string'
      && typeof player.draftRating === 'number'
      && player.mapped === true
  )));
  const us = rosters.find(({ teamId }) => teamId === 'us');
  assert.deepEqual(us.players.map(({ steamid }) => steamid).sort(), [
    '76561198024728544', '76561198067208940', '76561198123985656',
    '76561198349509112', '76561199164974760', '76561199811519979',
  ]);

  const playerMetrics = await loadDataset(versionDir, manifest, 'playerMetrics');
  assert.equal(playerMetrics.length, 30);
  for (const player of playerMetrics) {
    assert.ok(player.allTime.sums.rounds >= player.recent.sums.rounds);
    for (const window of [player.recent, player.allTime]) {
      if (window.sums.rounds > 0) {
        assert.ok(Math.abs(window.metrics.rating
          - (window.sums.ratingRoundSum / window.sums.rounds)) < 1e-12);
        assert.ok(Math.abs(window.metrics.adr
          - (window.sums.damage / window.sums.rounds)) < 1e-12);
      }
    }
  }

  const teams = await loadDataset(versionDir, manifest, 'teamMetrics');
  assert.equal(teams.length, 5);
  assert.ok(teams.every((team) => team.projectionPlayerCount === 6));
  assert.ok(teams.every((team) => team.top5.length === 5));
  assert.ok(teams.every((team) => team.methodology.cohesion === 'not_measured'));
  assert.ok(teams.every((team) => team.confirmedLineup.criterion.minRosterPlayers === 5));
  assert.ok(teams.every((team) => team.confirmedLineup.criterion.minRoundShare === 0.8));

  const edges = await loadDataset(versionDir, manifest, 'mapEdges');
  assert.equal(edges.length, 4);
  assert.ok(edges.every((opponent) => opponent.maps.length > 0));
  for (const opponent of edges) {
    for (const map of opponent.maps) {
      for (const side of [map.us, map.opponent]) {
        assert.ok(Math.abs(side.adjustedRating
          - ((side.rawRating * side.playerRounds + side.overallRating * 250)
            / (side.playerRounds + 250))) < 1e-12);
      }
      assert.equal(map.significant, Math.abs(map.edge) >= 0.03);
      assert.equal(map.confidence === 'low', (
        map.us.playerRounds < 200 || map.opponent.playerRounds < 200
      ));
    }
  }

  const evidence = await loadDataset(versionDir, manifest, 'evidence');
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  assert.equal(evidenceIds.size, evidence.length);
  const recommendations = await loadDataset(versionDir, manifest, 'recommendations');
  assert.deepEqual(recommendations.map(({ date }) => date), [
    '2026-09-30', '2026-10-01', '2026-10-21', '2026-10-22',
  ]);
  for (const plan of recommendations) {
    assert.equal(plan.snapshotRoot, EXPECTED_ROOT);
    assert.equal(plan.dataThrough, '2026-08-27');
    assert.equal(plan.reviewed, true);
    assert.ok(plan.pick && plan.ban && plan.backup.length > 0 && plan.contingency);
    assert.ok(plan.threatEvidence.length >= 2);
    assert.ok(plan.weaknessEvidence.length >= 1);
    assert.equal(plan.threats.length, plan.threatEvidence.length);
    assert.equal(plan.weaknesses.length, plan.weaknessEvidence.length);
    assert.ok(plan.threats.every(({ id, value, sampleRounds }) => (
      evidenceIds.has(id) && typeof value === 'number' && sampleRounds > 0
    )));
    assert.ok(plan.weaknesses.every(({ id, value, samplePlayerRounds }) => (
      evidenceIds.has(id) && typeof value === 'number' && samplePlayerRounds > 0
    )));
    assert.ok(plan.do.length > 0 && plan.dont.length > 0);
    assert.equal(plan.personalTasks.length, 6);
    assert.ok(plan.trainingChecklist.length > 0 && plan.matchdayChecklist.length > 0);
    assert.ok(['high', 'medium', 'low'].includes(plan.confidence));
    assert.ok(plan.caveats.some(({ evidenceId }) => evidenceId === 'limitation:cohesion'));
    assert.ok(plan.caveats.some(({ evidenceId }) => evidenceId === 'limitation:positions'));
    const references = [
      ...plan.threatEvidence,
      ...plan.weaknessEvidence,
      ...plan.mapEvidence,
      ...plan.caveats.map(({ evidenceId }) => evidenceId),
    ];
    assert.ok(references.every((id) => evidenceIds.has(id)), `${plan.opponentTeamId} evidence closure`);
  }
});

test('verifier proves deterministic rebuild and rejects invalid reviewed inputs or tampering', async () => {
  const first = await generate();
  const second = await generate();
  const firstTree = await fileTree(first);
  const secondTree = await fileTree(second);
  assert.deepEqual(firstTree.map(([path]) => path), secondTree.map(([path]) => path));
  for (let index = 0; index < firstTree.length; index += 1) {
    assert.deepEqual(firstTree[index][1], secondTree[index][1], firstTree[index][0]);
  }

  const verified = await execFileAsync(process.execPath, [VERIFIER, '--output', first]);
  const receipt = JSON.parse(verified.stdout);
  assert.equal(receipt.status, 'ok');
  assert.equal(receipt.root, EXPECTED_ROOT);
  assert.ok(receipt.assets > 10);
  assert.ok(receipt.maxGzipBytes <= 500 * 1024);

  const { versionDir, manifest } = await loadBuild(first);
  const tamperedPath = join(versionDir, manifest.assets[0].path);
  await writeFile(tamperedPath, Buffer.concat([await readFile(tamperedPath), Buffer.from(' ')]));
  const tampered = await execFileAsync(process.execPath, [VERIFIER, '--output', first])
    .then(() => ({ code: 0, stderr: '' }))
    .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
  assert.notEqual(tampered.code, 0);
  assert.match(tampered.stderr, /SHA mismatch/);

  const base = JSON.parse(await readFile(RECOMMENDATIONS, 'utf8'));
  const mutations = [
    ['root mismatch', (value) => { value.snapshotRoot = '0'.repeat(64); }],
    ['must be reviewed', (value) => { value.reviewed = false; }],
    ['stale', (value) => { value.dataThrough = '2026-08-26'; }],
    ['missing evidence', (value) => { value.plans[0].mapEvidence = ['missing:evidence']; }],
  ];
  for (const [message, mutate] of mutations) {
    const configDir = await mkdtemp(join(tmpdir(), 'whoajor-review-config-'));
    const configPath = join(configDir, 'recommendations.json');
    const candidate = structuredClone(base);
    mutate(candidate);
    await writeFile(configPath, `${JSON.stringify(candidate)}\n`);
    const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-invalid-build-'));
    const result = await execFileAsync(process.execPath, [
      GENERATOR, '--output', outputDir, '--recommendations', configPath,
    ]).then(() => ({ code: 0, stderr: '' }))
      .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
    assert.notEqual(result.code, 0, message);
    assert.match(result.stderr, new RegExp(message), result.stderr);
  }
});
