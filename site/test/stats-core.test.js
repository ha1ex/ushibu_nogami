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
    assets: [
      { dataset: 'players', path: 'data/players-000.json', count: 81, bytes: 10, gzipBytes: 8, sha256: 'c'.repeat(64) },
      { dataset: 'recommendations', path: 'data/recommendations-000.json', count: 4, bytes: 10, gzipBytes: 8, sha256: 'd'.repeat(64) }
    ]
  };
  return { pointer, manifest };
}

test('parseHash preserves legacy routes and exact statistics drill-downs', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(Core.parseHash('#/obzor')), { tab: 'overview', path: '#/obzor' });
  assert.deepEqual(plain(Core.parseHash('#/statistika')), { tab: 'statistics', view: 'overview', path: '#/statistika' });
  assert.deepEqual(plain(Core.parseHash('#/statistika/sopernik/pocelui')), {
    tab: 'statistics', view: 'team', teamId: 'pocelui', path: '#/statistika/sopernik/pocelui'
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
  assert.equal(Core.href('team', 'pocelui'), '#/statistika/sopernik/pocelui');
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

test('verifyBytes fails closed on an exact response SHA mismatch', async () => {
  const bytes = new TextEncoder().encode('{"ok":true}');
  assert.equal(await Core.verifyBytes(bytes, sha('{"ok":true}')), true);
  await assert.rejects(() => Core.verifyBytes(bytes, '0'.repeat(64)), /SHA-256/i);
  await assert.rejects(() => Core.verifyBytes(bytes, sha('{"ok":true}'), null), /Web Crypto/i);
});

test('validateRecommendation requires reviewed root freshness and complete evidence closure', () => {
  const { manifest } = fixture();
  const evidence = new Set(['map-edge:pocelui:de_anubis', 'limitation:cohesion']);
  const rec = {
    matchId: 'm01', opponentTeamId: 'pocelui', reviewed: true,
    snapshotRoot: manifest.root, dataThrough: manifest.window.recentEnd,
    mapEvidence: ['map-edge:pocelui:de_anubis'], threatEvidence: [], weaknessEvidence: [],
    caveats: [{ evidenceId: 'limitation:cohesion', text: 'Сыгранность не измерена.' }]
  };
  assert.equal(Core.validateRecommendation(rec, manifest, evidence), rec);
  assert.throws(() => Core.validateRecommendation({ ...rec, reviewed: false }, manifest, evidence), /reviewed/i);
  assert.throws(() => Core.validateRecommendation({ ...rec, snapshotRoot: 'f'.repeat(64) }, manifest, evidence), /root/i);
  assert.throws(() => Core.validateRecommendation({ ...rec, dataThrough: '2026-08-26' }, manifest, evidence), /устарел/i);
  assert.throws(() => Core.validateRecommendation({ ...rec, mapEvidence: ['missing'] }, manifest, evidence), /evidence/i);
  assert.throws(() => Core.validateRecommendation({ ...rec, threats: [{ id: 'missing-embedded' }] }, manifest, evidence), /evidence/i);
});

test('dataset selection uses manifest entries and readiness keys are controlled', () => {
  const { manifest } = fixture();
  assert.deepEqual(Core.assetsFor(manifest, 'players'), [manifest.assets[0]]);
  assert.throws(() => Core.assetsFor(manifest, '../players'), /dataset/i);
  assert.equal(Core.scoutKey('m01', 'brief-read'), 'scout-v1-m01-brief-read');
  assert.throws(() => Core.scoutKey('m01', 'free-form-task'), /task/i);
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
  const dataset = JSON.stringify({ schemaVersion: 1, root: 'a'.repeat(64), dataset: 'players', rows: [{ steamid: '76561198050158798' }] });
  const manifest = JSON.stringify({
    schemaVersion: 1,
    contractVersion: '1.1.0',
    version: 'v1-aaaaaaaaaaaaaaaa',
    root: 'a'.repeat(64),
    window: { recentStart: '2026-05-29', recentEnd: '2026-08-27' },
    counts: { players: 1 },
    assets: [{ dataset: 'players', path: 'data/players-000.json', count: 1, sha256: sha(dataset) }]
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
