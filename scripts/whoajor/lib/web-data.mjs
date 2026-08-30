import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildCalculatedDatasets } from './calculate-web-data.mjs';

export const CANONICAL_ROOT = '84a051d7989725f22fd8bc37969f9308b2282edcdc61bf6b3477a021d8c71ee2';
export const VERSION = 'v1-84a051d7989725f2';
export const RECENT_WINDOW = Object.freeze({
  recentStart: '2026-05-29',
  recentEnd: '2026-08-27',
});
export const GAMEPLAY_TABLES = Object.freeze([
  ['draft_config', 'draftConfig'], ['draft_igls', 'draftIgls'],
  ['draft_players', 'draftPlayers'], ['leaderboard_snapshots', 'leaderboardSnapshots'],
  ['match_player_weapons', 'matchPlayerWeapons'], ['match_players', 'matchPlayers'],
  ['match_rounds', 'matchRounds'], ['match_tags', 'matchTags'], ['matches', 'matches'],
  ['meta_maps', 'maps'], ['player_aliases', 'playerAliases'],
  ['player_clutches', 'playerClutches'], ['player_map_snapshots', 'playerMapStats'],
  ['player_match_stats', 'playerMatchStats'], ['player_rounds', 'playerRounds'],
  ['player_side_stats', 'playerSideStats'],
  ['player_weapon_daily_stats', 'playerWeaponDailyStats'],
  ['player_weapon_stats', 'playerWeaponStats'], ['players', 'players'],
  ['round_rosters', 'roundRosters'], ['tags', 'tags'],
  ['trend_matches', 'trendMatches'], ['trend_players', 'trendPlayers'],
  ['weapon_daily_stats', 'weaponDailyStats'], ['weapon_splits', 'weaponSplits'],
  ['weapons', 'weapons'],
]);

export function assertShardGzipSize(gzipBytes, label) {
  if (gzipBytes >= 512000) throw new Error(`${label} gzip size ${gzipBytes} must be < 512000`);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compactJson(value) {
  return `${JSON.stringify(value)}\n`;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function scalar(db, sql) {
  return db.prepare(sql).get().value;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function publishTree(stagingDir, outputDir) {
  const parent = dirname(outputDir);
  await mkdir(parent, { recursive: true });
  let backupDir = null;
  if (await pathExists(outputDir)) {
    backupDir = await mkdtemp(join(parent, `.${basename(outputDir)}-backup-`));
    await rm(backupDir, { recursive: true });
    await rename(outputDir, backupDir);
  }
  try {
    await rename(stagingDir, outputDir);
  } catch (error) {
    if (backupDir && await pathExists(backupDir) && !(await pathExists(outputDir))) {
      await rename(backupDir, outputDir);
    }
    throw error;
  }
  if (backupDir) await rm(backupDir, { recursive: true, force: true });
}

function sourceCounts(db) {
  return {
    players: scalar(db, 'select count(*) value from players'),
    matches: scalar(db, 'select count(*) value from matches'),
    rounds: scalar(db, 'select count(*) value from match_rounds'),
    maps: scalar(db, 'select count(*) value from meta_maps'),
    weapons: scalar(db, 'select count(*) value from weapons'),
    trendPlayers: scalar(db, 'select count(*) value from trend_players'),
    trendMatches: scalar(db, 'select count(*) value from trend_matches'),
    playerRounds: scalar(db, 'select count(*) value from player_rounds'),
    matchPlayerWeapons: scalar(db, 'select count(*) value from match_player_weapons'),
    playerClutches: scalar(db, 'select count(*) value from player_clutches'),
    leaderboardSnapshots: scalar(db, 'select count(*) value from leaderboard_snapshots'),
  };
}

function parseSource(row) {
  const source = JSON.parse(row.source_json);
  delete row.source_json;
  delete row.metrics_json;
  return { ...source, ...row };
}

function sourceRows(db, sql, transform = parseSource) {
  return db.prepare(sql).all().map((row) => transform(row));
}

function dedupe(rows, key, prefer = (candidate, current) => (
  JSON.stringify(candidate).length > JSON.stringify(current).length
)) {
  const selected = new Map();
  for (const row of rows) {
    const grain = key(row);
    if (!selected.has(grain) || prefer(row, selected.get(grain))) selected.set(grain, row);
  }
  return [...selected.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

async function writeDataset(versionDir, dataset, rows) {
  const pending = [];
  for (let index = 0; index < rows.length; index += 2000) {
    pending.push(rows.slice(index, index + 2000));
  }
  if (pending.length === 0) pending.push([]);
  const chunks = [];
  while (pending.length > 0) {
    const candidate = pending.shift();
    const payload = { schemaVersion: 1, root: CANONICAL_ROOT, dataset, rows: candidate };
    const bytes = Buffer.from(compactJson(payload));
    const gzipBytes = gzipSync(bytes, { mtime: 0 }).length;
    if (gzipBytes >= 512000) {
      if (candidate.length < 2) {
        assertShardGzipSize(gzipBytes, `${dataset} row`);
      }
      const middle = Math.ceil(candidate.length / 2);
      pending.unshift(candidate.slice(0, middle), candidate.slice(middle));
      continue;
    }
    chunks.push({ rows: candidate, bytes, gzipBytes });
  }
  const dataDir = join(versionDir, 'data');
  await mkdir(dataDir, { recursive: true });
  const width = Math.max(3, String(chunks.length - 1).length);
  const assets = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const filename = `${dataset}-${String(index).padStart(width, '0')}.json`;
    await writeFile(join(dataDir, filename), chunk.bytes);
    assets.push({
      dataset,
      path: `data/${filename}`,
      count: chunk.rows.length,
      bytes: chunk.bytes.length,
      gzipBytes: chunk.gzipBytes,
      sha256: createHash('sha256').update(chunk.bytes).digest('hex'),
    });
  }
  return assets;
}

function stripMatch(row) {
  const value = parseSource(row);
  delete value.players;
  delete value.rounds;
  delete value.tags;
  return value;
}

function stripMatchPlayer(row) {
  const value = parseSource(row);
  delete value.bySide;
  delete value.clutches;
  delete value.perRound;
  delete value.weapons;
  return value;
}

function exportDefinitions(db) {
  const simple = (sql) => db.prepare(sql).all();
  return [
    ['players', () => sourceRows(db, `select steamid, display_name displayName, source_json, metrics_json from players order by steamid`)],
    ['playerAliases', () => simple(`select snapshot_id snapshotId, steamid, alias, source_fingerprint sourceFingerprint from player_aliases order by steamid, alias, source_fingerprint`)],
    ['matches', () => sourceRows(db, `select match_id matchId, source_json, metrics_json from matches order by started_at, match_id`, stripMatch)],
    ['matchTags', () => simple(`select match_id matchId, tag from match_tags order by match_id, tag`)],
    ['matchRounds', () => sourceRows(db, `select match_id matchId, source_json, metrics_json from match_rounds order by match_id, round`)],
    ['roundRosters', () => simple(`select match_id matchId, round, side, steamid from round_rosters order by match_id, round, side, steamid`)],
    ['matchPlayers', () => sourceRows(db, `select match_id matchId, steamid, name, source_json, metrics_json from match_players order by match_id, steamid`, stripMatchPlayer)],
    ['playerRounds', () => sourceRows(db, `select match_id matchId, steamid, source_json, metrics_json from player_rounds order by match_id, steamid, round`)],
    ['playerSideStats', () => sourceRows(db, `select match_id matchId, steamid, side, source_json, metrics_json from player_side_stats order by match_id, steamid, side`)],
    ['playerClutches', () => sourceRows(db, `select match_id matchId, steamid, clutch_index clutchIndex, source_json, metrics_json from player_clutches order by match_id, steamid, clutch_index`)],
    ['weapons', () => sourceRows(db, `select weapon, source_json, metrics_json from weapons order by weapon`)],
    ['matchPlayerWeapons', () => sourceRows(db, `select match_id matchId, steamid, weapon, source_json, metrics_json from match_player_weapons order by match_id, steamid, weapon`)],
    ['playerMatchStats', () => sourceRows(db, `select steamid, match_id matchId, source_json, metrics_json from player_match_stats order by steamid, match_id`)],
    ['playerMapStats', () => sourceRows(db, `select steamid, map, source_json, metrics_json from player_map_snapshots order by steamid, map`)],
    ['playerWeaponStats', () => dedupe(sourceRows(db, `select steamid, weapon, source_json, metrics_json from player_weapon_stats order by steamid, weapon, query_fingerprint`), (row) => `${row.steamid}|${row.weapon}`)],
    ['playerWeaponDailyStats', () => sourceRows(db, `select steamid, weapon, day, source_json, metrics_json from player_weapon_daily_stats order by steamid, weapon, day`)],
    ['weaponDailyStats', () => sourceRows(db, `select steamid, weapon, day, source_json, metrics_json from weapon_daily_stats order by steamid, weapon, day`)],
    ['weaponSplits', () => sourceRows(db, `select steamid, weapon, source_json, metrics_json from weapon_splits order by steamid, weapon`)],
    ['maps', () => sourceRows(db, `select map, source_json, metrics_json from meta_maps order by map`)],
    ['tags', () => sourceRows(db, `select tag, source_json, metrics_json from tags order by tag`)],
    ['draftConfig', () => sourceRows(db, `select version, source_json, metrics_json from draft_config order by version`)],
    ['draftPlayers', () => sourceRows(db, `select steamid, source_json, metrics_json from draft_players order by steamid`)],
    ['draftIgls', () => sourceRows(db, `select igl_key iglKey, steamid, source_json, metrics_json from draft_igls order by igl_key`)],
    ['leaderboardSnapshots', () => sourceRows(db, `select snapshot_id snapshotId, query_fingerprint queryFingerprint, steamid, source_json, metrics_json from leaderboard_snapshots order by snapshot_id, query_fingerprint, steamid`)],
    ['trendPlayers', () => simple(`select steamid, name, rounds_total roundsTotal from trend_players order by player_index`)],
    ['trendMatches', () => simple(`select steamid, started_at startedAt, map, match_name matchName, adr, assists, cs_good csGood, cs_graded csGraded, cs_stop_fast csStopFast, cs_stop_slow csStopSlow, damage, deaths, dpr, flash_assists flashAssists, hs_kills hsKills, impact, kast_pct kastPct, kast_rounds kastRounds, kills, kpr, opening_deaths openingDeaths, opening_kills openingKills, ping_n pingN, ping_sum pingSum, rating2, rounds_played roundsPlayed, rounds_won roundsWon, rws_sum rwsSum, stop_ms_n stopMsN, stop_ms_sum stopMsSum, ttd_adj_sum ttdAdjSum, ttd_n ttdN, ttd_sum ttdSum from trend_matches order by player_index, match_index`)],
    ['quality', () => [{
      integrity: db.pragma('integrity_check')[0].integrity_check,
      foreignKeyViolations: db.pragma('foreign_key_check').length,
      requests: scalar(db, 'select count(*) value from requests'),
      sourceDiscrepancies: scalar(db, 'select count(*) value from source_discrepancies'),
      tables: scalar(db, `select count(*) value from pragma_table_list where schema = 'main' and name not like 'sqlite_%'`),
    }]],
  ];
}

export async function generateWebData({ sourceGzip, outputDir, recommendationPath }) {
  const workDir = await mkdtemp(join(tmpdir(), 'whoajor-web-build-'));
  const sqlitePath = join(workDir, 'whoajor.sqlite');
  let stagingDir = null;
  try {
    await pipeline(
      createReadStream(sourceGzip),
      createGunzip(),
      createWriteStream(sqlitePath, { flags: 'wx' }),
    );
    const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const snapshot = db.prepare(`
        select contract_version contractVersion, root_hash root, status
        from snapshots`).get();
      if (snapshot.root !== CANONICAL_ROOT || snapshot.contractVersion !== '1.1.0') {
        throw new Error(`unsupported canonical snapshot: ${snapshot.root}/${snapshot.contractVersion}`);
      }
      const range = db.prepare(`
        select min(started_at) allTimeStart, max(started_at) allTimeEnd
        from matches`).get();
      const configDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');
      const calculated = await buildCalculatedDatasets(db, configDir, recommendationPath);
      const profile = JSON.parse(await readFile(join(dirname(sourceGzip), 'data-profile.json'), 'utf8'));
      const gzipSha256 = await sha256File(sourceGzip);
      const sqliteSha256 = await sha256File(sqlitePath);
      if (profile.database.decompressedSha256 !== sqliteSha256) {
        throw new Error('decompressed SQLite SHA does not match canonical profile');
      }

      await mkdir(dirname(outputDir), { recursive: true });
      stagingDir = await mkdtemp(join(dirname(outputDir), `.${basename(outputDir)}-staging-`));
      const versionDir = join(stagingDir, VERSION);
      await mkdir(versionDir, { recursive: true });
      const assets = [];
      for (const [dataset, loadRows] of exportDefinitions(db)) {
        assets.push(...await writeDataset(versionDir, dataset, loadRows()));
      }
      for (const [dataset, rows] of Object.entries(calculated)) {
        assets.push(...await writeDataset(versionDir, dataset, rows));
      }
      const manifest = {
        schemaVersion: 1,
        version: VERSION,
        contractVersion: snapshot.contractVersion,
        root: snapshot.root,
        source: {
          file: basename(sourceGzip),
          gzipSha256,
          sqliteSha256,
          dataFingerprint: profile.database.dataFingerprint,
        },
        window: {
          ...RECENT_WINDOW,
          allTimeStart: range.allTimeStart,
          allTimeEnd: range.allTimeEnd,
        },
        counts: sourceCounts(db),
        gameplayTables: GAMEPLAY_TABLES.map(([table, dataset]) => ({
          table,
          dataset,
          sourceRows: scalar(db, `select count(*) value from ${table}`),
        })),
        assets,
      };
      const manifestPath = join(versionDir, 'manifest.json');
      await writeFile(manifestPath, stableJson(manifest));
      const current = {
        schemaVersion: 1,
        version: VERSION,
        root: CANONICAL_ROOT,
        manifest: `${VERSION}/manifest.json`,
        manifestSha256: await sha256File(manifestPath),
      };
      await writeFile(join(stagingDir, 'current.json'), stableJson(current));
      const { verifyPublishedTree } = await import('./verify-web-data.mjs');
      await verifyPublishedTree({ outputDir: stagingDir, sourceGzip });
      await publishTree(stagingDir, outputDir);
      stagingDir = null;
      return { outputDir, manifest, current };
    } finally {
      db.close();
    }
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    if (dirname(sqlitePath) === workDir && workDir.startsWith(join(tmpdir(), 'whoajor-web-build-'))) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export function defaultCanonicalSource(repoRoot) {
  return join(
    repoRoot,
    '01_raw',
    'whoajor',
    '2026-08-30-full-v2-snapshot',
    'whoajor.sqlite.gz',
  );
}
