import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStringify, normalizeQuery, requestKey, sha256Hex,
} from '../lib/canonical-json.mjs';
import { CONTRACT, buildUrl } from '../lib/contract.mjs';

test('canonicalStringify сортирует object keys и сохраняет порядок arrays', () => {
  assert.equal(canonicalStringify({ z: 1, a: { d: 2, c: [3, 1] } }),
    '{"a":{"c":[3,1],"d":2},"z":1}');
});

test('requestKey не зависит от порядка query params', () => {
  assert.equal(normalizeQuery([['offset', '100'], ['limit', '50']]), 'limit=50&offset=100');
  assert.equal(requestKey('/api/matches', { offset: 100, limit: 50 }),
    'GET /api/matches?limit=50&offset=100');
});

test('normalizeQuery канонизирует порядок значений у дублирующихся ключей', () => {
  assert.equal(normalizeQuery([['tag', 'b'], ['tag', 'a']]), 'tag=a&tag=b');
  assert.equal(normalizeQuery([['tag', 'a'], ['tag', 'b']]), 'tag=a&tag=b');
});

test('sha256Hex воспроизводим', () => {
  assert.equal(sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('buildUrl кодирует уже подставленный path ID, сортирует query и запрещает не-API пути', () => {
  const url = buildUrl(
    'https://stats.whoajor.com',
    '/api/weapons/ak 47/ß',
    { offset: 100, limit: 50 },
  );

  assert.equal(url.href, 'https://stats.whoajor.com/api/weapons/ak%2047%2F%C3%9F?limit=50&offset=100');
  assert.throws(() => buildUrl('https://stats.whoajor.com', '/health'), /only \/api\//);
  assert.throws(() => buildUrl('https://stats.whoajor.com', '/api/../health'), /only \/api\//);
});

test('CONTRACT v1 содержит полный замороженный API-инвентарь с ключевыми дескрипторами', () => {
  assert.equal(CONTRACT.version, '1.0.0');
  assert.equal(Object.isFrozen(CONTRACT), true);
  assert.equal(Object.isFrozen(CONTRACT.endpoints), true);
  assert.equal(Object.isFrozen(CONTRACT.endpoints.matches), true);
  assert.deepEqual(Object.keys(CONTRACT.endpoints).sort(), [
    'draftConfig', 'leaderboard', 'matchDetail', 'matches', 'meta', 'playerMaps',
    'playerMatches', 'playerSummary', 'playerWeapons', 'playerWeaponsByDay', 'tags',
    'weaponDetail', 'weaponDetailByDay', 'weaponSplits', 'weapons',
  ]);
  assert.deepEqual(CONTRACT.endpoints.matches.required, {
    matches: 'array',
    total: 'number',
  });
  assert.equal(CONTRACT.endpoints.matches.primaryKey({ id: 'm-1' }), 'm-1');
  assert.equal(CONTRACT.endpoints.playerWeaponsByDay.primaryKey(
    { weapon: 'ak47', day: '2026-08-29' }, { steamid: '76561198000000001' },
  ), ['76561198000000001', 'ak47', '2026-08-29'].join('\0'));
  assert.equal(CONTRACT.entities.playerRound.primaryKey(
    { round: 13 }, { matchId: 'm-1', steamid: '76561198000000001' },
  ), ['m-1', '76561198000000001', '13'].join('\0'));
});
