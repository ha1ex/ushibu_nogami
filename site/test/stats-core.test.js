import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/stats-core.js', import.meta.url), 'utf8');
const sandbox = { TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, crypto: globalThis.crypto };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'stats-core.js' });
const Core = sandbox.StatsCore;

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fixture() {
  const pointer = {
    schemaVersion: 1,
    version: 'v1-aaaaaaaaaaaaaaaa',
    root: 'a'.repeat(64),
    manifest: 'v1-aaaaaaaaaaaaaaaa/manifest.json',
    manifestSha256: 'b'.repeat(64)
  };
  const manifest = {
    schemaVersion: 1,
    contractVersion: '1.1.0',
    version: pointer.version,
    root: pointer.root,
    window: { recentStart: '2026-05-29', recentEnd: '2026-08-27' },
    counts: { players: 81, matches: 368 },
    detailIndexes: {
      matchPlayers: { matchId: { 'auto-probe': ['data/matchPlayers-000.json'] } },
      matchRounds: { matchId: { 'auto-probe': ['data/matchRounds-000.json'] } },
      matchPlayerWeapons: { matchId: { 'auto-probe': ['data/matchPlayerWeapons-000.json'] } },
      playerClutches: { steamid: { '76561198050158798': ['data/playerClutches-000.json'] } },
      playerMapStats: {
        steamid: { '76561198050158798': ['data/playerMapStats-000.json'] },
        map: { de_anubis: ['data/playerMapStats-000.json'] }
      },
      playerWeaponStats: {
        steamid: { '76561198050158798': ['data/playerWeaponStats-000.json'] },
        weapon: { ak47: ['data/playerWeaponStats-000.json'] }
      },
      trendMatches: { steamid: { '76561198050158798': ['data/trendMatches-000.json'] } }
    },
    assets: [
      { dataset: 'players', path: 'data/players-000.json', count: 81, bytes: 10, gzipBytes: 8, sha256: 'c'.repeat(64) },
      { dataset: 'recommendations', path: 'data/recommendations-000.json', count: 4, bytes: 10, gzipBytes: 8, sha256: 'd'.repeat(64) },
      ...['matchPlayers', 'matchRounds', 'matchPlayerWeapons', 'playerClutches', 'playerMapStats', 'playerWeaponStats', 'trendMatches'].map((dataset) => ({
        dataset, path: `data/${dataset}-000.json`, count: 1, bytes: 10, gzipBytes: 8, sha256: 'e'.repeat(64)
      }))
    ]
  };
  return { pointer, manifest };
}

test('parseHash preserves exact neutral statistics drill-downs', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(Core.parseHash('#/statistika')), { tab: 'statistics', view: 'overview', path: '#/statistika' });
  assert.deepEqual(plain(Core.parseHash('#/statistika/team/pocelui')), {
    tab: 'statistics', view: 'team', teamId: 'pocelui', path: '#/statistika/team/pocelui'
  });
  assert.deepEqual(plain(Core.parseHash('#/statistika/igrok/76561198050158798')), {
    tab: 'statistics', view: 'player', steamid: '76561198050158798', path: '#/statistika/igrok/76561198050158798'
  });
  assert.deepEqual(plain(Core.parseHash('#/statistika/match/m01')), {
    tab: 'statistics', view: 'match', matchId: 'm01', path: '#/statistika/match/m01'
  });
  for (const view of ['maps', 'weapons', 'trends', 'quality']) {
    assert.deepEqual(plain(Core.parseHash(`#/statistika/${view}`)), {
      tab: 'statistics', view, path: `#/statistika/${view}`
    });
  }
});

test('parseHash rejects encoded separators, malformed SteamIDs and unknown statistics routes locally', () => {
  for (const hash of [
    '#/statistika/sopernik/pocelui%2Fextra',
    '#/statistika/igrok/7656119805015879',
    '#/statistika/igrok/76561198050158798/extra',
    '#/statistika/neizvestno',
    '#/statistika/match/%E0%A4%A'
  ]) {
    const route = Core.parseHash(hash);
    assert.equal(route.tab, 'statistics');
    assert.equal(route.view, 'invalid');
    assert.equal(route.path, '#/statistika');
    assert.match(route.reason, /нет данных/i);
  }
});

test('href encodes only validated route identifiers and keeps SteamID a string', () => {
  assert.equal(Core.href('team', 'pocelui'), '#/statistika/team/pocelui');
  assert.equal(Core.href('player', '76561198050158798'), '#/statistika/igrok/76561198050158798');
  assert.equal(Core.href('match', 'auto-20231116-1908-de_anubis-Whoajor'), '#/statistika/match/auto-20231116-1908-de_anubis-Whoajor');
  assert.throws(() => Core.href('player', 76561198050158798), /строкой/i);
  assert.throws(() => Core.href('team', '../private'), /идентификатор/i);
});

test('validateManifest accepts only pointer-pinned roots and allowlisted relative assets', () => {
  const { pointer, manifest } = fixture();
  assert.equal(Core.validateManifest(pointer, manifest), manifest);
  assert.throws(() => Core.validateManifest(pointer, { ...manifest, root: 'e'.repeat(64) }), /root/i);
  assert.throws(() => Core.validateManifest(pointer, {
    ...manifest,
    assets: [{ ...manifest.assets[0], path: '../players.json' }]
  }), /путь/i);
  assert.throws(() => Core.validateManifest(pointer, {
    ...manifest,
    assets: [{ ...manifest.assets[0], path: 'data/players-000.json' }, { ...manifest.assets[0] }]
  }), /повтор/i);
});

for (const [name, mutate] of [
  ['empty detailIndexes', (manifest) => { manifest.detailIndexes = {}; }],
  ['absent required detail dataset', (manifest) => { delete manifest.detailIndexes.matchRounds; }],
  ['absent required detail field', (manifest) => { delete manifest.detailIndexes.playerMapStats.map; }],
  ['extra detail dataset', (manifest) => { manifest.detailIndexes.rogue = {}; }],
  ['extra detail field', (manifest) => { manifest.detailIndexes.matchPlayers.round = {}; }]
]) {
  test(`validateManifest rejects ${name}`, () => {
    const { pointer, manifest } = fixture();
    mutate(manifest);
    assert.throws(() => Core.validateManifest(pointer, manifest), /detail index/i);
  });
}

test('verifyBytes fails closed on an exact response SHA mismatch', async () => {
  const bytes = new TextEncoder().encode('{"ok":true}');
  assert.equal(await Core.verifyBytes(bytes, sha('{"ok":true}')), true);
  await assert.rejects(() => Core.verifyBytes(bytes, '0'.repeat(64)), /SHA-256/i);
  await assert.rejects(() => Core.verifyBytes(bytes, sha('{"ok":true}'), null), /Web Crypto/i);
});

test('dataset selection uses manifest entries', () => {
  const { manifest } = fixture();
  assert.deepEqual(Core.assetsFor(manifest, 'players'), [manifest.assets[0]]);
  assert.throws(() => Core.assetsFor(manifest, '../players'), /dataset/i);
});

test('sortRows is deterministic and does not mutate source rows', () => {
  const rows = [{ name: 'Zed', rating: 1 }, { name: 'Alpha', rating: 1 }, { name: 'Beta', rating: 2 }];
  assert.deepEqual(Core.sortRows(rows, 'rating', 'descending').map((row) => row.name), ['Beta', 'Zed', 'Alpha']);
  assert.deepEqual(rows.map((row) => row.name), ['Zed', 'Alpha', 'Beta']);
});

test('data client performs no request until explicitly opened', async () => {
  const seen = [];
  const client = Core.createClient(async (url) => {
    seen.push(url);
    return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  assert.deepEqual(seen, []);
  await assert.rejects(() => client.open(), /current\.json|500/);
  assert.deepEqual(seen, ['/assets/data/whoajor/current.json']);
});

test('data client revalidates only the mutable pointer and lets immutable assets use browser cache', async () => {
  const completeContract = fixture().manifest;
  const dataset = JSON.stringify({ schemaVersion: 1, root: 'a'.repeat(64), dataset: 'players', rows: [{ steamid: '76561198050158798' }] });
  const manifest = JSON.stringify({
    schemaVersion: 1,
    contractVersion: '1.1.0',
    version: 'v1-aaaaaaaaaaaaaaaa',
    root: 'a'.repeat(64),
    window: { recentStart: '2026-05-29', recentEnd: '2026-08-27' },
    counts: { players: 1 },
    detailIndexes: completeContract.detailIndexes,
    assets: [
      { dataset: 'players', path: 'data/players-000.json', count: 1, sha256: sha(dataset) },
      ...completeContract.assets.slice(2)
    ]
  });
  const pointer = JSON.stringify({
    schemaVersion: 1,
    version: 'v1-aaaaaaaaaaaaaaaa',
    root: 'a'.repeat(64),
    manifest: 'v1-aaaaaaaaaaaaaaaa/manifest.json',
    manifestSha256: sha(manifest)
  });
  const bodies = new Map([
    ['/assets/data/whoajor/current.json', pointer],
    ['/assets/data/whoajor/v1-aaaaaaaaaaaaaaaa/manifest.json', manifest],
    ['/assets/data/whoajor/v1-aaaaaaaaaaaaaaaa/data/players-000.json', dataset]
  ]);
  const seen = [];
  const client = Core.createClient(async (url, options) => {
    seen.push({ url, cache: options.cache });
    const bytes = new TextEncoder().encode(bodies.get(url));
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
  });
  await client.dataset('players');
  assert.deepEqual(seen.map((request) => request.cache), ['no-cache', undefined, undefined]);
});
