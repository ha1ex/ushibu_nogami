import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSnapshot, parseCliArgs } from '../collect.mjs';
import { discoverPlayers, discoverWeapons } from '../lib/discovery.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const NOW = () => new Date('2026-08-29T07:00:00Z');

async function runFixture(fixture, options = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-collect-'));
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  const manifest = await collectSnapshot({
    outputDir,
    client,
    now: NOW,
    pageSize: 1,
    ...options,
  });
  return { manifest, outputDir };
}

test('collector обходит все конечные сущности ровно один раз', async () => {
  const fixture = createFixtureApi();
  const { manifest } = await runFixture(fixture);

  assert.equal(manifest.status, 'collected');
  assert.equal(manifest.sourceCounts.matches, 2);
  assert.deepEqual(manifest.discovered.players, [
    '76561198000000001', '76561198000000002', '76561198000000003',
  ]);
  assert.deepEqual(manifest.discovered.weapons, ['ak47', 'awp']);
  assert.ok(manifest.requests.some((row) => (
    row.key.includes('/api/players/76561198000000003/maps')
  )));
  assert.ok(manifest.requests.some((row) => row.key.includes('/api/weapons/ak47?by=day')));
  fixture.assertNoUnexpectedCalls();
});

test('match pagination делает overlap, удаляет дубль ID и запрашивает detail один раз', async () => {
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-3', 'match-2', 'match-1'],
  });
  const { manifest } = await runFixture(fixture, { pageSize: 2 });

  assert.equal(manifest.sourceCounts.matches, 3);
  assert.deepEqual(
    fixture.calls.filter(({ key }) => key.startsWith('/api/matches?')).map(({ key }) => key),
    [
      '/api/matches?limit=2&offset=0',
      '/api/matches?limit=2&offset=1',
      '/api/matches?limit=2&offset=0',
    ],
  );
  for (const id of ['match-1', 'match-2', 'match-3']) {
    assert.equal(fixture.routeCounts.get(`/api/matches/${id}`), 1);
  }
  assert.equal(manifest.requests.filter(({ path }) => path.startsWith('/api/matches/')).length, 3);
  fixture.assertNoUnexpectedCalls();
});

test('изменение total между страницами завершает snapshot как unstable', async () => {
  const fixture = createFixtureApi({ totalDriftAtOffset: 1 });
  const { manifest } = await runFixture(fixture);

  assert.equal(manifest.status, 'unstable');
  assert.match(manifest.failure.message, /total.*changed/i);
  assert.deepEqual(
    fixture.calls.map(({ key }) => key),
    [
      '/api/meta',
      '/api/tags',
      '/api/draft-config',
      '/api/matches?limit=1&offset=0',
      '/api/matches?limit=1&offset=1',
    ],
  );
});

test('изменение первой страницы на конечной границе помечает snapshot unstable', async () => {
  const fixture = createFixtureApi({ boundaryDrift: true });
  const { manifest, outputDir } = await runFixture(fixture);

  assert.equal(manifest.status, 'unstable');
  assert.match(manifest.failure.message, /match head.*changed/i);
  const headBodies = manifest.requests.filter(({ path, query }) => (
    path === '/api/matches' && query.limit === 1 && query.offset === 0
  ));
  assert.equal(headBodies.length, 2);
  assert.equal(new Set(headBodies.map(({ bodySha256 }) => bodySha256)).size, 2);
  const storedBodies = await Promise.all(
    headBodies.map(({ blob }) => readFile(join(outputDir, blob), 'utf8')),
  );
  assert.deepEqual(
    storedBodies.map((body) => JSON.parse(body).matches[0].id).sort(),
    ['match-2', 'match-new'],
  );
});

test('player matches не получает limit, а by=day endpoints получают только by=day', async () => {
  const fixture = createFixtureApi();
  const { manifest } = await runFixture(fixture);
  const playerMatchRequests = manifest.requests.filter(({ path }) => path.endsWith('/matches')
    && path.startsWith('/api/players/'));

  assert.equal(playerMatchRequests.length, 3);
  assert.ok(playerMatchRequests.every(({ query }) => Object.keys(query).length === 0));
  assert.equal(manifest.requests.filter(({ query }) => query.by === 'day').length, 5);
  assert.ok(manifest.requests.filter(({ query }) => query.by === 'day')
    .every(({ query }) => Object.keys(query).length === 1));
});

test('players объединяются из leaderboard, draft, match details и round rosters', () => {
  assert.deepEqual(discoverPlayers({
    leaderboard: [{ steamid: '4' }, { steamid: '1' }],
    draftConfig: { players: [{ steamid: '3' }] },
    matchDetails: [{
      players: [{ steamid: '2' }],
      rounds: [{ tSteamids: ['5'], ctSteamids: ['6', '1'] }],
    }],
  }), ['1', '2', '3', '4', '5', '6']);
});

test('collector запрашивает player endpoints для SteamID из каждого discovery source', async () => {
  const fixture = createFixtureApi({
    leaderboardPlayers: ['4'],
    draftPlayers: ['3'],
    detailPlayers: ['2'],
    roundPlayers: ['1', '4'],
  });
  const { manifest } = await runFixture(fixture);

  assert.deepEqual(manifest.discovered.players, ['1', '2', '3', '4']);
  fixture.assertNoUnexpectedCalls();
});

test('weapons объединяются из индекса, player payloads и match details', () => {
  assert.deepEqual(discoverWeapons({
    weapons: [{ weapon: 'awp' }],
    playerWeapons: [[{ weapon: 'm4a1' }]],
    matchDetails: [{ players: [{ weapons: [{ weapon: 'ak47' }] }] }],
  }), ['ak47', 'awp', 'm4a1']);
});

test('match и player detail queues сортируются независимо от порядка discovery', async () => {
  const fixture = createFixtureApi({
    matchIds: ['match-z', 'match-a'],
    leaderboardPlayers: ['30', '10', '20'],
    draftPlayers: [],
    detailPlayers: [],
    roundPlayers: ['20', '10'],
    weapons: ['zeta', 'alpha'],
  });
  await runFixture(fixture);

  const matchDetails = fixture.calls
    .map(({ key }) => key)
    .filter((key) => /^\/api\/matches\/[^?]+$/.test(key));
  assert.deepEqual(matchDetails, ['/api/matches/match-a', '/api/matches/match-z']);

  const summaries = fixture.calls
    .map(({ key }) => key)
    .filter((key) => key.endsWith('/summary'));
  assert.deepEqual(summaries, [
    '/api/players/10/summary',
    '/api/players/20/summary',
    '/api/players/30/summary',
  ]);

  const weaponDetails = fixture.calls
    .map(({ key }) => key)
    .filter((key) => /^\/api\/weapons\/[^?]+$/.test(key));
  assert.deepEqual(weaponDetails, ['/api/weapons/alpha', '/api/weapons/zeta']);
});

test('schema failure оставляет manifest incomplete и пробрасывает ошибку', async () => {
  const fixture = createFixtureApi();
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-collect-bad-schema-'));
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === '/api/tags') {
        return new Response('[{"tag":4,"matches":2}]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return fixture.fetch(url, options);
    },
    delayMs: 0,
    maxRetries: 0,
  });

  await assert.rejects(
    collectSnapshot({ outputDir, client, now: NOW, pageSize: 1 }),
    /tags.*tag.*string/i,
  );
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'incomplete');
  assert.ok(manifest.requests.some(({ path }) => path === '/api/tags'),
    'response must be stored before collector schema parsing');
});

test('JSON parse failure оставляет staging manifest incomplete', async () => {
  const fixture = createFixtureApi({ malformedPath: '/api/tags' });
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-collect-bad-json-'));
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });

  await assert.rejects(
    collectSnapshot({ outputDir, client, now: NOW, pageSize: 1 }),
    /not valid JSON/i,
  );
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'incomplete');
  assert.equal(manifest.failure.type, 'collection-error');
  const malformedEntry = manifest.requests.find(({ path }) => path === '/api/tags');
  assert.ok(malformedEntry, 'malformed successful response must be linked from manifest');
  assert.equal(malformedEntry.canonicalSha256, null);
  assert.equal(await readFile(join(outputDir, malformedEntry.blob), 'utf8'), '{"broken":');
});

test('JSON parse failure на повторной boundary-проверке остаётся incomplete, не unstable', async () => {
  const fixture = createFixtureApi({ malformedBoundaryPath: '/api/meta' });
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-collect-bad-boundary-json-'));
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });

  await assert.rejects(
    collectSnapshot({ outputDir, client, now: NOW, pageSize: 1 }),
    /not valid JSON/i,
  );
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'incomplete');
});

test('resume проверяет partial snapshot и не повторяет уже сохранённые endpoints', async () => {
  const fixture = createFixtureApi();
  const outputDir = await mkdtemp(join(tmpdir(), 'whoajor-collect-resume-'));
  let failDraftOnce = true;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === '/api/draft-config' && failDraftOnce) {
      failDraftOnce = false;
      return new Response('{"error":"temporary"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return fixture.fetch(url, options);
  };
  const makeClient = () => createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl,
    delayMs: 0,
    maxRetries: 0,
  });

  await assert.rejects(
    collectSnapshot({ outputDir, client: makeClient(), now: NOW, pageSize: 1 }),
    /status 503/,
  );
  const partial = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(partial.status, 'incomplete');

  const manifest = await collectSnapshot({
    outputDir,
    client: makeClient(),
    now: NOW,
    pageSize: 1,
    resume: true,
  });
  assert.equal(manifest.status, 'collected');
  assert.equal(fixture.routeCounts.get('/api/tags'), 1);
  fixture.assertNoUnexpectedCalls();
});

test('CLI принимает output, base URL, pacing, page size и resume без скрытых defaults', () => {
  assert.deepEqual(parseCliArgs([
    '--output', '.context/whoajor-staging/2026-08-29T070000Z',
    '--base-url', 'https://fixture.whoajor.test',
    '--delay-ms', '0',
    '--page-size', '2',
    '--resume',
  ]), {
    outputDir: '.context/whoajor-staging/2026-08-29T070000Z',
    baseUrl: 'https://fixture.whoajor.test',
    delayMs: 0,
    pageSize: 2,
    resume: true,
  });
});
