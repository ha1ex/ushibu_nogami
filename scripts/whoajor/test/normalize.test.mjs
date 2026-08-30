import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access, mkdtemp, readFile, readdir, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { collectSnapshot } from '../collect.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { buildDatabase } from '../lib/normalize.mjs';
import { validateSnapshot } from '../lib/validation.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const NOW = () => new Date('2026-08-29T07:00:00Z');
const PLAYERS = ['76561198000000001', '76561198000000002'];
const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const NORMALIZE_CLI = join(HERE, '..', 'normalize.mjs');
const REPO_ROOT = join(HERE, '..', '..', '..');
const TABLES = [
  'draft_config', 'draft_igls', 'draft_players', 'leaderboard_snapshots',
  'match_player_weapons', 'match_players', 'match_rounds', 'match_tags', 'matches',
  'meta_maps', 'player_aliases', 'player_clutches', 'player_map_snapshots',
  'player_match_stats', 'player_rounds', 'player_side_stats', 'player_weapon_daily_stats',
  'player_weapon_stats', 'players', 'requests', 'round_rosters', 'snapshots',
  'source_discrepancies', 'tags', 'weapon_daily_stats', 'weapon_splits', 'weapons',
];

async function buildValidatedFixture({
  duplicateAlias = false,
  duplicateMatchTag = false,
  rich = false,
  trustValidationErrors = false,
} = {}) {
  const snapshotDir = await mkdtemp(join(tmpdir(), 'whoajor-normalize-'));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-2', 'match-1'],
    leaderboardPlayers: duplicateAlias ? [...PLAYERS, PLAYERS[0]] : PLAYERS,
    draftPlayers: [],
    detailPlayers: PLAYERS,
    roundPlayers: PLAYERS,
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: rich || duplicateMatchTag ? async (url, options) => {
      const response = await fixture.fetch(url, options);
      const payload = await response.json();
      const path = new URL(url).pathname;
      if (rich && path === '/api/draft-config') payload.igls = [PLAYERS[0]];
      if (/^\/api\/matches\/[^/]+$/.test(path)) {
        if (rich || duplicateMatchTag) {
          payload.tags = duplicateMatchTag ? ['featured', 'featured'] : ['featured'];
        }
        if (rich) {
          for (const player of payload.players) {
            player.bySide = {
              T: { kills: 2, utility: { damage: 17 } },
              CT: { kills: 1, utility: { damage: 9 } },
            };
            player.clutches = [{ round: 1, startTick: 128, won: true }];
          }
        }
      }
      return new Response(JSON.stringify(payload), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    } : fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  await collectSnapshot({ outputDir: snapshotDir, client, now: NOW, pageSize: 2 });
  const report = await validateSnapshot(snapshotDir);
  if (trustValidationErrors) {
    report.status = 'complete';
    report.errors = [];
  }
  assert.equal(report.status, 'complete');
  await writeFile(
    join(snapshotDir, 'validation-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return snapshotDir;
}

test('normalizer сохраняет сущности, FK и весь source_json', async () => {
  const snapshotDir = await buildValidatedFixture({ rich: true });
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const first = await buildDatabase(snapshotDir, dbPath);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.pragma('foreign_key_check').length, 0);
  assert.deepEqual(first.counts, {
    requests: 25,
    matches: 2,
    matchDetails: 2,
    players: 2,
    weapons: 2,
    tags: 1,
  });
  assert.equal(db.prepare('select count(*) n from matches').get().n, 2);
  assert.equal(db.prepare('select count(*) n from matches where has_detail = 1').get().n, 2);
  assert.equal(db.prepare('select count(*) n from match_rounds').get().n, 4);
  assert.equal(db.prepare('select typeof(steamid) t from players limit 1').get().t, 'text');
  assert.ok(JSON.parse(db.prepare('select source_json j from match_players limit 1').get().j));
  assert.ok(JSON.parse(db.prepare('select metrics_json j from match_players limit 1').get().j).perRound);
  const playerMaster = db.prepare('select display_name, source_json, metrics_json from players where steamid = ?')
    .get(PLAYERS[0]);
  assert.equal(playerMaster.display_name, 'Player 01');
  assert.deepEqual(JSON.parse(playerMaster.source_json), {
    matches: 2,
    name: 'Player 01',
    rating2: 1.05,
    rounds_played: 4,
    steamid: PLAYERS[0],
  });
  assert.ok(JSON.parse(playerMaster.metrics_json).sourceVariants.length >= 4);
  const weaponMaster = db.prepare('select source_json, metrics_json from weapons where weapon = ?')
    .get('ak47');
  assert.deepEqual(JSON.parse(weaponMaster.source_json), {
    kills: 2,
    players: 1,
    shots: 20,
    weapon: 'ak47',
  });
  assert.ok(JSON.parse(weaponMaster.metrics_json).sourceVariants.some((row) => (
    row.weapon === 'ak47' && row.kills === 1
  )));
  assert.equal(db.prepare('select count(*) n from match_tags').get().n, 2);
  assert.equal(db.prepare('select count(*) n from player_side_stats').get().n, 8);
  assert.equal(db.prepare('select count(*) n from player_clutches').get().n, 4);
  assert.equal(db.prepare('select count(*) n from draft_igls').get().n, 1);

  const actualTables = db.pragma('table_list')
    .filter((row) => row.schema === 'main' && !row.name.startsWith('sqlite_'))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(actualTables.map(({ name }) => name), TABLES);
  assert.ok(actualTables.every(({ strict }) => strict === 1));
  for (const table of TABLES) {
    const columns = db.pragma(`table_info(${table})`);
    assert.ok(columns.some(({ name }) => name === 'source_json'), `${table} must retain source_json`);
    for (const { source_json: sourceJson } of db.prepare(`select source_json from ${table}`).all()) {
      assert.doesNotThrow(() => JSON.parse(sourceJson), `${table}.source_json must be JSON`);
    }
  }

  const pk = (table) => db.pragma(`table_info(${table})`)
    .filter(({ pk: position }) => position > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(({ name }) => name);
  assert.deepEqual(pk('match_rounds'), ['match_id', 'round']);
  assert.deepEqual(pk('round_rosters'), ['match_id', 'round', 'side', 'steamid']);
  assert.deepEqual(pk('player_rounds'), ['match_id', 'steamid', 'round']);
  assert.deepEqual(pk('player_clutches'), ['match_id', 'steamid', 'round', 'start_tick']);
  assert.deepEqual(pk('leaderboard_snapshots'), [
    'snapshot_id', 'query_fingerprint', 'steamid',
  ]);
  assert.deepEqual(pk('player_map_snapshots'), [
    'snapshot_id', 'query_fingerprint', 'steamid', 'map',
  ]);
  assert.ok(db.pragma('foreign_key_list(round_rosters)').length >= 2);
  assert.ok(db.pragma('foreign_key_list(player_rounds)').length >= 2);

  const manifest = JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8'));
  const metaStart = manifest.requests.find((entry) => (
    entry.path === '/api/meta' && entry.boundaryRole === 'start'
  ));
  const storedMeta = db.prepare(`
    select source_body from requests
    where request_key = ? and observation_role = 'start'`).get(metaStart.key);
  assert.equal(storedMeta.source_body, await readFile(join(snapshotDir, metaStart.blob), 'utf8'));
  assert.equal(db.prepare(`
    select count(*) n from requests
    where path in ('/api/meta', '/api/matches') and observation_role in ('start', 'end')
  `).get().n, 4);
  db.close();

  manifest.requests.forEach((entry, index) => {
    entry.fetchedAt = `2030-01-01T00:00:${String(index).padStart(2, '0')}Z`;
    entry.durationMs = 999 + index;
  });
  await writeFile(join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const secondPath = join(snapshotDir, 'whoajor-second.sqlite');
  const second = await buildDatabase(snapshotDir, secondPath);
  assert.equal(first.dataFingerprint, second.dataFingerprint);
});

test('normalizer отклоняет stale validation report до создания target', async () => {
  const snapshotDir = await buildValidatedFixture();
  const reportPath = join(snapshotDir, 'validation-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.rootHash = '0'.repeat(64);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const dbPath = join(snapshotDir, 'stale.sqlite');

  await assert.rejects(buildDatabase(snapshotDir, dbPath), /validation report is stale/);
  await assert.rejects(access(dbPath), { code: 'ENOENT' });
});

test('normalizer не принимает incomplete validation report', async () => {
  const snapshotDir = await buildValidatedFixture();
  const reportPath = join(snapshotDir, 'validation-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.status = 'incomplete';
  report.errors.push({ code: 'TEST_ERROR', location: 'fixture', message: 'blocked' });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  await assert.rejects(
    buildDatabase(snapshotDir, join(snapshotDir, 'incomplete.sqlite')),
    /complete validation report without errors/,
  );
});

test('validation counts требуют exact ключи и неотрицательные целые значения', async () => {
  const snapshotDir = await buildValidatedFixture();
  const reportPath = join(snapshotDir, 'validation-report.json');
  const validReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const invalidCounts = [
    {},
    { ...validReport.counts, extra: 0 },
    { ...validReport.counts, requests: -1 },
    { ...validReport.counts, matches: 1.5 },
    { ...validReport.counts, tags: null },
  ];
  for (const [index, counts] of invalidCounts.entries()) {
    await writeFile(
      reportPath,
      `${JSON.stringify({ ...validReport, counts }, null, 2)}\n`,
    );
    await assert.rejects(
      buildDatabase(snapshotDir, join(snapshotDir, `invalid-counts-${index}.sqlite`)),
      /validation report counts must contain exactly/,
    );
  }
});

test('fingerprint читается из всех semantic SQLite rows', async () => {
  const snapshotDir = await buildValidatedFixture({ rich: true });
  const dbPath = join(snapshotDir, 'fingerprint.sqlite');
  const built = await buildDatabase(snapshotDir, dbPath);
  const normalizer = await import('../lib/normalize.mjs');
  assert.equal(typeof normalizer.computeDataFingerprint, 'function');
  const db = new Database(dbPath);
  assert.equal(normalizer.computeDataFingerprint(db), built.dataFingerprint);
  const aliases = db.prepare('select * from player_aliases').all();
  const reinsertAlias = db.prepare(`
    insert into player_aliases(
      snapshot_id, steamid, alias, source_fingerprint, source_json
    ) values (?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare('delete from player_aliases').run();
    for (const row of aliases.reverse()) {
      reinsertAlias.run(
        row.snapshot_id, row.steamid, row.alias, row.source_fingerprint, row.source_json,
      );
    }
  })();
  assert.equal(normalizer.computeDataFingerprint(db), built.dataFingerprint);
  db.prepare('delete from player_side_stats where rowid = (select min(rowid) from player_side_stats)').run();
  const afterDroppedRow = normalizer.computeDataFingerprint(db);
  db.close();

  assert.notEqual(afterDroppedRow, built.dataFingerprint);
});

test('изменение source discrepancy меняет fingerprint при тех же raw responses', async () => {
  const snapshotDir = await buildValidatedFixture();
  const first = await buildDatabase(snapshotDir, join(snapshotDir, 'before-discrepancy.sqlite'));
  const reportPath = join(snapshotDir, 'validation-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.discrepancies.push({
    code: 'REVIEW_FIXTURE',
    location: '/api/meta',
    message: 'same raw, changed audited discrepancy',
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const second = await buildDatabase(snapshotDir, join(snapshotDir, 'after-discrepancy.sqlite'));

  assert.notEqual(first.dataFingerprint, second.dataFingerprint);
});

test('ошибка после transaction удаляет временную базу и не публикует target', async () => {
  const snapshotDir = await buildValidatedFixture();
  const reportPath = join(snapshotDir, 'validation-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.counts.tags += 1;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const dbPath = join(snapshotDir, 'broken.sqlite');

  await assert.rejects(buildDatabase(snapshotDir, dbPath), /SQLite count mismatch for tags/);
  await assert.rejects(access(dbPath), { code: 'ENOENT' });
  assert.deepEqual(
    (await readdir(snapshotDir)).filter((name) => name.startsWith('broken.sqlite.tmp-')),
    [],
  );
});

for (const [label, options, expectedTable] of [
  ['match tag', { duplicateMatchTag: true }, 'match_tags'],
  ['player alias', { duplicateAlias: true, trustValidationErrors: true }, 'player_aliases'],
]) {
  test(`duplicate ${label} падает жёстко и сохраняет существующий target`, async () => {
    const snapshotDir = await buildValidatedFixture(options);
    const dbPath = join(snapshotDir, `duplicate-${label.replace(' ', '-')}.sqlite`);
    await writeFile(dbPath, 'existing-target');

    await assert.rejects(buildDatabase(snapshotDir, dbPath), new RegExp(expectedTable));
    assert.equal(await readFile(dbPath, 'utf8'), 'existing-target');
    assert.deepEqual(
      (await readdir(snapshotDir)).filter((name) => name.startsWith(`${dbPath.split('/').at(-1)}.tmp-`)),
      [],
    );
  });
}

test('корневая команда CLI использует default database path', async () => {
  const snapshotDir = await buildValidatedFixture();
  const { stdout, stderr } = await execFileAsync('corepack', [
    'pnpm', 'whoajor:build-db', '--', snapshotDir,
  ], { cwd: REPO_ROOT });

  assert.equal(stderr, '');
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.counts.matches, 2);
  await access(join(snapshotDir, 'whoajor.sqlite'));
});

test('CLI принимает literal -- и override database path', async () => {
  const snapshotDir = await buildValidatedFixture();
  const dbPath = join(snapshotDir, 'cli.sqlite');
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    NORMALIZE_CLI, '--', snapshotDir, dbPath,
  ]);

  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.counts.matches, 2);
  assert.match(result.dataFingerprint, /^[a-f0-9]{64}$/);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  db.close();
});

test('CLI отклоняет отсутствие snapshot и лишние positional args', async () => {
  for (const args of [[], ['--'], ['one', 'two', 'three']]) {
    await assert.rejects(
      execFileAsync(process.execPath, [NORMALIZE_CLI, ...args]),
      ({ stderr }) => /usage: whoajor:build-db/.test(stderr),
    );
  }
});
