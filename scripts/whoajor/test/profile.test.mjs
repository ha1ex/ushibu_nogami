import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access, mkdtemp, readFile, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { collectSnapshot } from '../collect.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { buildDatabase } from '../lib/normalize.mjs';
import { profileDatabase, writeDataProfile } from '../lib/profile.mjs';
import { validateSnapshot } from '../lib/validation.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const NOW = () => new Date('2026-08-29T07:00:00Z');
const PLAYERS = ['76561198000000001', '76561198000000002'];
const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_CLI = join(HERE, '..', 'profile.mjs');

async function buildValidatedFixture() {
  const snapshotDir = await mkdtemp(join(tmpdir(), 'whoajor-profile-'));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-2', 'match-1'],
    leaderboardPlayers: PLAYERS,
    draftPlayers: [],
    detailPlayers: PLAYERS,
    roundPlayers: PLAYERS,
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  await collectSnapshot({ outputDir: snapshotDir, client, now: NOW, pageSize: 2 });
  const validation = await validateSnapshot(snapshotDir);
  assert.equal(validation.status, 'complete');
  await writeFile(
    join(snapshotDir, 'validation-report.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
  );
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  await buildDatabase(snapshotDir, dbPath);
  const db = new Database(dbPath);
  const snapshot = db.prepare('SELECT snapshot_id, source_json FROM snapshots').get();
  const snapshotSource = JSON.parse(snapshot.source_json);
  snapshotSource.sourceCounts = {
    ...snapshotSource.sourceCounts,
    matches: validation.counts.matches,
  };
  db.prepare('UPDATE snapshots SET source_json = ? WHERE snapshot_id = ?')
    .run(JSON.stringify(snapshotSource), snapshot.snapshot_id);
  db.close();
  return { dbPath, snapshotDir };
}

function resultFor(report, id) {
  return report.queries.find((query) => query.id === id)?.result;
}

test('profile фиксирует структуру, grain, SQL-сверки и стабильный complete output', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const first = profileDatabase(snapshotDir, dbPath);

  assert.equal(first.version, 2);
  assert.equal(first.status, 'complete', JSON.stringify(first.anomalies));
  assert.equal(first.blockingChecks, 0);
  assert.deepEqual(first.snapshot, {
    contractVersion: '1.1.0',
    id: basename(snapshotDir),
    rootHash: first.snapshot.rootHash,
    status: 'complete',
  });
  assert.match(first.snapshot.rootHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.integrity, {
    foreignKeyViolations: [],
    integrityCheck: [{ integrity_check: 'ok' }],
  });
  assert.deepEqual(first.matchDates, {
    max: '2026-08-28T18:00:00Z',
    min: '2026-08-27T18:00:00Z',
  });
  assert.deepEqual(first.cardinalities, {
    maps: 2,
    tags: 1,
    weapons: 2,
  });
  assert.deepEqual(first.crossCounts, {
    detailIdentityMismatch: 0,
    detailRequestCount: 2,
    matchesWithDetail: 2,
    matchesTotal: 2,
    metaTotals: [2],
    roundsActual: 4,
    roundsDeclared: 4,
    roundsPerMatchMismatch: 0,
    trendsPlayers: 2,
    trendMatches: 2,
  });
  assert.deepEqual(first.anomalies, {
    fractionalCountMetrics: 0,
    futureDates: 0,
    impossibleMetrics: 0,
    invalidDates: 0,
    invalidIds: 0,
    malformedJson: 0,
    negativeCountMetrics: 0,
  });

  const matches = first.tables.find(({ name }) => name === 'matches');
  assert.deepEqual(matches.primaryKeyColumns, ['match_id']);
  assert.equal(matches.grain, 'one row per match_id');
  assert.equal(matches.rowCount, 2);
  assert.equal(matches.duplicatePrimaryKeyRows, 0);
  assert.equal(matches.nullPrimaryKeyRows, 0);
  assert.deepEqual(
    matches.keyColumns.find(({ column }) => column === 'match_id'),
    { column: 'match_id', emptyStringCount: 0, nullCount: 0, roles: ['primary-key'] },
  );
  assert.ok(first.tables.every(({ primaryKeyColumns }) => primaryKeyColumns.length > 0));
  assert.ok(first.tables.every(({ duplicatePrimaryKeyRows }) => duplicatePrimaryKeyRows === 0));
  assert.ok(first.tables.every(({ nullPrimaryKeyRows }) => nullPrimaryKeyRows === 0));

  assert.ok(first.queries.length > first.tables.length * 3);
  assert.equal(new Set(first.queries.map(({ id }) => id)).size, first.queries.length);
  assert.ok(first.queries.every(({ id, parameters, result, sql }) => (
    typeof id === 'string'
      && Array.isArray(parameters)
      && Array.isArray(result)
      && typeof sql === 'string'
      && sql.length > 0
  )));
  assert.deepEqual(resultFor(first, 'pragma.integrity-check'), [{ integrity_check: 'ok' }]);

  const firstWritten = await writeDataProfile(snapshotDir, dbPath);
  const firstBytes = await readFile(join(snapshotDir, 'data-profile.json'), 'utf8');
  const secondWritten = await writeDataProfile(snapshotDir, dbPath);
  const secondBytes = await readFile(join(snapshotDir, 'data-profile.json'), 'utf8');
  assert.deepEqual(secondWritten, firstWritten);
  assert.equal(secondBytes, firstBytes);
  assert.deepEqual(JSON.parse(firstBytes), first);
  assert.doesNotMatch(firstBytes, /generatedAt|createdAt|durationMs/);
});

test('profile обнаруживает порчу typed и JSON значений и переводит status в incomplete', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF');
  db.prepare(`
    UPDATE matches
    SET rounds_played = -1, started_at = '2026-02-30T18:00:00Z'
    WHERE match_id = 'match-1'
  `).run();
  db.prepare(`UPDATE matches SET match_id = '' WHERE match_id = 'match-2'`).run();
  db.prepare(`UPDATE players SET steamid = 'broken-steamid' WHERE steamid = ?`).run(PLAYERS[0]);
  db.prepare(`UPDATE tags SET source_json = '{broken:' WHERE rowid = (SELECT min(rowid) FROM tags)`).run();
  db.prepare(`
    UPDATE weapons SET metrics_json = ? WHERE weapon = 'ak47'
  `).run(JSON.stringify({
    nested: {
      day: '2026-02-30',
      headshot_pct: 101,
      kills: -3,
      match_id: '',
      rounds: 1.5,
      steamid: '123',
      tSteamids: ['bad-array-steamid'],
    },
  }));
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.blockingChecks > 0);
  assert.ok(report.integrity.foreignKeyViolations.length > 0);
  assert.ok(report.crossCounts.roundsPerMatchMismatch > 0);
  assert.ok(report.anomalies.malformedJson > 0);
  assert.ok(report.anomalies.invalidIds >= 5);
  assert.ok(report.anomalies.invalidDates >= 2);
  assert.ok(report.anomalies.negativeCountMetrics >= 2);
  assert.ok(report.anomalies.fractionalCountMetrics > 0);
  assert.ok(report.anomalies.impossibleMetrics > 0);
  assert.ok(report.checks.some(({ id, status }) => id === 'data.anomalies' && status === 'fail'));
  assert.equal(report.status === 'complete', report.blockingChecks === 0);
});

test('profile сверяет identity detail requests с match IDs, а не только count', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.prepare(`
    UPDATE requests SET path = '/api/matches/not-in-matches'
    WHERE rowid = (SELECT rowid FROM requests WHERE path GLOB '/api/matches/*' LIMIT 1)
  `).run();
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.crossCounts.detailRequestCount, 2);
  assert.ok(report.crossCounts.detailIdentityMismatch > 0);
  assert.equal(report.status, 'incomplete');
});

test('profile блокирует неверные JSON scalar types и не маскирует meta count через CAST', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.prepare('UPDATE tags SET metrics_json = ?').run(JSON.stringify({
    day: 20260830,
    headshot_pct: '101',
    id: null,
    kills: '-3',
    match_id: {},
    player_id: '',
    rounds: '1.5',
    started_at: 123,
    team_id: [],
  }));
  const snapshot = db.prepare('SELECT snapshot_id, source_json FROM snapshots').get();
  const source = JSON.parse(snapshot.source_json);
  source.sourceCounts.matches = '2garbage';
  db.prepare('UPDATE snapshots SET source_json = ? WHERE snapshot_id = ?')
    .run(JSON.stringify(source), snapshot.snapshot_id);
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.anomalies.invalidIds, 4);
  assert.ok(report.anomalies.invalidDates >= 2);
  assert.ok(report.anomalies.impossibleMetrics >= 3);
  assert.deepEqual(report.crossCounts.metaTotals, [null]);
  assert.equal(report.status, 'incomplete');
});

test('profile принимает проверенные live date, local time, SQL time и RFC3339 форматы', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.prepare(`UPDATE matches SET started_at = '2026-08-28 18:00:00' WHERE match_id = 'match-2'`).run();
  db.prepare(`UPDATE draft_config SET published_at = '2026-08-29T06:00:00'`).run();
  db.prepare(`UPDATE tags SET metrics_json = ?`).run(JSON.stringify({
    afk_seconds: 24.328125,
    equivalent_team_matches: 5.6,
    max_date: '2026-08-27 20:04:00',
    min_date: '2023-11-16T19:08:00',
    started_at: '2026-08-28T18:00:00.123+03:00',
  }));
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.anomalies.invalidDates, 0);
  assert.equal(report.anomalies.fractionalCountMetrics, 0);
  assert.equal(report.status, 'complete');
});

test('dated snapshot игнорирует транспортный fetchedAt и HTTP Date при проверке будущих дат', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF');
  const datedSnapshotId = '2026-08-30-full';
  for (const { name: table } of db.pragma('table_list').filter(({ schema }) => schema === 'main')) {
    if (db.pragma(`table_info("${table.replaceAll('"', '""')}")`)
      .some(({ name }) => name === 'snapshot_id')) {
      db.prepare(`UPDATE "${table.replaceAll('"', '""')}" SET snapshot_id = ?`)
        .run(datedSnapshotId);
    }
  }
  const request = db.prepare('SELECT rowid, source_json FROM requests LIMIT 1').get();
  const requestSource = JSON.parse(request.source_json);
  requestSource.fetchedAt = '2026-09-01T00:00:00.000Z';
  requestSource.observedHeaders = {
    ...requestSource.observedHeaders,
    date: 'Sun, 30 Aug 2026 07:00:00 GMT',
  };
  db.prepare('UPDATE requests SET source_json = ? WHERE rowid = ?')
    .run(JSON.stringify(requestSource), request.rowid);
  db.pragma('foreign_keys = ON');
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.anomalies.futureDates, 0);
  assert.equal(report.anomalies.invalidDates, 0);
  assert.equal(report.status, 'complete');
});

test('match date min/max вычисляются хронологически с учётом RFC3339 offset', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.prepare(`UPDATE matches SET started_at = '2026-08-28T10:00:00-14:00' WHERE match_id = 'match-1'`).run();
  db.prepare(`UPDATE matches SET started_at = '2026-08-28T23:00:00+14:00' WHERE match_id = 'match-2'`).run();
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.deepEqual(report.matchDates, {
    max: '2026-08-28T10:00:00-14:00',
    min: '2026-08-28T23:00:00+14:00',
  });
  assert.equal(report.status, 'complete');
});

test('profile требует полный набор из 29 normalized tables', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE tags');
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  assert.equal(report.checks.find(({ id }) => id === 'schema.required-tables').status, 'fail');
  assert.equal(report.status, 'incomplete');
});

test('SQLite-discovered identifier quoting безопасно профилирует необычное имя таблицы', async () => {
  const { dbPath, snapshotDir } = await buildValidatedFixture();
  const oddTable = 'odd"name; DROP TABLE matches;--';
  const db = new Database(dbPath);
  const quoted = `"${oddTable.replaceAll('"', '""')}"`;
  db.exec(`CREATE TABLE ${quoted} ("odd""id" TEXT PRIMARY KEY, value INTEGER) STRICT`);
  db.exec('CREATE TABLE sqliteX_user_table (id TEXT PRIMARY KEY) STRICT');
  db.prepare(`INSERT INTO ${quoted}("odd""id", value) VALUES (?, ?)`).run('one', 1);
  db.prepare('INSERT INTO sqliteX_user_table(id) VALUES (?)').run('visible');
  db.close();

  const report = profileDatabase(snapshotDir, dbPath);
  const profiled = report.tables.find(({ name }) => name === oddTable);
  assert.equal(profiled.rowCount, 1);
  assert.deepEqual(profiled.primaryKeyColumns, ['odd"id']);
  assert.equal(report.tables.find(({ name }) => name === 'sqliteX_user_table').rowCount, 1);
  const verify = new Database(dbPath, { readonly: true });
  assert.equal(verify.prepare('SELECT count(*) AS n FROM matches').get().n, 2);
  verify.close();
});

test('CLI использует whoajor.sqlite/data-profile.json и не заменяет output при ошибке', async () => {
  const { snapshotDir } = await buildValidatedFixture();
  const { stderr, stdout } = await execFileAsync(process.execPath, [PROFILE_CLI, snapshotDir]);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), {
    blockingChecks: 0,
    output: join(snapshotDir, 'data-profile.json'),
    status: 'complete',
  });
  await access(join(snapshotDir, 'data-profile.json'));

  const outputPath = join(snapshotDir, 'data-profile.json');
  await writeFile(outputPath, 'keep-existing');
  await assert.rejects(
    writeDataProfile(snapshotDir, join(snapshotDir, 'missing.sqlite')),
    /unable to open database file|database file does not exist/,
  );
  assert.equal(await readFile(outputPath, 'utf8'), 'keep-existing');
});
