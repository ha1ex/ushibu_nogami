import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalStringify, sha256Hex } from './canonical-json.mjs';
import { loadSnapshot } from './raw-store.mjs';

const SCHEMA_URL = new URL('../schema.sql', import.meta.url);
const EXPECTED_COUNT_KEYS = Object.freeze([
  'matchDetails', 'matches', 'players', 'requests', 'tags', 'trendMatches',
  'trendsPlayers', 'weapons',
]);
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
  if (
    path === '/api/trends'
      && Object.keys(query).length === 1
      && /^[1-9]\d*$/.test(String(query.top))
  ) return { name: 'trends', context: {} };
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

const PLAYER_SOURCE_PRIORITY = Object.freeze({
  playerSummary: 600,
  leaderboard: 550,
  matchDetail: 500,
  draftConfig: 450,
  weaponDetail: 400,
});
const WEAPON_SOURCE_PRIORITY = Object.freeze({
  weapons: 600,
  playerWeapons: 550,
  weaponDetailByDay: 500,
  playerWeaponsByDay: 450,
  matchDetail: 400,
  weaponSplits: 350,
});

function sourceFullness(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sourceFullness(item), 0);
  if (!value || typeof value !== 'object') return 1;
  return Object.entries(value).reduce(
    (sum, [, nested]) => sum + 1 + sourceFullness(nested),
    0,
  );
}

function childSourcePath(parent, key) {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

function sourceReference(observation, sourcePath) {
  return {
    endpoint: observation.name,
    observationRole: observationRole(observation.entry),
    requestKey: observation.entry.key,
    sourcePath,
  };
}

function directLineage(observation, sourcePath, source) {
  return {
    ...sourceReference(observation, sourcePath),
    sourceSha256: sha256Hex(json(source)),
  };
}

function preferReference(left, right) {
  if (!left) return right;
  return compareText(json(left), json(right)) <= 0 ? left : right;
}

function addSourceCandidate(states, id, source, priority, observation, sourcePath) {
  const state = states.get(id) ?? { variants: new Map(), fallbacks: [] };
  const canonical = json(source);
  const reference = sourceReference(observation, sourcePath);
  const existing = state.variants.get(canonical);
  if (!existing) {
    state.variants.set(canonical, {
      canonical,
      fullness: sourceFullness(source),
      priority,
      reference,
      source,
    });
  } else {
    state.variants.set(canonical, {
      ...existing,
      priority: Math.max(existing.priority, priority),
      reference: preferReference(existing.reference, reference),
    });
  }
  states.set(id, state);
}

function addFallback(states, id, source, observation, sourcePath) {
  const state = states.get(id) ?? { variants: new Map(), fallbacks: [] };
  state.fallbacks.push({
    canonical: json(source),
    reference: sourceReference(observation, sourcePath),
    source,
  });
  states.set(id, state);
}

function selectSources(states, idField) {
  return new Map([...states.entries()].map(([id, state]) => {
    const candidates = [...state.variants.values()].sort((left, right) => (
      right.priority - left.priority
        || right.fullness - left.fullness
        || compareText(left.canonical, right.canonical)
    ));
    const fallbacks = state.fallbacks.sort((left, right) => (
      compareText(left.canonical, right.canonical)
        || compareText(json(left.reference), json(right.reference))
    ));
    const selected = candidates[0] ?? fallbacks[0] ?? {
      canonical: json({ [idField]: id }),
      reference: null,
      source: { [idField]: id },
    };
    const source = selected.source;
    const variantCandidates = candidates.length > 0 ? candidates : [selected];
    return [id, {
      id,
      name: source.name ?? candidates.find(({ source: row }) => typeof row.name === 'string')?.source.name ?? null,
      source,
      lineage: {
        selectedSourceSha256: sha256Hex(selected.canonical),
        sourceVariants: variantCandidates.map(({ canonical, reference }) => ({
          sha256: sha256Hex(canonical),
          reference,
        })),
      },
    }];
  }));
}

function collectNamedEntities(observations) {
  const playerStates = new Map();
  const weaponStates = new Map();
  const visit = (value, observation, sourcePath = '$') => {
    if (Array.isArray(value)) {
      value.forEach((nested, index) => visit(
        nested,
        observation,
        childSourcePath(sourcePath, index),
      ));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.steamid === 'string') {
      addSourceCandidate(
        playerStates,
        value.steamid,
        value,
        PLAYER_SOURCE_PRIORITY[observation.name] ?? 300,
        observation,
        sourcePath,
      );
    }
    for (const field of ['tSteamids', 'ctSteamids']) {
      if (Array.isArray(value[field])) {
        value[field].forEach((steamid, index) => {
          if (typeof steamid === 'string') {
            addFallback(
              playerStates,
              steamid,
              { steamid },
              observation,
              childSourcePath(childSourcePath(sourcePath, field), index),
            );
          }
        });
      }
    }
    if (typeof value.weapon === 'string') {
      addSourceCandidate(
        weaponStates,
        value.weapon,
        value,
        WEAPON_SOURCE_PRIORITY[observation.name] ?? 300,
        observation,
        sourcePath,
      );
    }
    Object.entries(value).forEach(([key, nested]) => visit(
      nested,
      observation,
      childSourcePath(sourcePath, key),
    ));
  };
  for (const observation of observations) {
    if (observation.context.steamid) {
      addFallback(
        playerStates,
        observation.context.steamid,
        { steamid: observation.context.steamid },
        observation,
        '$request.path',
      );
    }
    if (observation.context.weapon) {
      addFallback(
        weaponStates,
        observation.context.weapon,
        { weapon: observation.context.weapon },
        observation,
        '$request.path',
      );
    }
    visit(observation.payload, observation);
  }
  return {
    players: selectSources(playerStates, 'steamid'),
    weapons: selectSources(weaponStates, 'weapon'),
  };
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
      canonical_sha256, source_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of observations) {
    insertRequest(
      snapshotId,
      row.entry.key,
      observationRole(row.entry),
      row.entry.path,
      json(row.entry.query ?? {}),
      row.entry.bodySha256,
      row.entry.canonicalSha256,
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
  for (const [steamid, row] of [...players.entries()].sort(([a], [b]) => compareText(a, b))) {
    insertPlayer(
      steamid,
      row.name,
      json(row.source),
      json(row.lineage),
    );
  }
  const insertWeapon = statement(db, `
    INSERT INTO weapons(weapon, source_json, metrics_json) VALUES (?, ?, ?)`);
  for (const [weapon, row] of [...weapons.entries()].sort(([a], [b]) => compareText(a, b))) {
    insertWeapon(
      weapon,
      json(row.source),
      json(row.lineage),
    );
  }

  const insertTrendPlayer = statement(db, `
    INSERT INTO trend_players(
      snapshot_id, query_fingerprint, player_index, steamid, name, rounds_total,
      source_json, lineage_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertTrendMatch = statement(db, `
    INSERT INTO trend_matches(
      snapshot_id, query_fingerprint, player_index, match_index, steamid,
      started_at, map, match_name, adr, assists, cs_good, cs_graded,
      cs_stop_fast, cs_stop_slow, damage, deaths, dpr, flash_assists,
      hs_kills, impact, kast_pct, kast_rounds, kills, kpr, opening_deaths,
      opening_kills, ping_n, ping_sum, rating2, rounds_played, rounds_won,
      rws_sum, stop_ms_n, stop_ms_sum, ttd_adj_sum, ttd_n, ttd_sum,
      source_json, lineage_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`);
  for (const observation of observationsOf(observations, 'trends')) {
    const fingerprint = queryFingerprint(observation.entry);
    for (const [playerIndex, player] of observation.payload.entries()) {
      insertTrendPlayer(
        snapshotId,
        fingerprint,
        playerIndex,
        player.steamid,
        player.name,
        player.roundsTotal,
        json(player),
        json(directLineage(observation, `$[${playerIndex}]`, player)),
      );
      for (const [matchIndex, match] of player.matches.entries()) {
        insertTrendMatch(
          snapshotId,
          fingerprint,
          playerIndex,
          matchIndex,
          match.steamid,
          match.started_at,
          match.map,
          match.match_name,
          match.adr,
          match.assists,
          match.cs_good,
          match.cs_graded,
          match.cs_stop_fast,
          match.cs_stop_slow,
          match.damage,
          match.deaths,
          match.dpr,
          match.flash_assists,
          match.hs_kills,
          match.impact,
          match.kast_pct,
          match.kast_rounds,
          match.kills,
          match.kpr,
          match.opening_deaths,
          match.opening_kills,
          match.ping_n,
          match.ping_sum,
          match.rating2,
          match.rounds_played,
          match.rounds_won,
          match.rws_sum,
          match.stop_ms_n,
          match.stop_ms_sum,
          match.ttd_adj_sum,
          match.ttd_n,
          match.ttd_sum,
          json(match),
          json(directLineage(
            observation,
            `$[${playerIndex}].matches[${matchIndex}]`,
            match,
          )),
        );
      }
    }
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
      match_id, map, server_name, started_at, rounds_played, has_detail, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
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
      detail ? 1 : 0,
      json(source),
      detail && index ? json({ index }) : '{}',
    );
  }

  const insertMatchTag = statement(db, `
    INSERT INTO match_tags(match_id, tag, source_json) VALUES (?, ?, ?)`);
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
      match_id, steamid, clutch_index, round, start_tick, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertMatchWeapon = statement(db, `
    INSERT INTO match_player_weapons(
      match_id, steamid, weapon, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?)`);
  const detailEntries = new Map(observationsOf(observations, 'matchDetail').map((observation) => (
    [observation.context.matchId, observation.entry]
  )));
  for (const [matchId, detail] of [...detailMatches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const detailEntry = detailEntries.get(matchId);
    for (const rawTag of detail.tags ?? []) {
      const tag = typeof rawTag === 'string' ? rawTag : String(rawTag.tag ?? rawTag.name);
      insertMatchTag(matchId, tag, json(rawTag));
    }
    for (const [roundIndex, round] of (detail.rounds ?? []).entries()) {
      const roundJson = json(round);
      insertRound(
        matchId, round.round, round.winner, round.reason, bool(round.bombPlanted), roundJson, '{}',
      );
      for (const [side, field] of [['T', 'tSteamids'], ['CT', 'ctSteamids']]) {
        for (const [rosterIndex, steamid] of (round[field] ?? []).entries()) {
          insertRoster(matchId, round.round, side, steamid, json({
            provenance: {
              observationRole: observationRole(detailEntry),
              requestKey: detailEntry.key,
              roundSourceSha256: sha256Hex(roundJson),
              sourcePath: `$.rounds[${roundIndex}].${field}[${rosterIndex}]`,
            },
            steamid,
          }));
        }
      }
    }
    for (const player of detail.players ?? []) {
      insertMatchPlayer(matchId, player.steamid, player.name, json(player), '{}');
      for (const round of player.perRound ?? []) {
        insertPlayerRound(
          matchId, player.steamid, round.round, round.side, round.kills, round.deaths,
          bool(round.won), json(round), '{}',
        );
      }
      for (const [side, metrics] of Object.entries(player.bySide ?? {})) {
        insertSide(matchId, player.steamid, side, json(metrics), '{}');
      }
      for (const [clutchIndex, clutch] of (player.clutches ?? []).entries()) {
        insertClutch(
          matchId, player.steamid, clutchIndex, clutch.round,
          clutch.startTick ?? clutch.start_tick ?? null,
          json(clutch), '{}',
        );
      }
      for (const weapon of player.weapons ?? []) {
        insertMatchWeapon(matchId, player.steamid, weapon.weapon, json(weapon), '{}');
      }
    }
  }

  const insertAlias = statement(db, `
    INSERT INTO player_aliases(
      snapshot_id, steamid, alias, source_fingerprint, source_json
    ) VALUES (?, ?, ?, ?, ?)`);
  const addAliases = (observation, rows, basePath) => rows.forEach((row, index) => {
    if (typeof row?.steamid === 'string' && typeof row?.name === 'string') {
      const fullSourceJson = json(row);
      const sourceJson = json({
        name: row.name,
        provenance: {
          endpoint: observation.name,
          observationRole: observationRole(observation.entry),
          requestKey: observation.entry.key,
          sourcePath: `${basePath}[${index}]`,
          sourceSha256: sha256Hex(fullSourceJson),
        },
        steamid: row.steamid,
      });
      insertAlias(
        snapshotId, row.steamid, row.name,
        sha256Hex(`${observation.entry.key}\0${fullSourceJson}`), sourceJson,
      );
    }
  });
  for (const observation of observations) {
    if (observation.name === 'matchDetail') {
      addAliases(observation, observation.payload.players ?? [], '$.players');
    }
    else if (['leaderboard', 'playerSummary', 'weaponDetail'].includes(observation.name)) {
      addAliases(observation, observation.payload, '$');
    } else if (observation.name === 'draftConfig') {
      addAliases(observation, observation.payload.players ?? [], '$.players');
    }
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
      insertLeaderboard(snapshotId, fingerprint, row.steamid, json(row), '{}');
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
        insertMap(snapshotId, fingerprint, observation.context.steamid, row.map, json(row), '{}');
      }
    } else if (observation.name === 'playerMatches') {
      for (const row of observation.payload) {
        insertPlayerMatch(
          snapshotId, fingerprint, observation.context.steamid, row.match_id, json(row), '{}',
        );
      }
    } else if (observation.name === 'playerWeapons') {
      for (const row of observation.payload) {
        insertPlayerWeapon(
          snapshotId, fingerprint, observation.context.steamid, row.weapon, json(row), '{}',
        );
      }
    } else if (observation.name === 'playerWeaponsByDay') {
      for (const row of observation.payload) {
        insertPlayerWeaponDay(
          snapshotId, fingerprint, observation.context.steamid, row.weapon, row.day,
          json(row), '{}',
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
          snapshotId, fingerprint, row.steamid, observation.context.weapon, json(row), '{}',
        );
      }
    } else if (observation.name === 'weaponDetailByDay') {
      for (const row of observation.payload) {
        insertWeaponDay(
          snapshotId, fingerprint, observation.context.weapon, row.steamid, row.day,
          json(row), '{}',
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
    insertSplit(snapshotId, row.steamid, row.weapon, json(row), '{}');
  }

  const draft = firstObservation(observations, 'draftConfig')?.payload;
  if (draft) {
    statement(db, `INSERT INTO draft_config(
      snapshot_id, version, teams, metric, published_at, source_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)(
      snapshotId, draft.v, draft.teams, draft.metric, draft.publishedAt, json(draft), '{}',
    );
    const insertDraftPlayer = statement(db, `
      INSERT INTO draft_players(
        snapshot_id, version, steamid, source_json, metrics_json
      ) VALUES (?, ?, ?, ?, ?)`);
    for (const row of draft.players ?? []) {
      insertDraftPlayer(snapshotId, draft.v, row.steamid, json(row), '{}');
    }
    const insertIgl = statement(db, `
      INSERT INTO draft_igls(
        snapshot_id, version, igl_key, steamid, source_json, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?)`);
    (draft.igls ?? []).forEach((row, index) => {
      const candidate = typeof row === 'string' ? row : row?.steamid ?? null;
      const steamid = players.has(candidate) ? candidate : null;
      const key = candidate ?? String(row?.id ?? row?.name ?? index);
      insertIgl(snapshotId, draft.v, key, steamid, json(row), '{}');
    });
  }

  const meta = firstObservation(observations, 'meta')?.payload;
  const insertMetaMap = statement(db, `
    INSERT INTO meta_maps(snapshot_id, map, source_json, metrics_json) VALUES (?, ?, ?, ?)`);
  for (const row of meta?.maps ?? []) insertMetaMap(snapshotId, row.map, json(row), '{}');
  const tagPayload = firstObservation(observations, 'tags')?.payload ?? [];
  const insertTag = statement(db, `
    INSERT INTO tags(snapshot_id, tag, source_json, metrics_json) VALUES (?, ?, ?, ?)`);
  for (const row of tagPayload) insertTag(snapshotId, row.tag, json(row), '{}');
}

function validateReportCounts(counts) {
  const keys = counts && typeof counts === 'object' && !Array.isArray(counts)
    ? Object.keys(counts).sort(compareText)
    : [];
  const exactKeys = keys.length === EXPECTED_COUNT_KEYS.length
    && keys.every((key, index) => key === EXPECTED_COUNT_KEYS[index]);
  const validValues = exactKeys && keys.every((key) => (
    Number.isFinite(counts[key]) && Number.isInteger(counts[key]) && counts[key] >= 0
  ));
  if (!validValues) {
    throw new Error(
      `validation report counts must contain exactly ${EXPECTED_COUNT_KEYS.join(', ')} as nonnegative integers`,
    );
  }
}

function verifyCounts(db, report) {
  const actual = {
    requests: db.prepare('SELECT count(*) AS n FROM requests').get().n,
    matches: db.prepare('SELECT count(*) AS n FROM matches').get().n,
    matchDetails: db.prepare('SELECT count(*) AS n FROM matches WHERE has_detail = 1').get().n,
    players: db.prepare('SELECT count(*) AS n FROM players').get().n,
    weapons: db.prepare('SELECT count(*) AS n FROM weapons').get().n,
    tags: db.prepare('SELECT count(*) AS n FROM tags').get().n,
    trendsPlayers: db.prepare('SELECT count(*) AS n FROM trend_players').get().n,
    trendMatches: db.prepare('SELECT count(*) AS n FROM trend_matches').get().n,
  };
  for (const name of EXPECTED_COUNT_KEYS) {
    const expected = report.counts[name];
    if (actual[name] !== expected) {
      throw new Error(`SQLite count mismatch for ${name}: expected ${expected}, got ${actual[name]}`);
    }
  }
  return actual;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const SEMANTIC_REQUEST_SOURCE_FIELDS = Object.freeze([
  'key', 'path', 'query', 'boundaryRole', 'status', 'bodyBytes', 'bodySha256',
  'canonicalSha256', 'itemCount', 'reportedTotal',
]);
const SEMANTIC_SNAPSHOT_SOURCE_FIELDS = Object.freeze([
  'snapshotId', 'contractVersion', 'status', 'rootHash', 'failure',
]);

function pickFields(value, fields) {
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(value, field))
    .map((field) => [field, value[field]]));
}

function semanticRequestSource(value) {
  return pickFields(value, SEMANTIC_REQUEST_SOURCE_FIELDS);
}

function sanitizedSourceJson(table, sourceJson) {
  const value = JSON.parse(sourceJson);
  if (table === 'requests') return semanticRequestSource(value);
  if (table === 'snapshots') {
    const semantic = pickFields(value, SEMANTIC_SNAPSHOT_SOURCE_FIELDS);
    semantic.requests = (value.requests ?? [])
      .map(semanticRequestSource)
      .sort((left, right) => compareText(json(left), json(right)));
    return semantic;
  }
  return value;
}

export function computeDataFingerprint(db) {
  const hash = createHash('sha256');
  const tables = db.pragma('table_list')
    .filter((row) => row.schema === 'main' && !row.name.startsWith('sqlite_'))
    .map(({ name }) => name)
    .sort(compareText);
  for (const table of tables) {
    const columnInfo = db.pragma(`table_info(${quoteIdentifier(table)})`)
      .sort((left, right) => left.cid - right.cid);
    const columns = columnInfo.map(({ name }) => name);
    const primaryKey = columnInfo
      .filter(({ pk }) => pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(({ name }) => name);
    const orderColumns = primaryKey.length > 0 ? primaryKey : columns;
    const projection = columns.map(quoteIdentifier).join(', ');
    const orderBy = orderColumns.map(quoteIdentifier).join(', ');
    hash.update(`${json({ columns, table })}\n`);
    for (const dbRow of db.prepare(
      `SELECT ${projection} FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}`,
    ).iterate()) {
      const logicalRow = {};
      for (const column of columns) {
        logicalRow[column] = column === 'source_json'
          ? sanitizedSourceJson(table, dbRow[column])
          : dbRow[column];
      }
      hash.update(`${json({ row: logicalRow, table })}\n`);
    }
  }
  return hash.digest('hex');
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
  validateReportCounts(report.counts);

  const observations = [];
  for (const entry of manifest.requests) {
    const sourceBody = await readFile(join(snapshotDir, entry.blob), 'utf8');
    const payload = JSON.parse(sourceBody);
    observations.push({ entry, sourceBody, payload, ...classify(entry) });
  }

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
    const counts = verifyCounts(db, report);
    const dataFingerprint = computeDataFingerprint(db);
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
