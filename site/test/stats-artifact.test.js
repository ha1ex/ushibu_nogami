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
    'rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'team', teamId: 'pocelui' })), [
    'rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'player', steamid: '76561198050158798' })), [
    'players', 'playerMetrics', 'playerMapStats', 'playerWeaponStats', 'trendMatches', 'rosters'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'match', matchId: 'm01' })), [
    'recommendations', 'evidence', 'rosters', 'matches'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'maps' })), ['maps']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'weapons' })), ['weapons']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'trends' })), ['trendPlayers']);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'quality' })), ['quality']);
});

test('canonical artifact exposes every dashboard population through verified manifest assets', async () => {
  const client = Core.createClient(fileFetch);
  const state = await client.open();
  assert.equal(state.manifest.root, state.pointer.root);

  const [players, matches, maps, weapons, trendPlayers, rosters, recommendations, evidence] = await Promise.all([
    client.dataset('players'), client.dataset('matches'), client.dataset('maps'), client.dataset('weapons'),
    client.dataset('trendPlayers'), client.dataset('rosters'), client.dataset('recommendations'), client.dataset('evidence')
  ]);
  assert.equal(players.length, 81);
  assert.equal(matches.length, 368);
  assert.equal(maps.length, 46);
  assert.equal(weapons.length, 39);
  assert.equal(trendPlayers.length, 20);
  assert.equal(rosters.length, 5);
  assert.deepEqual(Array.from(recommendations, (row) => row.matchId), ['m01', 'm02', 'm09', 'm10']);

  const evidenceIds = new Set(evidence.map((row) => row.id));
  for (const recommendation of recommendations) {
    assert.equal(Core.validateRecommendation(recommendation, state.manifest, evidenceIds), recommendation);
  }
  for (const player of players) assert.equal(typeof player.steamid, 'string');
});
