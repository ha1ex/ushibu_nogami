import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalStringify, sha256Hex } from './canonical-json.mjs';
import { loadSnapshot } from './raw-store.mjs';

const SCHEMA_URL = new URL('../schema.sql', import.meta.url);
let temporarySequence = 0;

function queryEquals(left = {}, right = {}) {
  const normalize = (value) => Object.entries(value)
    .map(([key, item]) => [key, String(item)])
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return canonicalStringify(normalize(left)) === canonicalStringify(normalize(right));
}

function decodeIdentifier(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function classify(entry) {
  const { path, query = {} } = entry;
  const staticEndpoints = new Map([
    ['/api/meta', 'meta'],
    ['/api/tags', 'tags'],
    ['/api/draft-config', 'draftConfig'],
    ['/api/leaderboard', 'leaderboard'],
    ['/api/weapons', 'weapons'],
    ['/api/weapon-splits', 'weaponSplits'],
  ]);
  if (staticEndpoints.has(path) && queryEquals(query, {})) {
    return { name: staticEndpoints.get(path), context: {} };
  }
  if (path === '/api/matches') return { name: 'matches', context: {} };
  if (path.startsWith('/api/matches/')) {
    return { name: 'matchDetail', context: { matchId: decodeIdentifier(path.slice(13)) } };
  }
  const player = path.match(/^\/api\/players\/([^/]+)\/(summary|maps|weapons|matches)$/);
  if (player) {
    const context = { steamid: decodeIdentifier(player[1]) };
    if (player[2] === 'summary' && queryEquals(query, {})) return { name: 'playerSummary', context };
    if (player[2] === 'maps' && queryEquals(query, {})) return { name: 'playerMaps', context };
    if (player[2] === 'weapons' && queryEquals(query, {})) return { name: 'playerWeapons', context };
    if (player[2] === 'weapons' && queryEquals(query, { by: 'day' })) {
      return { name: 'playerWeaponsByDay', context };
    }
    if (player[2] === 'matches' && queryEquals(query, {})) return { name: 'playerMatches', context };
  }
  if (path.startsWith('/api/weapons/')) {
    const context = { weapon: decodeIdentifier(path.slice(13)) };
    if (queryEquals(query, {})) return { name: 'weaponDetail', context };
    if (queryEquals(query, { by: 'day' })) return { name: 'weaponDetailByDay', context };
  }
  throw new Error(`cannot normalize unknown request ${entry.key}`);
}

function asRows(payload, field) {
  if (field) return payload[field];
  return Array.isArray(payload) ? payload : [payload];
}

function json(value) {
  return canonicalStringify(value);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function bool(value) {
  return value ? 1 : 0;
}

function observationRole(entry) {
  return entry.boundaryRole ?? 'ordinary';
}

function queryFingerprint(entry) {
  return sha256Hex(json({ path: entry.path, query: entry.query ?? {} }));
}

function firstObservation(observations, name, predicate = () => true) {
  return observations.find((row) => (
    row.name === name && row.entry.boundaryRole !== 'end' && predicate(row)
  ));
}

function observationsOf(observations, name) {
  return observations.filter((row) => row.name === name && row.entry.boundaryRole !== 'end');
}

function collectNamedEntities(observations) {
  const players = new Map();
  const weapons = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.steamid === 'string') {
      const existing = players.get(value.steamid);
      players.set(value.steamid, {
        steamid: value.steamid,
        name: value.name ?? existing?.name ?? null,
        source: existing?.source ?? value,
      });
    }
    for (const field of ['tSteamids', 'ctSteamids']) {
      if (Array.isArray(value[field])) {
        for (const steamid of value[field]) {
          if (typeof steamid === 'string' && !players.has(steamid)) {
            players.set(steamid, { steamid, name: null, source: { steamid } });
          }
        }
      }
    }
    if (typeof value.weapon === 'string') {
      if (!weapons.has(value.weapon)) weapons.set(value.weapon, value);
    }
    Object.values(value).forEach(visit);
  };
  for (const observation of observations) {
    if (observation.context.steamid && !players.has(observation.context.steamid)) {
      players.set(observation.context.steamid, {
        steamid: observation.context.steamid,
        name: null,
        source: { steamid: observation.context.steamid },
      });
    }
    if (observation.context.weapon && !weapons.has(observation.context.weapon)) {
      weapons.set(observation.context.weapon, { weapon: observation.context.weapon });
    }
    visit(observation.payload);
  }
  return { players, weapons };
}

function statement(db, sql) {
  const prepared = db.prepare(sql);
  return (...values) => prepared.run(...values);
}

function populate(db, snapshotId, manifest, report, observations) {
  const insertSnapshot = statement(db, `
    INSERT INTO snapshots(snapshot_id, contract_version, root_hash, status, source_json)
    VALUES (?, ?, ?, 'complete', ?)`);
  insertSnapshot(snapshotId, manifest.contractVersion, manifest.rootHash, json(manifest));

  const insertRequest = statement(db, `
    INSERT INTO requests(
      snapshot_id, request_key, observation_role, path, query_json, body_sha256,
      canonical_sha256, source_body, source_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of observations) {
    insertRequest(
      snapshotId,
      row.entry.key,
      observationRole(row.entry),
      row.entry.path,
      json(row.entry.query ?? {}),
      row.entry.bodySha256,
      row.entry.canonicalSha256,
      row.sourceBody,
      json(row.entry),
    );
  }

  const insertDiscrepancy = statement(db, `
    INSERT INTO source_discrepancies(
      snapshot_id, discrepancy_index, code, location, message, source_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  report.discrepancies.forEach((row, index) => {
    insertDiscrepancy(snapshotId, index, row.code, row.location, row.message, json(row));
  });

  const { players, weapons } = collectNamedEntities(observations);
  const insertPlayer = statement(db, `
    INSERT INTO players(steamid, display_name, source_json, metrics_json) VALUES (?, ?, ?, ?)`);
  for (const row of [...players.values()].sort((a, b) => a.steamid.localeCompare(b.steamid))) {
    insertPlayer(row.steamid, row.name, json(row.source), json(row.source));
  }
  const insertWeapon = statement(db, `
    INSERT INTO weapons(weapon, source_json, metrics_json) VALUES (?, ?, ?)`);
  for (const [weapon, source] of [...weapons.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    insertWeapon(weapon, json(source), json(source));
  }

  const indexMatches = new Map();
  for (const observation of observationsOf(observations, 'matches')) {
    for (const row of asRows(observation.payload, 'matches')) indexMatches.set(row.id, row);
  }
  const detailMatches = new Map(observationsOf(observations, 'matchDetail').map((observation) => (
    [observation.context.matchId, observation.payload]
  )));
  const insertMatch = statement(db, `
    INSERT INTO matches(
      match_id, map, server_name, started_at, rounds_played, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const matchId of [...new Set([...indexMatches.keys(), ...detailMatches.keys()])].sort()) {
    const index = indexMatches.get(matchId);
    const detail = detailMatches.get(matchId);
    const source = detail ?? index;
    insertMatch(
      matchId,
      detail?.map ?? index.map,
      detail?.serverName ?? index.server_name,
      detail?.startedAt ?? index.started_at,
      detail?.roundsPlayed ?? index.rounds_played,
      json(source),
      json({ index: index ?? null, detail: detail ?? null }),
    );
  }

  const insertMatchTag = statement(db, `
    INSERT OR IGNORE INTO match_tags(match_id, tag, source_json) VALUES (?, ?, ?)`);
  const insertRound = statement(db, `
    INSERT INTO match_rounds(
      match_id, round, winner, reason, bomb_planted, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertRoster = statement(db, `
    INSERT INTO round_rosters(match_id, round, side, steamid, source_json)
    VALUES (?, ?, ?, ?, ?)`);
  const insertMatchPlayer = statement(db, `
    INSERT INTO match_players(match_id, steamid, name, source_json, metrics_json)
    VALUES (?, ?, ?, ?, ?)`);
  const insertPlayerRound = statement(db, `
    INSERT INTO player_rounds(
      match_id, steamid, round, side, kills, deaths, won, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertSide = statement(db, `
    INSERT INTO player_side_stats(match_id, steamid, side, source_json, metrics_json)
    VALUES (?, ?, ?, ?, ?)`);
  const insertClutch = statement(db, `
    INSERT INTO player_clutches(
      match_id, steamid, round, start_tick, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertMatchWeapon = statement(db, `
    INSERT INTO match_player_weapons(
      match_id, steamid, weapon, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?)`);
  for (const [matchId, detail] of [...detailMatches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const rawTag of detail.tags ?? []) {
      const tag = typeof rawTag === 'string' ? rawTag : String(rawTag.tag ?? rawTag.name);
      insertMatchTag(matchId, tag, json(rawTag));
    }
    for (const round of detail.rounds ?? []) {
      insertRound(
        matchId, round.round, round.winner, round.reason, bool(round.bombPlanted), json(round), json(round),
      );
      for (const [side, field] of [['T', 'tSteamids'], ['CT', 'ctSteamids']]) {
        for (const steamid of round[field] ?? []) insertRoster(matchId, round.round, side, steamid, json(round));
      }
    }
    for (const player of detail.players ?? []) {
      insertMatchPlayer(matchId, player.steamid, player.name, json(player), json(player));
      for (const round of player.perRound ?? []) {
        insertPlayerRound(
          matchId, player.steamid, round.round, round.side, round.kills, round.deaths,
          bool(round.won), json(round), json(round),
        );
      }
      for (const [side, metrics] of Object.entries(player.bySide ?? {})) {
        insertSide(matchId, player.steamid, side, json(metrics), json(metrics));
      }
      for (const clutch of player.clutches ?? []) {
        insertClutch(
          matchId, player.steamid, clutch.round, clutch.startTick ?? clutch.start_tick,
          json(clutch), json(clutch),
        );
      }
      for (const weapon of player.weapons ?? []) {
        insertMatchWeapon(matchId, player.steamid, weapon.weapon, json(weapon), json(weapon));
      }
    }
  }

  const insertAlias = statement(db, `
    INSERT OR IGNORE INTO player_aliases(
      snapshot_id, steamid, alias, source_fingerprint, source_json
    ) VALUES (?, ?, ?, ?, ?)`);
  const addAliases = (observation, rows) => rows.forEach((row) => {
    if (typeof row?.steamid === 'string' && typeof row?.name === 'string') {
      const sourceJson = json(row);
      insertAlias(
        snapshotId, row.steamid, row.name,
        sha256Hex(`${observation.entry.key}\0${sourceJson}`), sourceJson,
      );
    }
  });
  for (const observation of observations) {
    if (observation.name === 'matchDetail') addAliases(observation, observation.payload.players ?? []);
    else if (['leaderboard', 'playerSummary', 'weaponDetail'].includes(observation.name)) {
      addAliases(observation, observation.payload);
    } else if (observation.name === 'draftConfig') addAliases(observation, observation.payload.players ?? []);
  }

  const insertLeaderboard = statement(db, `
    INSERT INTO leaderboard_snapshots(
      snapshot_id, query_fingerprint, steamid, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?)`);
  for (const observation of observations.filter((row) => (
    ['leaderboard', 'playerSummary'].includes(row.name)
  ))) {
    const fingerprint = queryFingerprint(observation.entry);
    for (const row of observation.payload) {
      insertLeaderboard(snapshotId, fingerprint, row.steamid, json(row), json(row));
    }
  }

  const insertMap = statement(db, `
    INSERT INTO player_map_snapshots(
      snapshot_id, query_fingerprint, steamid, map, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertPlayerMatch = statement(db, `
    INSERT INTO player_match_stats(
      snapshot_id, query_fingerprint, steamid, match_id, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertPlayerWeapon = statement(db, `
    INSERT INTO player_weapon_stats(
      snapshot_id, query_fingerprint, steamid, weapon, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertPlayerWeaponDay = statement(db, `
    INSERT INTO player_weapon_daily_stats(
      snapshot_id, query_fingerprint, steamid, weapon, day, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const observation of observations) {
    const fingerprint = queryFingerprint(observation.entry);
    if (observation.name === 'playerMaps') {
      for (const row of observation.payload) {
        insertMap(snapshotId, fingerprint, observation.context.steamid, row.map, json(row), json(row));
      }
    } else if (observation.name === 'playerMatches') {
      for (const row of observation.payload) {
        insertPlayerMatch(
          snapshotId, fingerprint, observation.context.steamid, row.match_id, json(row), json(row),
        );
      }
    } else if (observation.name === 'playerWeapons') {
      for (const row of observation.payload) {
        insertPlayerWeapon(
          snapshotId, fingerprint, observation.context.steamid, row.weapon, json(row), json(row),
        );
      }
    } else if (observation.name === 'playerWeaponsByDay') {
      for (const row of observation.payload) {
        insertPlayerWeaponDay(
          snapshotId, fingerprint, observation.context.steamid, row.weapon, row.day,
          json(row), json(row),
        );
      }
    }
  }

  const insertWeaponDay = statement(db, `
    INSERT INTO weapon_daily_stats(
      snapshot_id, query_fingerprint, weapon, steamid, day, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const observation of observations) {
    const fingerprint = queryFingerprint(observation.entry);
    if (observation.name === 'weaponDetail') {
      for (const row of observation.payload) {
        insertPlayerWeapon(
          snapshotId, fingerprint, row.steamid, observation.context.weapon, json(row), json(row),
        );
      }
    } else if (observation.name === 'weaponDetailByDay') {
      for (const row of observation.payload) {
        insertWeaponDay(
          snapshotId, fingerprint, observation.context.weapon, row.steamid, row.day,
          json(row), json(row),
        );
      }
    }
  }

  const insertSplit = statement(db, `
    INSERT INTO weapon_splits(
      snapshot_id, steamid, weapon, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?)`);
  const splits = firstObservation(observations, 'weaponSplits');
  for (const row of splits?.payload ?? []) {
    insertSplit(snapshotId, row.steamid, row.weapon, json(row), json(row));
  }

  const draft = firstObservation(observations, 'draftConfig')?.payload;
  if (draft) {
    statement(db, `INSERT INTO draft_config(
      snapshot_id, version, teams, metric, published_at, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)(
      snapshotId, draft.v, draft.teams, draft.metric, draft.publishedAt, json(draft), json(draft),
    );
    const insertDraftPlayer = statement(db, `
      INSERT INTO draft_players(
        snapshot_id, version, steamid, source_json, metrics_json
      ) VALUES (?, ?, ?, ?, ?)`);
    for (const row of draft.players ?? []) {
      insertDraftPlayer(snapshotId, draft.v, row.steamid, json(row), json(row));
    }
    const insertIgl = statement(db, `
      INSERT INTO draft_igls(
        snapshot_id, version, igl_key, steamid, source_json, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?)`);
    (draft.igls ?? []).forEach((row, index) => {
      const candidate = typeof row === 'string' ? row : row?.steamid ?? null;
      const steamid = players.has(candidate) ? candidate : null;
      const key = candidate ?? String(row?.id ?? row?.name ?? index);
      insertIgl(snapshotId, draft.v, key, steamid, json(row), json(row));
    });
  }

  const meta = firstObservation(observations, 'meta')?.payload;
  const insertMetaMap = statement(db, `
    INSERT INTO meta_maps(snapshot_id, map, source_json, metrics_json) VALUES (?, ?, ?, ?)`);
  for (const row of meta?.maps ?? []) insertMetaMap(snapshotId, row.map, json(row), json(row));
  const tagPayload = firstObservation(observations, 'tags')?.payload ?? [];
  const insertTag = statement(db, `
    INSERT INTO tags(snapshot_id, tag, source_json, metrics_json) VALUES (?, ?, ?, ?)`);
  for (const row of tagPayload) insertTag(snapshotId, row.tag, json(row), json(row));
}

function verifyCounts(db, report, observations) {
  const actual = {
    requests: db.prepare('SELECT count(*) AS n FROM requests').get().n,
    matches: db.prepare('SELECT count(*) AS n FROM matches').get().n,
    matchDetails: new Set(observationsOf(observations, 'matchDetail').map((row) => row.context.matchId)).size,
    players: db.prepare('SELECT count(*) AS n FROM players').get().n,
    weapons: db.prepare('SELECT count(*) AS n FROM weapons').get().n,
    tags: db.prepare('SELECT count(*) AS n FROM tags').get().n,
  };
  for (const [name, expected] of Object.entries(report.counts)) {
    if (actual[name] !== expected) {
      throw new Error(`SQLite count mismatch for ${name}: expected ${expected}, got ${actual[name]}`);
    }
  }
  return actual;
}

async function cleanupTemporary(path) {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-journal`, { force: true }),
  ]);
}

export async function buildDatabase(snapshotDir, dbPath) {
  if (!snapshotDir || !dbPath) throw new TypeError('snapshotDir and dbPath are required');
  const report = JSON.parse(await readFile(join(snapshotDir, 'validation-report.json'), 'utf8'));
  if (report.status !== 'complete' || !Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error('normalization requires a complete validation report without errors');
  }
  const { manifest } = await loadSnapshot(snapshotDir);
  if (report.rootHash !== manifest.rootHash) {
    throw new Error('validation report is stale: root hash differs from current snapshot');
  }
  if (!report.counts || typeof report.counts !== 'object') {
    throw new Error('validation report is stale: counts are unavailable');
  }

  const observations = [];
  for (const entry of manifest.requests) {
    const sourceBody = await readFile(join(snapshotDir, entry.blob), 'utf8');
    const payload = JSON.parse(sourceBody);
    observations.push({ entry, sourceBody, payload, ...classify(entry) });
  }
  const logicalRows = observations.map((row) => ({
    requestKey: row.entry.key,
    observationRole: observationRole(row.entry),
    payload: row.payload,
  })).sort((left, right) => compareText(json(left), json(right)));
  const dataFingerprint = sha256Hex(logicalRows.map((row) => `${json(row)}\n`).join(''));

  await mkdir(dirname(dbPath), { recursive: true });
  const temporaryPath = `${dbPath}.tmp-${process.pid}-${temporarySequence += 1}`;
  await cleanupTemporary(temporaryPath);
  let db;
  try {
    db = new Database(temporaryPath);
    db.pragma('foreign_keys = ON');
    db.exec(await readFile(SCHEMA_URL, 'utf8'));
    const snapshotId = manifest.snapshotId ?? basename(snapshotDir);
    db.transaction(() => populate(db, snapshotId, manifest, report, observations))();
    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length > 0) {
      throw new Error(`SQLite foreign_key_check failed: ${json(foreignKeyErrors)}`);
    }
    const integrity = db.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${json(integrity)}`);
    }
    const counts = verifyCounts(db, report, observations);
    db.close();
    db = undefined;
    await rename(temporaryPath, dbPath);
    return { counts, dataFingerprint };
  } catch (error) {
    if (db?.open) db.close();
    await cleanupTemporary(temporaryPath);
    throw error;
  }
}
