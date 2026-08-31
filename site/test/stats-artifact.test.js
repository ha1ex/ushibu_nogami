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

test('route loading plan never requests recommendation content', () => {
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'overview' })), [
    'rosters', 'teamMetrics', 'mapEdges'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'team', teamId: 'pocelui' })), [
    'rosters', 'teamMetrics', 'mapEdges'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'player', steamid: '76561198050158798' })), [
    'players', 'playerMetrics', 'rosters'
  ]);
  assert.deepEqual(Array.from(Core.datasetsForRoute({ view: 'match', matchId: 'm01' })), [
    'matches'
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

  const [players, matches, maps, weapons, trendPlayers, rosters] = await Promise.all([
    client.dataset('players'), client.dataset('matches'), client.dataset('maps'), client.dataset('weapons'),
    client.dataset('trendPlayers'), client.dataset('rosters')
  ]);
  assert.equal(players.length, 81);
  assert.equal(matches.length, 368);
  assert.equal(maps.length, 46);
  assert.equal(weapons.length, 39);
  assert.equal(trendPlayers.length, 20);
  assert.equal(rosters.length, 5);
  for (const player of players) assert.equal(typeof player.steamid, 'string');
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
  assert.deepEqual(seen, [
    '/assets/data/whoajor/current.json',
    '/assets/data/whoajor/v1-84a051d7989725f2/manifest.json',
    '/assets/data/whoajor/v1-84a051d7989725f2/data/matchPlayers-000.json',
  ]);
  await assert.rejects(() => client.dataset('matchPlayers'), /keyed detail|ключ/i);
});
