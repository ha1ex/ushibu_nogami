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
import { canonicalStringify, sha256Hex } from '../lib/canonical-json.mjs';
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
  'trend_matches', 'trend_players',
].sort((left, right) => left.localeCompare(right));

async function buildValidatedFixture({
  duplicateAlias = false,
  duplicateMatchTag = false,
  priorityCollision = false,
  rich = false,
  trustValidationErrors = false,
  drawRound = false,
  legacyClutchWithoutStartTick = false,
} = {}) {
  const snapshotDir = await mkdtemp(join(tmpdir(), 'whoajor-normalize-'));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-2', 'match-1'],
    leaderboardPlayers: duplicateAlias ? [...PLAYERS, PLAYERS[0]] : PLAYERS,
    draftPlayers: [],
    detailPlayers: PLAYERS,
    roundPlayers: PLAYERS,
    drawRound,
    legacyClutchWithoutStartTick,
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: rich || duplicateMatchTag || priorityCollision ? async (url, options) => {
      const response = await fixture.fetch(url, options);
      const payload = await response.json();
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;
      if (priorityCollision) {
        const sharedPlayer = {
          steamid: PLAYERS[0],
          name: 'Player 01',
          matches: 1,
          rounds_played: 2,
          rating2: 1.05,
          kills: 2,
          shots: 20,
          matches_total: 2,
        };
        if (path === '/api/leaderboard') payload[0] = sharedPlayer;
        if (path === `/api/players/${PLAYERS[0]}/summary`) payload[0] = sharedPlayer;
        if (/^\/api\/weapons\/[^/]+$/.test(path) && !parsedUrl.search) payload[0] = sharedPlayer;
      }
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

test('normalizer сохраняет draw round с nullable winner', async () => {
  const snapshotDir = await buildValidatedFixture({ drawRound: true });
  const dbPath = join(snapshotDir, 'draw-round.sqlite');
  await buildDatabase(snapshotDir, dbPath);
  const db = new Database(dbPath, { readonly: true });
  const draw = db.prepare("select winner, reason from match_rounds where reason = 'draw'").get();
  assert.deepEqual(draw, { winner: null, reason: 'draw' });
  db.close();
});

test('normalizer сохраняет legacy clutch без startTick на source-array grain', async () => {
  const snapshotDir = await buildValidatedFixture({ legacyClutchWithoutStartTick: true });
  const dbPath = join(snapshotDir, 'legacy-clutch.sqlite');

  await buildDatabase(snapshotDir, dbPath);

  const db = new Database(dbPath, { readonly: true });
  const clutches = db.prepare(`
    select clutch_index, round, start_tick
    from player_clutches
    order by clutch_index`).all();
  assert.deepEqual(clutches, [
    { clutch_index: 0, round: 1, start_tick: null },
    { clutch_index: 1, round: 1, start_tick: 256 },
  ]);
  assert.deepEqual(db.pragma('table_info(player_clutches)')
    .filter(({ pk }) => pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(({ name }) => name), ['match_id', 'steamid', 'clutch_index']);
  db.close();
});

test('normalizer сохраняет сущности, FK и весь source_json', async () => {
  const snapshotDir = await buildValidatedFixture({ rich: true });
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const first = await buildDatabase(snapshotDir, dbPath);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.pragma('foreign_key_check').length, 0);
  assert.deepEqual(first.counts, {
    requests: 26,
    matches: 2,
    matchDetails: 2,
    players: 2,
    weapons: 2,
    tags: 1,
    trendsPlayers: 2,
    trendMatches: 2,
  });
  assert.equal(db.prepare('select count(*) n from matches').get().n, 2);
  assert.equal(db.prepare('select count(*) n from matches where has_detail = 1').get().n, 2);
  assert.equal(db.prepare('select count(*) n from match_rounds').get().n, 4);
  assert.equal(db.prepare('select typeof(steamid) t from players limit 1').get().t, 'text');
  assert.ok(JSON.parse(db.prepare('select source_json j from match_players limit 1').get().j));
  assert.deepEqual(JSON.parse(db.prepare('select metrics_json j from match_players limit 1').get().j), {});
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
  const playerLineage = JSON.parse(playerMaster.metrics_json);
  assert.equal(playerLineage.selectedSourceSha256, sha256Hex(playerMaster.source_json));
  assert.ok(playerLineage.sourceVariants.length >= 4);
  assert.ok(playerLineage.sourceVariants.every((variant) => (
    Object.keys(variant).sort().join(',') === 'reference,sha256'
      && /^[a-f0-9]{64}$/.test(variant.sha256)
      && typeof variant.reference.requestKey === 'string'
      && typeof variant.reference.sourcePath === 'string'
  )));
  const weaponMaster = db.prepare('select source_json, metrics_json from weapons where weapon = ?')
    .get('ak47');
  assert.deepEqual(JSON.parse(weaponMaster.source_json), {
    kills: 2,
    players: 1,
    shots: 20,
    weapon: 'ak47',
  });
  const weaponLineage = JSON.parse(weaponMaster.metrics_json);
  assert.equal(weaponLineage.selectedSourceSha256, sha256Hex(weaponMaster.source_json));
  assert.ok(weaponLineage.sourceVariants.length >= 2);
  assert.ok(!weaponMaster.metrics_json.includes('"kills"'));

  const manifestForLineage = JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8'));
  const resolveSourcePath = (payload, sourcePath) => {
    assert.match(sourcePath, /^\$(?:(?:\.[A-Za-z_$][A-Za-z0-9_$]*)|(?:\[\d+\]))*$/);
    const tokens = [...sourcePath.matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g)]
      .map((match) => match[1] ?? Number(match[2]));
    return tokens.reduce((value, token) => value[token], payload);
  };
  for (const lineage of [playerLineage, weaponLineage]) {
    for (const variant of lineage.sourceVariants) {
      const entry = manifestForLineage.requests.find((candidate) => (
        candidate.key === variant.reference.requestKey
          && (candidate.boundaryRole ?? 'ordinary') === variant.reference.observationRole
      ));
      assert.ok(entry, `lineage request must exist: ${variant.reference.requestKey}`);
      const payload = JSON.parse(await readFile(join(snapshotDir, entry.blob), 'utf8'));
      const exactSource = resolveSourcePath(payload, variant.reference.sourcePath);
      assert.equal(sha256Hex(canonicalStringify(exactSource)), variant.sha256);
    }
  }
  assert.equal(db.prepare('select count(*) n from match_tags').get().n, 2);
  assert.equal(db.prepare('select count(*) n from player_side_stats').get().n, 8);
  assert.equal(db.prepare('select count(*) n from player_clutches').get().n, 4);
  assert.equal(db.prepare('select count(*) n from draft_igls').get().n, 1);

  const trendPlayer = db.prepare(`
    select player_index, steamid, name, rounds_total, source_json, lineage_json
    from trend_players order by player_index limit 1`).get();
  assert.equal(trendPlayer.player_index, 0);
  assert.equal(trendPlayer.steamid, PLAYERS[0]);
  assert.equal(trendPlayer.name, 'Player 01');
  assert.equal(trendPlayer.rounds_total, 2);
  const trendPlayerSource = JSON.parse(trendPlayer.source_json);
  assert.equal(trendPlayerSource.steamid, PLAYERS[0]);
  assert.equal(trendPlayerSource.matches.length, 1);
  assert.deepEqual(JSON.parse(trendPlayer.lineage_json), {
    endpoint: 'trends',
    observationRole: 'ordinary',
    requestKey: 'GET /api/trends?top=2',
    sourcePath: '$[0]',
    sourceSha256: sha256Hex(trendPlayer.source_json),
  });

  const trendMatch = db.prepare(`
    select player_index, match_index, steamid, started_at, map, match_name,
           adr, assists, cs_good, cs_graded, cs_stop_fast, cs_stop_slow,
           damage, deaths, dpr, flash_assists, hs_kills, impact, kast_pct,
           kast_rounds, kills, kpr, opening_deaths, opening_kills, ping_n,
           ping_sum, rating2, rounds_played, rounds_won, rws_sum, stop_ms_n,
           stop_ms_sum, ttd_adj_sum, ttd_n, ttd_sum, source_json, lineage_json
    from trend_matches order by player_index, match_index limit 1`).get();
  assert.deepEqual({
    player_index: trendMatch.player_index,
    match_index: trendMatch.match_index,
    steamid: trendMatch.steamid,
    started_at: trendMatch.started_at,
    map: trendMatch.map,
    match_name: trendMatch.match_name,
  }, {
    player_index: 0,
    match_index: 0,
    steamid: PLAYERS[0],
    started_at: '2026-08-28T18:00:00Z',
    map: 'de_mirage',
    match_name: 'match-1',
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(JSON.parse(trendMatch.source_json))
      .filter(([, value]) => typeof value === 'number')),
    Object.fromEntries(Object.entries(trendMatch)
      .filter(([key]) => ![
        'player_index', 'match_index', 'source_json', 'lineage_json',
      ].includes(key) && typeof trendMatch[key] === 'number')),
  );
  assert.deepEqual(JSON.parse(trendMatch.lineage_json), {
    endpoint: 'trends',
    observationRole: 'ordinary',
    requestKey: 'GET /api/trends?top=2',
    sourcePath: '$[0].matches[0]',
    sourceSha256: sha256Hex(trendMatch.source_json),
  });

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
  assert.deepEqual(pk('player_clutches'), ['match_id', 'steamid', 'clutch_index']);
  assert.deepEqual(pk('leaderboard_snapshots'), [
    'snapshot_id', 'query_fingerprint', 'steamid',
  ]);
  assert.deepEqual(pk('player_map_snapshots'), [
    'snapshot_id', 'query_fingerprint', 'steamid', 'map',
  ]);
  assert.deepEqual(pk('trend_players'), [
    'snapshot_id', 'query_fingerprint', 'player_index',
  ]);
  assert.deepEqual(pk('trend_matches'), [
    'snapshot_id', 'query_fingerprint', 'player_index', 'match_index',
  ]);
  const trendPlayerColumns = Object.fromEntries(
    db.pragma('table_info(trend_players)').map(({ name, type }) => [name, type]),
  );
  assert.equal(trendPlayerColumns.rounds_total, 'REAL');
  const trendMatchColumns = Object.fromEntries(
    db.pragma('table_info(trend_matches)').map(({ name, type }) => [name, type]),
  );
  for (const field of [
    'adr', 'assists', 'cs_good', 'cs_graded', 'cs_stop_fast', 'cs_stop_slow',
    'damage', 'deaths', 'dpr', 'flash_assists', 'hs_kills', 'impact', 'kast_pct',
    'kast_rounds', 'kills', 'kpr', 'opening_deaths', 'opening_kills', 'ping_n',
    'ping_sum', 'rating2', 'rounds_played', 'rounds_won', 'rws_sum', 'stop_ms_n',
    'stop_ms_sum', 'ttd_adj_sum', 'ttd_n', 'ttd_sum',
  ]) assert.equal(trendMatchColumns[field], 'REAL', `${field} must preserve CONTRACT number values`);
  assert.ok(db.pragma('foreign_key_list(round_rosters)').length >= 2);
  assert.ok(db.pragma('foreign_key_list(player_rounds)').length >= 2);
  assert.ok(db.pragma('foreign_key_list(trend_matches)').length >= 2);

  const manifest = JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8'));
  const metaStart = manifest.requests.find((entry) => (
    entry.path === '/api/meta' && entry.boundaryRole === 'start'
  ));
  assert.ok(!db.pragma('table_info(requests)').some(({ name }) => name === 'source_body'));
  const storedMeta = db.prepare(`
    select body_sha256, source_json from requests
    where request_key = ? and observation_role = 'start'`).get(metaStart.key);
  const storedMetaSource = JSON.parse(storedMeta.source_json);
  const rawMetaBody = await readFile(join(snapshotDir, storedMetaSource.blob), 'utf8');
  assert.equal(storedMetaSource.blob, metaStart.blob);
  assert.equal(storedMeta.body_sha256, sha256Hex(rawMetaBody));
  assert.equal(db.prepare(`
    select count(*) n from requests
    where path in ('/api/meta', '/api/matches') and observation_role in ('start', 'end')
  `).get().n, 4);

  const roster = db.prepare(`
    select rr.source_json, mr.source_json round_source_json
    from round_rosters rr
    join match_rounds mr using (match_id, round)
    limit 1`).get();
  const rosterSource = JSON.parse(roster.source_json);
  assert.deepEqual(Object.keys(rosterSource).sort(), ['provenance', 'steamid']);
  assert.equal(
    rosterSource.provenance.roundSourceSha256,
    sha256Hex(roster.round_source_json),
  );
  assert.match(rosterSource.provenance.sourcePath, /^\$\.rounds\[\d+\]\.(?:tSteamids|ctSteamids)\[\d+\]$/);
  const rosterEntry = manifestForLineage.requests.find((candidate) => (
    candidate.key === rosterSource.provenance.requestKey
      && (candidate.boundaryRole ?? 'ordinary') === rosterSource.provenance.observationRole
  ));
  assert.ok(rosterEntry);
  const rosterPayload = JSON.parse(await readFile(join(snapshotDir, rosterEntry.blob), 'utf8'));
  assert.equal(resolveSourcePath(rosterPayload, rosterSource.provenance.sourcePath), rosterSource.steamid);

  const alias = db.prepare('select steamid, alias, source_json from player_aliases limit 1').get();
  const aliasSource = JSON.parse(alias.source_json);
  assert.deepEqual(Object.keys(aliasSource).sort(), ['name', 'provenance', 'steamid']);
  assert.equal(aliasSource.steamid, alias.steamid);
  assert.equal(aliasSource.name, alias.alias);
  const aliasEntry = manifestForLineage.requests.find((candidate) => (
    candidate.key === aliasSource.provenance.requestKey
      && (candidate.boundaryRole ?? 'ordinary') === aliasSource.provenance.observationRole
  ));
  assert.ok(aliasEntry);
  const aliasPayload = JSON.parse(await readFile(join(snapshotDir, aliasEntry.blob), 'utf8'));
  const aliasEvidence = resolveSourcePath(aliasPayload, aliasSource.provenance.sourcePath);
  assert.equal(sha256Hex(canonicalStringify(aliasEvidence)), aliasSource.provenance.sourceSha256);
  assert.equal(aliasEvidence.steamid, alias.steamid);
  assert.equal(aliasEvidence.name, alias.alias);

  for (const table of [
    'leaderboard_snapshots', 'match_player_weapons', 'match_players', 'match_rounds',
    'meta_maps', 'player_clutches', 'player_map_snapshots', 'player_match_stats',
    'player_rounds', 'player_side_stats', 'player_weapon_daily_stats',
    'player_weapon_stats', 'tags', 'weapon_daily_stats', 'weapon_splits',
  ]) {
    assert.equal(
      db.prepare(`select count(*) n from ${table} where metrics_json <> '{}'`).get().n,
      0,
      `${table}.metrics_json must not duplicate source_json`,
    );
  }
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

test('fingerprint потоково читает строки в PK-порядке без materializing all rows', async () => {
  const { computeDataFingerprint } = await import('../lib/normalize.mjs');
  const preparedSql = [];
  const fakeDb = {
    pragma(statement) {
      if (statement === 'table_list') return [{ schema: 'main', name: 'synthetic' }];
      if (statement === 'table_info("synthetic")') {
        return [
          { cid: 0, name: 'entity_id', pk: 1 },
          { cid: 1, name: 'source_json', pk: 0 },
        ];
      }
      throw new Error(`unexpected pragma ${statement}`);
    },
    prepare(sql) {
      preparedSql.push(sql);
      return {
        all() { throw new Error('fingerprint must not materialize rows with all()'); },
        *iterate() {
          yield { entity_id: 'a', source_json: '{"value":1}' };
          yield { entity_id: 'b', source_json: '{"value":2}' };
        },
      };
    },
  };

  assert.match(computeDataFingerprint(fakeDb), /^[a-f0-9]{64}$/);
  assert.match(preparedSql[0], /ORDER BY "entity_id"/);
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

test('перестановка manifest observations не меняет master sources, variants и fingerprint', async () => {
  const snapshotDir = await buildValidatedFixture({ priorityCollision: true });
  const firstPath = join(snapshotDir, 'ordered.sqlite');
  const first = await buildDatabase(snapshotDir, firstPath);
  const readMasters = (path) => {
    const db = new Database(path, { readonly: true });
    const masters = {
      players: db.prepare('select steamid, source_json, metrics_json from players order by steamid').all(),
      weapons: db.prepare('select weapon, source_json, metrics_json from weapons order by weapon').all(),
    };
    db.close();
    return masters;
  };
  const firstMasters = readMasters(firstPath);
  const manifestPath = join(snapshotDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rank = (entry) => {
    if (entry.boundaryRole === 'start') return 0;
    if (entry.boundaryRole === 'end') return 4;
    if (/^\/api\/weapons\/[^/]+$/.test(entry.path) && Object.keys(entry.query).length === 0) return 1;
    if (/^\/api\/matches\/[^/]+$/.test(entry.path)) return 2;
    return 3;
  };
  manifest.requests.sort((left, right) => rank(left) - rank(right));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const secondPath = join(snapshotDir, 'permuted.sqlite');
  const second = await buildDatabase(snapshotDir, secondPath);
  assert.deepEqual(readMasters(secondPath), firstMasters);
  assert.equal(second.dataFingerprint, first.dataFingerprint);
});

test('HTTP transport metadata не меняет fingerprint', async () => {
  const snapshotDir = await buildValidatedFixture();
  const first = await buildDatabase(snapshotDir, join(snapshotDir, 'transport-before.sqlite'));
  const manifestPath = join(snapshotDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.requests.forEach((entry, index) => {
    entry.fetchedAt = `2031-01-01T00:00:${String(index).padStart(2, '0')}Z`;
    entry.durationMs = 10_000 + index;
    entry.url = `https://transport-only.invalid/${index}`;
    entry.contentType = 'application/json; transport-rewrite=true';
    entry.contentLength = String(90_000 + index);
    entry.observedHeaders = {
      date: 'Mon, 01 Jan 2031 00:00:00 GMT',
      'server-timing': `edge;dur=${index}`,
      'x-request-id': `request-${index}`,
      'cf-cache-status': 'HIT',
    };
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const second = await buildDatabase(snapshotDir, join(snapshotDir, 'transport-after.sqlite'));

  assert.equal(second.dataFingerprint, first.dataFingerprint);
});

test('status, path, query, body hash и entity mutations меняют fingerprint', async () => {
  const snapshotDir = await buildValidatedFixture();
  const dbPath = join(snapshotDir, 'semantic-mutations.sqlite');
  const built = await buildDatabase(snapshotDir, dbPath);
  const { computeDataFingerprint } = await import('../lib/normalize.mjs');
  const db = new Database(dbPath);
  const request = db.prepare('select rowid, * from requests limit 1').get();
  const mutations = [
    ['update requests set path = ? where rowid = ?', `${request.path}/changed`, request.rowid],
    ['update requests set query_json = ? where rowid = ?', '{"changed":"1"}', request.rowid],
    ['update requests set body_sha256 = ? where rowid = ?', '0'.repeat(64), request.rowid],
  ];
  for (const [sql, ...params] of mutations) {
    db.exec('BEGIN');
    db.prepare(sql).run(...params);
    assert.notEqual(computeDataFingerprint(db), built.dataFingerprint);
    db.exec('ROLLBACK');
  }
  const requestSource = JSON.parse(request.source_json);
  requestSource.status = 201;
  db.exec('BEGIN');
  db.prepare('update requests set source_json = ? where rowid = ?')
    .run(JSON.stringify(requestSource), request.rowid);
  assert.notEqual(computeDataFingerprint(db), built.dataFingerprint);
  db.exec('ROLLBACK');
  db.exec('BEGIN');
  db.prepare('update tags set metrics_json = ? where rowid = (select min(rowid) from tags)')
    .run('{"semantic":"changed"}');
  assert.notEqual(computeDataFingerprint(db), built.dataFingerprint);
  db.exec('ROLLBACK');
  db.close();
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
