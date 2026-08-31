import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const siteRoot = path.resolve(import.meta.dirname, '..');
const source = await readFile(path.join(siteRoot, 'assets/js/stats-core.js'), 'utf8');
const sandbox = { TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, crypto: globalThis.crypto };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'stats-core.js' });
const Core = sandbox.StatsCore;

function fileFetch(url) {
  const normalized = new URL(url, 'https://hq.test').pathname;
  const target = path.resolve(siteRoot, '.' + normalized);
  if (!target.startsWith(siteRoot + path.sep)) return Promise.resolve({ ok: false, status: 403 });
  return readFile(target).then((buffer) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }), () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
}

test('route loading plan requests only decision datasets for overview and bounded grains for lists', () => {
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'overview' })), [
    'rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence', 'teamMapStats', 'vetoAdvice', 'playerMetrics'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'team', teamId: 'pocelui' })), [
    'rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence', 'teamMapStats', 'vetoAdvice', 'playerMetrics'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'player', steamid: '76561198050158798' })), [
    'players', 'playerMetrics', 'rosters'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'match', matchId: 'm01' })), [
    'recommendations', 'evidence', 'rosters', 'matches', 'teamMetrics', 'mapEdges', 'teamMapStats', 'vetoAdvice'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'maps' })), ['maps']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'weapons' })), ['weapons']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'trends' })), ['trendPlayers']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'quality' })), ['quality']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'mirror' })), [
    'rosters', 'teamMetrics', 'mirrorScouting', 'evidence'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'mirrorTeam', teamId: 'smoke' })), [
    'rosters', 'teamMetrics', 'mirrorScouting', 'playerMetrics', 'evidence'
  ]);
});

test('canonical artifact carries a mirror report per opponent with closed evidence', async () => {
  const client = Core.createClient(fileFetch);
  await client.open();
  const [mirrors, advice, evidence, rosters, teamMetrics, recommendations] = await Promise.all([
    client.dataset('mirrorScouting'), client.dataset('vetoAdvice'), client.dataset('evidence'),
    client.dataset('rosters'), client.dataset('teamMetrics'), client.dataset('recommendations')
  ]);
  assert.deepEqual(Array.from(mirrors, (row) => row.opponentTeamId).sort(), [
    'pocelui', 'rassadnik', 'smoke', 'takahuli'
  ]);
  const evidenceIds = new Set(evidence.map((row) => row.id));
  const teamNames = new Map(rosters.map((row) => [row.teamId, row.name]));
  const planByOpponent = new Map(recommendations.map((row) => [row.opponentTeamId, row]));
  const adviceById = new Map(advice.map((row) => [row.opponentTeamId, row]));
  for (const mirror of mirrors) {
    assert.equal(mirror.opponentName, teamNames.get(mirror.opponentTeamId));
    assert.equal(mirror.maps.length, 7);
    assert.equal(mirror.metricEdges.length, 12);
    // Зеркало обязано оставаться тем же движком veto-1 с обратным знаком.
    const scoreByMap = new Map(adviceById.get(mirror.opponentTeamId).ranking.map((row) => [row.map, row.score]));
    for (const map of mirror.maps) {
      const ours = scoreByMap.get(map.map);
      assert.equal(map.theirScore, ours === null ? null : -ours);
    }
    const plan = planByOpponent.get(mirror.opponentTeamId);
    assert.equal(mirror.ourPlan.matchId, plan.matchId);
    assert.equal(mirror.ourPlan.pick, plan.verdict.pick);
    assert.equal(mirror.clash.pickContested, mirror.likelyBan === plan.verdict.pick);
    assert.equal(mirror.clash.banConfirmed, mirror.likelyPick === plan.verdict.ban);
    const references = [
      ...mirror.maps.map((row) => row.evidenceId),
      ...mirror.metricEdges.flatMap((row) => [row.usEvidenceId, row.opponentEvidenceId]),
      ...mirror.focusTargets.map((row) => row.evidenceId),
      ...mirror.softTargets.map((row) => row.evidenceId),
      ...mirror.caveatEvidenceIds
    ];
    assert.ok(references.every((id) => evidenceIds.has(id)), mirror.opponentTeamId);
    for (const target of [...mirror.focusTargets, ...mirror.softTargets]) {
      assert.equal(typeof target.steamid, 'string');
      assert.ok(target.sampleRounds >= mirror.sufficientSampleRounds);
    }
  }
  // Ранги лиги доступны всем пяти командам, не только нам.
  for (const team of teamMetrics) {
    assert.equal(Object.keys(team.scouting.leagueRanks).length, 12);
    assert.ok(Object.values(team.scouting.leagueRanks).every(({ rank, of }) => (
      of === 5 && rank >= 1 && rank <= 5
    )));
  }
});

test('keyed detail API verifies and fetches only the indexed shard for one source match', async () => {
  const matchId = 'auto-20231116-1908-de_anubis-Whoajor';
  const seen = [];
  const client = Core.createClient((url) => {
    seen.push(url);
    return fileFetch(url);
  });
  const rows = await client.datasetForKey('matchPlayers', 'matchId', matchId);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.matchId === matchId));
  const state = await client.open();
  assert.deepEqual(seen, [
    '/assets/data/whoajor/current.json',
    `/assets/data/whoajor/${state.pointer.version}/manifest.json`,
    `/assets/data/whoajor/${state.pointer.version}/data/matchPlayers-000.json`,
  ]);
  await assert.rejects(() => client.dataset('matchPlayers'), /keyed detail|ключ/i);
});
