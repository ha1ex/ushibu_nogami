import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp, mkdtemp, readFile, readdir, rm, symlink, writeFile,
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
const EXPECTED_GAMEPLAY_TABLES = [
  ['draft_config', 'draftConfig'], ['draft_igls', 'draftIgls'],
  ['draft_players', 'draftPlayers'], ['leaderboard_snapshots', 'leaderboardSnapshots'],
  ['match_player_weapons', 'matchPlayerWeapons'], ['match_players', 'matchPlayers'],
  ['match_rounds', 'matchRounds'], ['match_tags', 'matchTags'], ['matches', 'matches'],
  ['meta_maps', 'maps'], ['player_aliases', 'playerAliases'],
  ['player_clutches', 'playerClutches'], ['player_map_snapshots', 'playerMapStats'],
  ['player_match_stats', 'playerMatchStats'], ['player_rounds', 'playerRounds'],
  ['player_side_stats', 'playerSideStats'],
  ['player_weapon_daily_stats', 'playerWeaponDailyStats'],
  ['player_weapon_stats', 'playerWeaponStats'], ['players', 'players'],
  ['round_rosters', 'roundRosters'], ['tags', 'tags'],
  ['trend_matches', 'trendMatches'], ['trend_players', 'trendPlayers'],
  ['weapon_daily_stats', 'weaponDailyStats'], ['weapon_splits', 'weaponSplits'],
  ['weapons', 'weapons'],
];

async function generate(t) {
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-web-data-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function rewriteManifest(outputDir, mutate) {
  const currentPath = join(outputDir, 'current.json');
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  const manifestPath = join(outputDir, current.version, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mutate({ current, manifest, versionDir: join(outputDir, current.version) });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(manifestPath, manifestBytes);
  current.manifestSha256 = sha256(manifestBytes);
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
}

async function mutateDataset(outputDir, dataset, mutate) {
  await rewriteManifest(outputDir, async ({ manifest, versionDir }) => {
    const asset = manifest.assets.find((item) => item.dataset === dataset);
    assert.ok(asset, `${dataset} asset missing`);
    const assetPath = join(versionDir, asset.path);
    const payload = JSON.parse(await readFile(assetPath, 'utf8'));
    mutate(payload.rows);
    const bytes = Buffer.from(`${JSON.stringify(payload)}\n`);
    await writeFile(assetPath, bytes);
    asset.count = payload.rows.length;
    asset.bytes = bytes.length;
    asset.gzipBytes = gzipSync(bytes, { mtime: 0 }).length;
    asset.sha256 = sha256(bytes);
  });
}

async function expectVerifierFailure(outputDir, pattern) {
  const result = await execFileAsync(process.execPath, [VERIFIER, '--output', outputDir])
    .then(() => ({ code: 0, stderr: '' }))
    .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
  assert.notEqual(result.code, 0, `verifier accepted ${pattern}`);
  assert.match(result.stderr, pattern);
}

test('generator publishes canonical pointer and exact source counts', async (t) => {
  const outputDir = await generate(t);
  const current = JSON.parse(await readFile(join(outputDir, 'current.json'), 'utf8'));
  assert.equal(current.root, EXPECTED_ROOT);
  assert.match(current.version, /^v1-[a-f0-9]{16}$/);
  assert.equal(current.manifest, `${current.version}/manifest.json`);

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
    leaderboardSnapshots: 162,
  });
  assert.deepEqual(
    manifest.gameplayTables.map(({ table, dataset }) => [table, dataset]),
    EXPECTED_GAMEPLAY_TABLES,
  );

  const probeMatch = 'auto-20231116-1908-de_anubis-Whoajor';
  const probePlayer = '76561198003507847';
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.detailIndexes).map(
    ([dataset, fields]) => [dataset, Object.keys(fields)],
  )), {
    matchPlayers: ['matchId'],
    matchRounds: ['matchId'],
    matchPlayerWeapons: ['matchId'],
    playerClutches: ['steamid'],
    playerMapStats: ['steamid', 'map'],
    playerWeaponStats: ['steamid', 'weapon'],
    trendMatches: ['steamid'],
  });
  assert.deepEqual(manifest.detailIndexes.matchPlayers.matchId[probeMatch], [
    'data/matchPlayers-000.json',
  ]);
  assert.deepEqual(manifest.detailIndexes.matchRounds.matchId[probeMatch], [
    'data/matchRounds-000.json',
  ]);
  assert.deepEqual(manifest.detailIndexes.matchPlayerWeapons.matchId[probeMatch], [
    'data/matchPlayerWeapons-000.json',
  ]);
  assert.equal(manifest.detailIndexes.playerClutches.steamid[probePlayer].length, 1);
});

test('generator exports complete safe shards with canonical hashes', async (t) => {
  const outputDir = await generate(t);
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
    assert.ok(asset.gzipBytes < 512000, `${asset.path}: ${asset.gzipBytes}`);
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

  const leaderboard = rowsByDataset.get('leaderboardSnapshots') ?? [];
  assert.equal(leaderboard.length, 162);
  assert.equal(new Set(leaderboard.map((row) => (
    `${row.snapshotId}|${row.queryFingerprint}|${row.steamid}`
  ))).size, 162);
  assert.ok(leaderboard.every((row) => (
    typeof row.snapshotId === 'string'
      && typeof row.queryFingerprint === 'string'
      && typeof row.steamid === 'string'
      && typeof row.rating2 === 'number'
      && !Object.hasOwn(row, 'source_json')
  )));

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

test('generator maps 30 roster players and closes reviewed match plans over calculations', async (t) => {
  const outputDir = await generate(t);
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
  assert.ok(playerMetrics.every((player) => player.aim
    && ['hsKillPct', 'preaimDeg', 'ttdMs', 'sprayAccuracy', 'enemyBlindPerRound']
      .every((key) => key in player.aim)));
  const humarki = playerMetrics.find(({ steamid }) => steamid === '76561198033124797');
  assert.equal(humarki.recent.sums.sides.T.rounds, 631);
  assert.equal(humarki.recent.sums.sides.CT.rounds, 570);
  assert.ok(Math.abs(humarki.recent.metrics.sides.T.rating - 0.9868880697305864) < 1e-12);
  assert.ok(Math.abs(humarki.recent.metrics.sides.CT.rating - 1.1597150175438595) < 1e-12);
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
  const usTeam = teams.find(({ teamId }) => teamId === 'us');
  assert.equal(usTeam.recent.sums.sides.T.rounds, 1230);
  assert.equal(usTeam.recent.sums.sides.CT.rounds, 1372);
  assert.ok(Math.abs(usTeam.recent.metrics.sides.T.rating - 1.0508679967479675) < 1e-12);
  assert.ok(Math.abs(usTeam.recent.metrics.sides.CT.rating - 1.2274854664723032) < 1e-12);
  assert.ok(teams.every((team) => team.projectionPlayerCount === 6));
  assert.ok(teams.every((team) => team.top5.length === 5));
  assert.ok(teams.every((team) => team.methodology.cohesion === 'not_measured'));
  assert.ok(teams.every((team) => team.confirmedLineup.criterion.minRosterPlayers === 5));
  assert.ok(teams.every((team) => team.confirmedLineup.criterion.minRoundShare === 0.8));

  const MAP_POOL = ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke'];
  const edges = await loadDataset(versionDir, manifest, 'mapEdges');
  assert.equal(edges.length, 4);
  for (const opponent of edges) {
    assert.deepEqual(opponent.maps.map(({ map }) => map), MAP_POOL);
    for (const map of opponent.maps) {
      const noData = map.us.playerRounds === 0 || map.opponent.playerRounds === 0;
      assert.equal(map.edge === null, noData, `${opponent.opponentTeamId}/${map.map} edge fabrication`);
      assert.equal(map.signal === 'no-data', noData);
      if (noData) {
        assert.equal(map.confidence, 'none');
        assert.equal(map.signals.rwrEdge, null);
        continue;
      }
      for (const side of [map.us, map.opponent]) {
        assert.ok(Math.abs(side.adjustedRating
          - ((side.rawRating * side.playerRounds + side.overallRating * 250)
            / (side.playerRounds + 250))) < 1e-12);
      }
      assert.ok(Math.abs(map.edge - (map.us.adjustedRating - map.opponent.adjustedRating)) < 1e-12);
      assert.equal(map.signal, Math.abs(map.edge) < 0.03 ? 'noise' : map.edge > 0 ? 'edge-us' : 'edge-them');
      assert.equal(map.confidence === 'low', (
        map.us.playerRounds < 200 || map.opponent.playerRounds < 200
      ));
    }
  }

  const teamMapStats = await loadDataset(versionDir, manifest, 'teamMapStats');
  for (const teamId of ['us', 'pocelui', 'takahuli', 'rassadnik', 'smoke']) {
    const poolRows = teamMapStats.filter((row) => row.teamId === teamId && row.inPool);
    assert.deepEqual(poolRows.map(({ map }) => map), MAP_POOL);
  }
  assert.ok(teamMapStats.every((row) => row.sampleUnit === 'player_rounds'));
  const usAnubis = teamMapStats.find((row) => row.teamId === 'us' && row.map === 'de_anubis');
  assert.equal(usAnubis.recent.sums.rounds, 189);
  assert.ok(Math.abs(usAnubis.recent.metrics.roundWinRate
    - (usAnubis.recent.sums.roundWins / usAnubis.recent.sums.rounds)) < 1e-12);

  const vetoAdvice = await loadDataset(versionDir, manifest, 'vetoAdvice');
  assert.deepEqual(
    vetoAdvice.map(({ opponentTeamId }) => opponentTeamId),
    ['pocelui', 'takahuli', 'rassadnik', 'smoke'],
  );
  for (const advice of vetoAdvice) {
    assert.equal(advice.model.version, 'veto-1');
    assert.equal(advice.ranking.length, MAP_POOL.length);
    const scores = advice.ranking.map(({ score }) => score).filter((score) => score !== null);
    assert.deepEqual(scores, [...scores].sort((left, right) => right - left));
    assert.ok(advice.ranking.every((row) => (row.score === null) === (row.band === 'no-data')));
    assert.ok(advice.ranking.every((row) => typeof row.rationale === 'string' && row.rationale.length > 0));
    assert.ok(advice.ranking.every((row) => typeof row.headline === 'string' && row.headline.length > 0
      && !/[0-9]%|player:|map-edge:/.test(row.headline)));
    assert.ok(advice.ranking.every((row) => typeof row.comfort.practiced === 'boolean'
      && typeof row.crossModelDisagreement === 'boolean'));
    assert.equal(advice.suggestedPick, advice.ranking.find(({ score }) => score !== null).map);
    assert.notEqual(advice.suggestedBan, advice.suggestedPick);
    assert.equal(advice.decisionTree.orderConfirmed, false);
    assert.ok(advice.decisionTree.branches.length > 0);
    assert.ok(advice.decisionTree.branches.every(({ trigger }) => trigger.map !== advice.suggestedBan));
  }

  const evidence = await loadDataset(versionDir, manifest, 'evidence');
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  assert.equal(evidenceIds.size, evidence.length);
  const recommendations = await loadDataset(versionDir, manifest, 'recommendations');
  assert.deepEqual(recommendations.map(({ matchId }) => matchId), ['m01', 'm02', 'm09', 'm10']);
  assert.deepEqual(recommendations.map(({ date }) => date), [
    '2026-09-30', '2026-10-01', '2026-10-21', '2026-10-22',
  ]);
  const expectedPlanEvidence = {
    pocelui: {
      threats: [
        'player:76561198033124797:recent:rating',
        'player:76561198050158798:recent:rating',
        'player:76561198251990202:recent:opening',
        'player:76561198251990202:recent:utility',
      ],
      weaknesses: ['team:pocelui:recent:clutchWinRate', 'team:pocelui:recent:rating'],
    },
    takahuli: {
      threats: [
        'player:76561198039033727:recent:rating',
        'player:76561199236099142:recent:rating',
        'player:76561198034119116:recent:utility',
      ],
      weaknesses: [
        'team:takahuli:recent:openingDiffPer100', 'team:takahuli:recent:forceWinRate',
      ],
    },
    rassadnik: {
      threats: [
        'player:76561199121744233:recent:rating',
        'player:76561198003507847:recent:rating',
      ],
      weaknesses: ['team:rassadnik:recent:retakeWinRate', 'team:rassadnik:recent:tradeRate'],
    },
    smoke: {
      threats: [
        'player:76561199223950506:recent:rating',
        'player:76561198187382895:recent:rating',
      ],
      weaknesses: [
        'team:smoke:recent:utilityDamagePerRound', 'team:smoke:recent:openingDiffPer100',
      ],
    },
  };
  for (const plan of recommendations) {
    const opponent = teams.find(({ teamId }) => teamId === plan.opponentTeamId);
    const requiredThreats = [
      ...opponent.scouting.ratingThreats.map(({ evidenceId }) => evidenceId),
      opponent.scouting.openingLeader?.evidenceId,
      opponent.scouting.utilityLeader?.evidenceId,
    ].filter(Boolean);
    assert.deepEqual([...plan.threatEvidence].sort(), [...requiredThreats].sort());
    assert.deepEqual(plan.threatEvidence, expectedPlanEvidence[plan.opponentTeamId].threats);
    assert.deepEqual(plan.weaknessEvidence, expectedPlanEvidence[plan.opponentTeamId].weaknesses);
    const exploits = new Map(opponent.scouting.exploits.map((item) => [item.evidenceId, item]));
    assert.ok(plan.weaknessEvidence.every((id) => exploits.get(id)?.delta < 0));
    const advice = vetoAdvice.find(({ opponentTeamId }) => opponentTeamId === plan.opponentTeamId);
    assert.deepEqual(plan.verdict, {
      pick: advice.suggestedPick,
      ban: advice.suggestedBan,
      backup: advice.suggestedBackup,
      source: 'veto-1',
    });
    assert.deepEqual(
      plan.mapEvidence,
      MAP_POOL.map((map) => `map-edge:${plan.opponentTeamId}:${map}`),
    );
    assert.equal(plan.maps.length, MAP_POOL.length);
    assert.ok(Array.isArray(plan.comfortConflict));
    assert.ok(plan.comfortConflict.some(({ map, verdictAction }) => (
      map === plan.verdict.ban && verdictAction === 'ban'
    )) || !['de_dust2', 'de_inferno'].includes(plan.verdict.ban));
    assert.equal(plan.snapshotRoot, EXPECTED_ROOT);
    assert.equal(plan.dataThrough, '2026-08-27');
    assert.equal(plan.reviewed, true);
    assert.ok(plan.verdict.pick && plan.verdict.ban && plan.contingency);
    assert.ok(plan.threatEvidence.length >= 2);
    assert.ok(plan.weaknessEvidence.length >= 1);
    assert.equal(plan.threats.length, plan.threatEvidence.length);
    assert.equal(plan.weaknesses.length, plan.weaknessEvidence.length);
    assert.ok(plan.threats.every(({ id, value, sampleRounds }) => (
      evidenceIds.has(id) && typeof value === 'number' && sampleRounds >= 200
    )));
    assert.ok(plan.weaknesses.every(({ id, value, samplePlayerRounds }) => (
      evidenceIds.has(id) && typeof value === 'number' && samplePlayerRounds > 0
    )));
    assert.ok(plan.do.length > 0 && plan.dont.length > 0);
    assert.equal(plan.personalTasks.length, 6);
    assert.ok(plan.trainingChecklist.length > 0 && plan.matchdayChecklist.length > 0);
    assert.ok(['high', 'medium', 'low', 'none'].includes(plan.confidence));
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

test('failed generation is clean for an empty target and preserves a valid target', async (t) => {
  const base = JSON.parse(await readFile(RECOMMENDATIONS, 'utf8'));
  base.snapshotRoot = '0'.repeat(64);
  const failureDir = await mkdtemp(join(tmpdir(), 'whoajor-atomic-failure-'));
  t.after(() => rm(failureDir, { recursive: true, force: true }));
  const configPath = join(failureDir, 'recommendations.json');
  await writeFile(configPath, `${JSON.stringify(base)}\n`);

  const emptyTarget = join(failureDir, 'empty-output');
  const emptyFailure = await execFileAsync(process.execPath, [
    GENERATOR, '--output', emptyTarget, '--recommendations', configPath,
  ]).then(() => ({ code: 0, stderr: '' }))
    .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
  assert.notEqual(emptyFailure.code, 0);
  assert.match(emptyFailure.stderr, /root mismatch/);
  await assert.rejects(readFile(join(emptyTarget, 'current.json')), /ENOENT/);
  assert.deepEqual((await readdir(failureDir)).sort(), ['recommendations.json']);

  const validTarget = await generate(t);
  const before = await fileTree(validTarget);
  const preservedFailure = await execFileAsync(process.execPath, [
    GENERATOR, '--output', validTarget, '--recommendations', configPath,
  ]).then(() => ({ code: 0, stderr: '' }))
    .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
  assert.notEqual(preservedFailure.code, 0);
  assert.match(preservedFailure.stderr, /root mismatch/);
  const after = await fileTree(validTarget);
  assert.deepEqual(after, before);
});

test('size and numeric guards enforce literal invalid boundaries', async () => {
  const webData = await import('../lib/web-data.mjs');
  const verifier = await import('../lib/verify-web-data.mjs');
  assert.equal(typeof webData.assertShardGzipSize, 'function');
  assert.doesNotThrow(() => webData.assertShardGzipSize(511999, 'boundary'));
  assert.throws(() => webData.assertShardGzipSize(512000, 'boundary'), /512000/);
  assert.equal(typeof verifier.assertFiniteNumbers, 'function');
  assert.throws(() => verifier.assertFiniteNumbers({ rating: Infinity }), /non-finite/);
});

test('verifier rejects path escapes, symlinks, stale files, duplicates, and self-rehashed data', async (t) => {
  const canonical = await generate(t);
  async function copyCase(name) {
    const parent = await mkdtemp(join(tmpdir(), `whoajor-adversarial-${name}-`));
    t.after(() => rm(parent, { recursive: true, force: true }));
    const outputDir = join(parent, 'whoajor');
    await cp(canonical, outputDir, { recursive: true });
    return { parent, outputDir };
  }

  {
    const { parent, outputDir } = await copyCase('symlink');
    const { versionDir, manifest } = await loadBuild(outputDir);
    const listed = join(versionDir, manifest.assets[0].path);
    const outside = join(parent, 'outside-asset.json');
    await writeFile(outside, await readFile(listed));
    await rm(listed);
    await symlink(outside, listed);
    await writeFile(join(versionDir, 'data', 'stale-unmanifested.json'), '{}\n');
    await expectVerifierFailure(outputDir, /symlink|unlisted/);
  }
  {
    const { parent, outputDir } = await copyCase('escape');
    const currentPath = join(outputDir, 'current.json');
    const current = JSON.parse(await readFile(currentPath, 'utf8'));
    const manifestBytes = await readFile(join(outputDir, current.manifest));
    await writeFile(join(parent, 'outside-manifest.json'), manifestBytes);
    current.manifest = '../outside-manifest.json';
    current.manifestSha256 = sha256(manifestBytes);
    await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
    await expectVerifierFailure(outputDir, /unsafe manifest path/);
  }
  {
    const { outputDir } = await copyCase('asset-duplicate');
    await rewriteManifest(outputDir, async ({ manifest }) => {
      manifest.assets.push(structuredClone(manifest.assets[0]));
    });
    await expectVerifierFailure(outputDir, /duplicate asset path/);
  }
  {
    const { outputDir } = await copyCase('detail-index');
    await rewriteManifest(outputDir, async ({ manifest }) => {
      manifest.detailIndexes.matchPlayers.matchId[
        'auto-20231116-1908-de_anubis-Whoajor'
      ] = ['data/matchRounds-000.json'];
    });
    await expectVerifierFailure(outputDir, /detail index/i);
  }
  {
    const { outputDir } = await copyCase('evidence-duplicate');
    await mutateDataset(outputDir, 'evidence', (rows) => rows.push(structuredClone(rows[0])));
    await expectVerifierFailure(outputDir, /duplicate evidence ID/);
  }
  {
    const { outputDir } = await copyCase('denominator');
    await mutateDataset(outputDir, 'playerMetrics', (rows) => {
      const player = rows.find(({ recent }) => recent.sums.rounds > 0);
      player.recent.metrics.rating = null;
    });
    await expectVerifierFailure(outputDir, /denominator invariant/);
  }
  {
    const { outputDir } = await copyCase('canonical');
    await mutateDataset(outputDir, 'playerMetrics', (rows) => {
      const player = rows.find(({ recent }) => recent.sums.rounds > 0);
      player.recent.metrics.rating = 999;
    });
    await expectVerifierFailure(outputDir, /canonical byte mismatch/);
  }
});

test('verifier proves deterministic rebuild and rejects invalid reviewed inputs or tampering', async (t) => {
  const first = await generate(t);
  const second = await generate(t);
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
  assert.ok(receipt.maxGzipBytes < 512000);

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
    ['missing evidence', (value) => { value.plans[0].caveats[0].evidenceId = 'missing:evidence'; }],
    ['unknown matchId', (value) => { value.plans[0].matchId = 'm99'; }],
    ['duplicate matchId', (value) => { value.plans[1].matchId = value.plans[0].matchId; }],
    ['threat evidence mismatch', (value) => {
      value.plans[0].threatEvidence = ['player:76561199395039271:recent:rating'];
    }],
    ['weakness is not an exploit', (value) => {
      value.plans[0].weaknessEvidence = ['team:pocelui:recent:retakeWinRate'];
    }],
    ['duplicate weakness evidence', (value) => {
      value.plans[0].weaknessEvidence = [
        'team:pocelui:recent:clutchWinRate',
        'team:pocelui:recent:clutchWinRate',
      ];
    }],
    ['verdict is computed by veto-1', (value) => {
      value.plans[0].pick = 'de_dust2';
    }],
    ['missing contingency', (value) => {
      delete value.plans[0].contingency;
    }],
  ];
  for (const [message, mutate] of mutations) {
    const configDir = await mkdtemp(join(tmpdir(), 'whoajor-review-config-'));
    t.after(() => rm(configDir, { recursive: true, force: true }));
    const configPath = join(configDir, 'recommendations.json');
    const candidate = structuredClone(base);
    mutate(candidate);
    await writeFile(configPath, `${JSON.stringify(candidate)}\n`);
    const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-invalid-build-'));
    t.after(() => rm(outputDir, { recursive: true, force: true }));
    const result = await execFileAsync(process.execPath, [
      GENERATOR, '--output', outputDir, '--recommendations', configPath,
    ]).then(() => ({ code: 0, stderr: '' }))
      .catch((error) => ({ code: error.code ?? 1, stderr: error.stderr ?? error.message }));
    assert.notEqual(result.code, 0, message);
    assert.match(result.stderr, new RegExp(message), result.stderr);
  }
});
