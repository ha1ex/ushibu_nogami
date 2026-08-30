import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalStringify, requestKey, sha256Hex } from './canonical-json.mjs';
import { CONTRACT } from './contract.mjs';
import { discoverPlayers, discoverWeapons, isSteamId64 } from './discovery.mjs';
import { computeRootHash } from './raw-store.mjs';

const EMPTY_ROOT_HASH = computeRootHash([]);
const STATIC_ENDPOINTS = [
  'meta', 'tags', 'draftConfig', 'leaderboard', 'weapons', 'weaponSplits',
];
const PLAYER_ENDPOINTS = [
  'playerSummary', 'playerMaps', 'playerWeapons', 'playerWeaponsByDay', 'playerMatches',
];
const WEAPON_ENDPOINTS = ['weaponDetail', 'weaponDetailByDay'];
const DATE_FIELDS = new Set([
  'min_date', 'max_date', 'publishedAt', 'started_at', 'startedAt', 'day',
]);
const DATE_VALUE_FIELDS = new Set(['min_date', 'max_date', 'day']);

function actualType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function queryEquals(left = {}, right = {}) {
  const leftEntries = Object.entries(left).map(([key, value]) => [key, String(value)]).sort();
  const rightEntries = Object.entries(right).map(([key, value]) => [key, String(value)]).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function decodeIdentifier(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function classifyRequest(entry) {
  const { path, query = {} } = entry;
  if (typeof path !== 'string' || !isObject(query)) return null;
  for (const name of STATIC_ENDPOINTS) {
    if (path === CONTRACT.endpoints[name].path && queryEquals(query, {})) return { name, context: {} };
  }
  if (path === CONTRACT.endpoints.matches.path) return { name: 'matches', context: {} };

  if (path.startsWith('/api/matches/')) {
    return { name: 'matchDetail', context: { matchId: decodeIdentifier(path.slice(13)) } };
  }

  const playerMatch = path.match(/^\/api\/players\/([^/]+)\/(summary|maps|weapons|matches)$/);
  if (playerMatch) {
    const steamid = decodeIdentifier(playerMatch[1]);
    const suffix = playerMatch[2];
    if (suffix === 'summary' && queryEquals(query, {})) return { name: 'playerSummary', context: { steamid } };
    if (suffix === 'maps' && queryEquals(query, {})) return { name: 'playerMaps', context: { steamid } };
    if (suffix === 'weapons' && queryEquals(query, {})) return { name: 'playerWeapons', context: { steamid } };
    if (suffix === 'weapons' && queryEquals(query, { by: 'day' })) {
      return { name: 'playerWeaponsByDay', context: { steamid } };
    }
    if (suffix === 'matches' && queryEquals(query, {})) return { name: 'playerMatches', context: { steamid } };
  }

  if (path.startsWith('/api/weapons/')) {
    const weapon = decodeIdentifier(path.slice(13));
    if (queryEquals(query, {})) return { name: 'weaponDetail', context: { weapon } };
    if (queryEquals(query, { by: 'day' })) return { name: 'weaponDetailByDay', context: { weapon } };
  }
  return null;
}

function sortEvents(events) {
  events.sort((left, right) => (
    left.code.localeCompare(right.code)
      || left.location.localeCompare(right.location)
      || left.message.localeCompare(right.message)
  ));
}

function makeReporter(report, requestScopes) {
  const seen = new Set();
  return (bucket, code, location, message) => {
    const event = { code, location, message };
    let identityLocation = location;
    if (code === 'UNKNOWN_FIELD') {
      const requestLocation = location.match(/^manifest\.requests\[(\d+)\](.*)$/);
      const requestScope = requestLocation
        ? requestScopes.get(Number(requestLocation[1]))
        : null;
      identityLocation = requestScope
        ? `${requestScope}${requestLocation[2].replace(/\[\d+\]/g, '[]')}`
        : location.replace(/\[\d+\]/g, '[]');
    }
    const identity = `${bucket}\0${code}\0${identityLocation}\0${message}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      report[bucket].push(event);
    }
  };
}

function validDate(value, field) {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year
      || calendar.getUTCMonth() !== month - 1
      || calendar.getUTCDate() !== day
  ) return false;
  if (hourText === undefined) return DATE_VALUE_FIELDS.has(field);
  if (field === 'day') return false;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== undefined && zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

function matchesType(value, expected) {
  return expected.split('|').some((type) => (
    actualType(value) === type && (type !== 'number' || Number.isFinite(value))
  ));
}

function validateObject(value, required, location, add, { unknownFields = true } = {}) {
  if (!isObject(value)) {
    add('errors', 'FIELD_TYPE_MISMATCH', location, `expected object, got ${actualType(value)}`);
    return false;
  }
  for (const [field, expected] of Object.entries(required)) {
    const fieldLocation = `${location}.${field}`;
    if (!Object.hasOwn(value, field)) {
      if (matchesType(undefined, expected)) continue;
      add('errors', 'REQUIRED_FIELD_MISSING', fieldLocation, 'required field is absent');
      continue;
    }
    if (!matchesType(value[field], expected)) {
      add(
        'errors',
        'FIELD_TYPE_MISMATCH',
        fieldLocation,
        `expected ${expected}, got ${actualType(value[field])}`,
      );
    } else if (DATE_FIELDS.has(field) && !validDate(value[field], field)) {
      add('errors', 'FIELD_TYPE_MISMATCH', fieldLocation, 'expected a valid date string');
    }
  }
  if (unknownFields) {
    for (const field of Object.keys(value)) {
      if (!Object.hasOwn(required, field)) {
        add('warnings', 'UNKNOWN_FIELD', `${location}.${field}`, 'field is outside CONTRACT v1 minimum');
      }
    }
  }
  return true;
}

function validateRows(rows, descriptor, location, context, add) {
  if (!Array.isArray(rows)) {
    add('errors', 'FIELD_TYPE_MISMATCH', location, `expected array, got ${actualType(rows)}`);
    return [];
  }
  const keys = new Set();
  rows.forEach((row, index) => {
    const rowLocation = `${location}[${index}]`;
    if (!validateObject(row, descriptor.required, rowLocation, add)) return;
    let key;
    try {
      key = descriptor.primaryKey(row, context);
    } catch {
      return;
    }
    if (keys.has(key)) {
      add('errors', 'DUPLICATE_PK', rowLocation, `duplicate primary key ${JSON.stringify(key)}`);
    }
    keys.add(key);
  });
  return rows;
}

function scanSteamids(value, location, add, validSteamids) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSteamids(item, `${location}[${index}]`, add, validSteamids));
    return;
  }
  if (!isObject(value)) return;
  for (const [field, nested] of Object.entries(value)) {
    const fieldLocation = `${location}.${field}`;
    if (field === 'steamid') {
      if (!isSteamId64(nested)) {
        add('errors', 'INVALID_STEAMID', fieldLocation, 'SteamID64 must be exactly 17 digits');
      } else {
        validSteamids.add(nested);
      }
    } else if (field === 'tSteamids' || field === 'ctSteamids') {
      if (Array.isArray(nested)) {
        nested.forEach((steamid, index) => {
          const itemLocation = `${fieldLocation}[${index}]`;
          if (!isSteamId64(steamid)) {
            add('errors', 'INVALID_STEAMID', itemLocation, 'SteamID64 must be exactly 17 digits');
          } else {
            validSteamids.add(steamid);
          }
        });
      }
    } else {
      scanSteamids(nested, fieldLocation, add, validSteamids);
    }
  }
}

function scanKnownDiscrepancies(value, location, add) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanKnownDiscrepancies(item, `${location}[${index}]`, add));
    return;
  }
  if (!isObject(value)) return;
  if (
    Number.isFinite(value.matches)
      && Number.isFinite(value.wins)
      && Number.isFinite(value.losses)
      && value.wins + value.losses < value.matches
  ) {
    add(
      'discrepancies',
      'WINS_LOSSES_LT_MATCHES',
      location,
      `wins + losses (${value.wins + value.losses}) is below matches (${value.matches})`,
    );
  }
  for (const [field, nested] of Object.entries(value)) {
    scanKnownDiscrepancies(nested, `${location}.${field}`, add);
  }
}

function classifyObservations(observations, add) {
  const classified = [];
  for (const observation of observations) {
    const classification = classifyRequest(observation.entry);
    if (!classification) {
      add(
        'warnings',
        'UNKNOWN_FIELD',
        observation.entry.key ?? observation.location,
        'request is outside CONTRACT v1 inventory',
      );
      continue;
    }
    classified.push({ ...observation, ...classification });
  }
  return classified;
}

function validateEndpointPayload(observation, add) {
  const { name, payload, context, location } = observation;
  if (payload === undefined) return;
  const descriptor = CONTRACT.endpoints[name];
  if (descriptor.responseKind === 'array') {
    validateRows(payload, descriptor, location, context, add);
  } else if (descriptor.responseKind === 'object') {
    validateObject(payload, descriptor.required, location, add);
  } else if (descriptor.responseKind === 'envelope') {
    if (validateObject(payload, descriptor.required, location, add)) {
      validateRows(
        payload[descriptor.itemsField],
        { required: descriptor.itemRequired, primaryKey: descriptor.primaryKey },
        `${location}.${descriptor.itemsField}`,
        context,
        add,
      );
    }
  }

  if (name === 'meta' && isObject(payload)) {
    validateRows(payload.maps, CONTRACT.entities.metaMap, `${location}.maps`, {}, add);
  } else if (name === 'draftConfig' && isObject(payload)) {
    validateRows(payload.players, CONTRACT.entities.draftPlayer, `${location}.players`, {}, add);
  } else if (name === 'matchDetail' && isObject(payload)) {
    const matchContext = { matchId: context.matchId };
    validateRows(
      payload.rounds, CONTRACT.entities.matchRound, `${location}.rounds`, matchContext, add,
    );
    const players = validateRows(
      payload.players, CONTRACT.entities.matchPlayer, `${location}.players`, matchContext, add,
    );
    for (let index = 0; index < players.length; index += 1) {
      const player = players[index];
      validateRows(
        player?.perRound,
        CONTRACT.entities.playerRound,
        `${location}.players[${index}].perRound`,
        { matchId: context.matchId, steamid: player?.steamid },
        add,
      );
    }
    if (Number.isFinite(payload.roundsPlayed) && Array.isArray(payload.rounds)
      && payload.roundsPlayed !== payload.rounds.length) {
      add(
        'errors',
        'TOTAL_MISMATCH',
        `${location}.roundsPlayed`,
        `roundsPlayed ${payload.roundsPlayed} differs from rounds length ${payload.rounds.length}`,
      );
    }
  }
}

function onePayload(classified, name, predicate = () => true) {
  return classified.find((row) => row.name === name && predicate(row) && row.payload !== undefined)?.payload;
}

function requireSingletons(classified, add) {
  for (const name of STATIC_ENDPOINTS) {
    const observations = classified.filter((row) => row.name === name && row.payload !== undefined);
    if (observations.length === 0) {
      add('errors', 'REQUEST_MISSING', CONTRACT.endpoints[name].path, `required ${name} request is missing`);
    }
  }
  if (!classified.some((row) => row.name === 'matches' && row.payload !== undefined)) {
    add('errors', 'REQUEST_MISSING', CONTRACT.endpoints.matches.path, 'required matches request is missing');
  }
}

function validateBoundaries(classified, add) {
  const groups = new Map();
  for (const row of classified) {
    const rows = groups.get(row.entry.key) ?? [];
    rows.push(row);
    groups.set(row.entry.key, rows);
  }
  const metaBoundaryKeys = new Set();
  const headBoundaryKeys = new Set();
  for (const [key, rows] of groups) {
    const expectedBoundary = rows[0].name === 'meta'
      || (rows[0].name === 'matches' && Number(rows[0].entry.query?.offset) === 0);
    if (!expectedBoundary) {
      if (rows.length > 1 || rows.some((row) => row.entry.boundaryRole !== null)) {
        add('errors', 'DUPLICATE_PK', key, 'ordinary request observation is duplicated');
      }
      continue;
    }
    if (rows[0].name === 'meta') metaBoundaryKeys.add(key);
    else headBoundaryKeys.add(key);
    const starts = rows.filter((row) => row.entry.boundaryRole === 'start');
    const ends = rows.filter((row) => row.entry.boundaryRole === 'end');
    if (rows.length !== 2 || starts.length !== 1 || ends.length !== 1) {
      add(
        'errors',
        'SNAPSHOT_BOUNDARY_CHANGED',
        key,
        'exactly one explicit start and one explicit end observation are required',
      );
      if (rows.length > 2 || starts.length > 1 || ends.length > 1
        || rows.some((row) => row.entry.boundaryRole === null)) {
        add('errors', 'DUPLICATE_PK', key, 'boundary observation identity is duplicated or ordinary');
      }
      continue;
    }
    if (starts[0].manifestIndex > ends[0].manifestIndex) {
      add('errors', 'SNAPSHOT_BOUNDARY_CHANGED', key, 'boundary end precedes boundary start');
    }
    if (starts[0].actualSha256 !== ends[0].actualSha256) {
      add('errors', 'SNAPSHOT_BOUNDARY_CHANGED', key, 'start and end boundary bodies differ');
    }
  }
  if (metaBoundaryKeys.size === 0) {
    add('errors', 'SNAPSHOT_BOUNDARY_CHANGED', '/api/meta', 'meta start/end observations are missing');
  } else if (metaBoundaryKeys.size > 1) {
    add('errors', 'DUPLICATE_PK', '/api/meta', 'multiple meta boundary request keys are present');
    add('errors', 'SNAPSHOT_BOUNDARY_CHANGED', '/api/meta', 'exactly one meta boundary request key is required');
  }
  if (headBoundaryKeys.size === 0) {
    add('errors', 'SNAPSHOT_BOUNDARY_CHANGED', '/api/matches?offset=0', 'matches head start/end observations are missing');
  } else if (headBoundaryKeys.size > 1) {
    add('errors', 'DUPLICATE_PK', '/api/matches?offset=0', 'multiple matches-head boundary request keys are present');
    add(
      'errors',
      'SNAPSHOT_BOUNDARY_CHANGED',
      '/api/matches?offset=0',
      'exactly one matches-head boundary request key is required',
    );
  }
}

function validatePagination(classified, meta, add) {
  const pagesByOffset = new Map();
  for (const row of classified.filter((item) => item.name === 'matches' && item.payload !== undefined)) {
    const limit = Number(row.entry.query?.limit);
    const offset = Number(row.entry.query?.offset);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
      add('errors', 'PAGE_GAP', row.location, 'pagination limit/offset must be non-negative integers');
      continue;
    }
    if (!pagesByOffset.has(offset)) pagesByOffset.set(offset, row);
  }
  const pages = [...pagesByOffset.entries()].sort(([left], [right]) => left - right);
  if (pages.length === 0) return { matchRows: [], matchIds: new Set(), total: null };

  const limits = new Set(pages.map(([, row]) => Number(row.entry.query.limit)));
  if (limits.size !== 1) add('errors', 'PAGE_GAP', '/api/matches', 'page limits are inconsistent');
  const limit = Number(pages[0][1].entry.query.limit);
  const stride = Math.max(1, limit - 1);
  const totals = new Set(pages.map(([, row]) => row.payload?.total).filter(Number.isFinite));
  if (totals.size !== 1) {
    add('errors', 'TOTAL_MISMATCH', '/api/matches', 'reported total changes between pages');
  }
  const total = totals.size > 0 ? [...totals][0] : null;

  const expectedOffsets = [];
  if (Number.isFinite(total)) {
    let expectedOffset = 0;
    do {
      expectedOffsets.push(expectedOffset);
      expectedOffset += stride;
    } while (expectedOffset + limit - 1 < total);
  } else {
    expectedOffsets.push(0);
  }
  const actualOffsets = new Set(pages.map(([offset]) => offset));
  for (const expectedOffset of expectedOffsets) {
    if (!actualOffsets.has(expectedOffset)) {
      add('errors', 'PAGE_GAP', '/api/matches', `missing ruling offset ${expectedOffset}`);
    }
  }
  for (let index = 1; index < pages.length; index += 1) {
    const [previousOffset, previous] = pages[index - 1];
    const [offset, current] = pages[index];
    if (offset !== previousOffset + stride) {
      add('errors', 'PAGE_GAP', current.location, `offset ${offset} does not follow ${previousOffset}`);
      continue;
    }
    if (limit > 1 && Array.isArray(previous.payload?.matches) && Array.isArray(current.payload?.matches)) {
      const previousIds = new Set(previous.payload.matches.map((row) => row?.id));
      const overlap = new Set(current.payload.matches.map((row) => row?.id)
        .filter((id) => previousIds.has(id)));
      if (overlap.size !== 1) {
        add('errors', 'PAGE_GAP', current.location, `expected overlap 1, got ${overlap.size}`);
      }
    }
  }

  const matchRowsById = new Map();
  for (const [, page] of pages) {
    for (const row of page.payload?.matches ?? []) {
      if (typeof row?.id === 'string' && !matchRowsById.has(row.id)) matchRowsById.set(row.id, row);
    }
  }
  if (Number.isFinite(total) && matchRowsById.size !== total) {
    add(
      'errors', 'TOTAL_MISMATCH', '/api/matches',
      `unique match count ${matchRowsById.size} differs from total ${total}`,
    );
  }
  if (Number.isFinite(meta?.matches) && Number.isFinite(total) && meta.matches !== total) {
    add('errors', 'TOTAL_MISMATCH', '/api/meta.matches', `meta.matches ${meta.matches} differs from total ${total}`);
  }
  return { matchRows: [...matchRowsById.values()], matchIds: new Set(matchRowsById.keys()), total };
}

function validateMatchDetails(classified, matchRows, matchIds, add) {
  const detailsById = new Map();
  for (const row of classified.filter((item) => item.name === 'matchDetail' && item.payload !== undefined)) {
    const id = row.payload?.matchId;
    if (id !== row.context.matchId) {
      add('errors', 'BROKEN_FK', row.location, `detail matchId ${id} differs from path ${row.context.matchId}`);
    }
    const observations = detailsById.get(row.context.matchId) ?? [];
    observations.push(row);
    detailsById.set(row.context.matchId, observations);
  }
  for (const matchId of matchIds) {
    const details = detailsById.get(matchId) ?? [];
    if (details.length === 0) {
      add('errors', 'MATCH_DETAIL_MISSING', `/api/matches/${matchId}`, 'index match has no detail response');
    } else if (details.length > 1) {
      add('errors', 'DUPLICATE_PK', `/api/matches/${matchId}`, 'match detail primary key is repeated');
    }
  }
  for (const [matchId, details] of detailsById) {
    if (!matchIds.has(matchId)) {
      add('errors', 'BROKEN_FK', details[0].location, 'match detail has no index parent');
    }
    for (const detailRow of details) {
      const detail = detailRow.payload;
      if (!isObject(detail)) continue;
      const playerIds = new Set((detail.players ?? []).map((player) => player?.steamid));
      const roundIds = new Set((detail.rounds ?? []).map((round) => round?.round));
      for (let roundIndex = 0; roundIndex < (detail.rounds ?? []).length; roundIndex += 1) {
        const round = detail.rounds[roundIndex];
        for (const field of ['tSteamids', 'ctSteamids']) {
          for (const steamid of round?.[field] ?? []) {
            if (!playerIds.has(steamid)) {
              add(
                'errors', 'BROKEN_FK', `${detailRow.location}.rounds[${roundIndex}].${field}`,
                `SteamID ${steamid} is absent from match players`,
              );
            }
          }
        }
      }
      for (let playerIndex = 0; playerIndex < (detail.players ?? []).length; playerIndex += 1) {
        const player = detail.players[playerIndex];
        for (let roundIndex = 0; roundIndex < (player?.perRound ?? []).length; roundIndex += 1) {
          const round = player.perRound[roundIndex];
          if (!roundIds.has(round?.round)) {
            add(
              'errors', 'BROKEN_FK',
              `${detailRow.location}.players[${playerIndex}].perRound[${roundIndex}].round`,
              `round ${round?.round} is absent from match rounds`,
            );
          }
        }
      }
    }
  }
  if (matchRows.length > 0 && detailsById.size > 0) {
    add(
      'warnings',
      'INDEX_DETAIL_NAMING_DIFFERENCE',
      '/api/matches',
      'index snake_case fields map to detail camelCase fields',
    );
  }
  return detailsById;
}

function validatePlayerRequests(classified, validSteamids, matchIds, add) {
  for (const row of classified) {
    if (row.context?.steamid !== undefined) {
      if (!isSteamId64(row.context.steamid)) {
        add('errors', 'INVALID_STEAMID', row.entry.path, 'SteamID64 path segment must be exactly 17 digits');
      } else {
        validSteamids.add(row.context.steamid);
      }
    }
  }
  for (const steamid of [...validSteamids].sort()) {
    for (const name of PLAYER_ENDPOINTS) {
      if (!classified.some((row) => (
        row.name === name && row.context.steamid === steamid && row.payload !== undefined
      ))) {
        const path = CONTRACT.endpoints[name].path.replace('{steamid}', steamid);
        add('errors', 'REQUEST_MISSING', path, `required ${name} detail is missing`);
      }
    }
  }
  for (const row of classified.filter((item) => item.name === 'playerSummary')) {
    for (const summary of row.payload ?? []) {
      if (summary?.steamid !== row.context.steamid) {
        add('errors', 'BROKEN_FK', row.location, 'player summary SteamID differs from path parent');
      }
    }
  }
  for (const row of classified.filter((item) => item.name === 'playerMatches')) {
    for (let index = 0; index < (row.payload ?? []).length; index += 1) {
      const matchId = row.payload[index]?.match_id;
      if (!matchIds.has(matchId)) {
        add('errors', 'BROKEN_FK', `${row.location}[${index}].match_id`, `unknown match ${matchId}`);
      }
    }
  }
}

function collectWeapons(classified) {
  const weapons = new Set(discoverWeapons({
    weapons: onePayload(classified, 'weapons'),
    playerWeapons: classified
      .filter((row) => row.name === 'playerWeapons')
      .map((row) => row.payload),
    matchDetails: classified
      .filter((row) => row.name === 'matchDetail')
      .map((row) => row.payload),
  }));
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isObject(value)) return;
    if (typeof value.weapon === 'string' && value.weapon.length > 0) weapons.add(value.weapon);
    Object.values(value).forEach(visit);
  };
  classified.forEach((row) => {
    if (row.context?.weapon) weapons.add(row.context.weapon);
    visit(row.payload);
  });
  return weapons;
}

function validateWeaponRequests(classified, weapons, add) {
  for (const weapon of [...weapons].sort()) {
    for (const name of WEAPON_ENDPOINTS) {
      if (!classified.some((row) => (
        row.name === name && row.context.weapon === weapon && row.payload !== undefined
      ))) {
        add(
          'errors',
          'REQUEST_MISSING',
          CONTRACT.endpoints[name].path.replace('{weapon}', weapon),
          `required ${name} detail is missing`,
        );
      }
    }
  }

  const index = onePayload(classified, 'weapons');
  for (let indexPosition = 0; indexPosition < (index ?? []).length; indexPosition += 1) {
    const aggregate = index[indexPosition];
    const detail = onePayload(
      classified, 'weaponDetail', (row) => row.context.weapon === aggregate?.weapon,
    );
    if (!Array.isArray(detail)) continue;
    const uniquePlayers = new Set(detail.map((row) => row?.steamid)).size;
    const kills = detail.reduce((sum, row) => sum + (Number.isFinite(row?.kills) ? row.kills : 0), 0);
    const shots = detail.reduce((sum, row) => sum + (Number.isFinite(row?.shots) ? row.shots : 0), 0);
    if (aggregate.kills !== kills || aggregate.shots !== shots || aggregate.players !== uniquePlayers) {
      add(
        'errors',
        'WEAPON_AGGREGATE_MISMATCH',
        `/api/weapons[${indexPosition}]`,
        `index ${aggregate.kills}/${aggregate.shots}/${aggregate.players} differs from detail ${kills}/${shots}/${uniquePlayers}`,
      );
    }
  }
  for (const row of classified.filter((item) => item.name === 'weaponDetailByDay')) {
    for (let index = 0; index < (row.payload ?? []).length; index += 1) {
      if (row.payload[index]?.weapon !== row.context.weapon) {
        add('errors', 'BROKEN_FK', `${row.location}[${index}].weapon`, 'weapon differs from path parent');
      }
    }
  }
}

function validateIgnoredFilters(classified, add) {
  for (const [baseName, filteredName] of [
    ['playerWeapons', 'playerWeaponsByDay'],
    ['weaponDetail', 'weaponDetailByDay'],
  ]) {
    for (const filtered of classified.filter((row) => row.name === filteredName)) {
      const identity = filtered.context.steamid ?? filtered.context.weapon;
      const base = classified.find((row) => (
        row.name === baseName
          && (row.context.steamid ?? row.context.weapon) === identity
          && row.payload !== undefined
      ));
      if (base && canonicalStringify(base.payload) === canonicalStringify(filtered.payload)) {
        add('warnings', 'FILTER_PARAMETER_IGNORED', filtered.entry.key, 'filtered and unfiltered bodies are identical');
      }
    }
  }
}

async function readObservations(dir, manifest, report, add) {
  const observations = [];
  for (let index = 0; index < manifest.requests.length; index += 1) {
    const entry = manifest.requests[index];
    const location = `manifest.requests[${index}]`;
    if (!isObject(entry)) {
      add('errors', 'REQUEST_MISSING', location, 'request entry is not an object');
      continue;
    }
    let body;
    try {
      body = await readFile(join(dir, String(entry.blob)));
    } catch {
      add('errors', 'BODY_HASH_MISMATCH', location, 'exact response blob is missing');
      observations.push({ entry, location, manifestIndex: index, actualSha256: null, payload: undefined });
      continue;
    }
    const actualSha256 = sha256Hex(body);
    const expectedBlob = join('responses', `${entry.bodySha256}.json`);
    if (
      entry.bodySha256 !== actualSha256
        || entry.bodyBytes !== body.byteLength
        || entry.blob !== expectedBlob
    ) {
      add('errors', 'BODY_HASH_MISMATCH', location, 'exact body hash, size, or blob path differs from manifest');
    }
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
      const canonicalSha256 = sha256Hex(canonicalStringify(payload));
      if (entry.canonicalSha256 !== canonicalSha256) {
        add('errors', 'BODY_HASH_MISMATCH', location, 'canonical JSON hash differs from manifest');
      }
    } catch {
      add('errors', 'FIELD_TYPE_MISMATCH', location, 'response body is not valid JSON');
    }
    if (entry.key !== requestKey(entry.path, entry.query ?? {})) {
      add('errors', 'BODY_HASH_MISMATCH', location, 'request key differs from path/query');
    }
    if (entry.status !== 200) {
      add('errors', 'REQUEST_MISSING', location, `successful response status is required, got ${entry.status}`);
    }
    observations.push({ entry, location, manifestIndex: index, actualSha256, payload });
  }
  report.rootHash = computeRootHash(observations.map((row) => ({
    key: row.entry?.key ?? row.location,
    bodySha256: row.actualSha256 ?? 'MISSING',
    boundaryRole: row.entry?.boundaryRole ?? null,
  })));
  if (manifest.rootHash !== report.rootHash) {
    add('errors', 'ROOT_HASH_MISMATCH', 'manifest.rootHash', 'root hash differs from exact response blobs');
  }
  return observations;
}

export async function validateSnapshot(dir) {
  const report = {
    status: 'incomplete',
    checkedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    discrepancies: [],
    counts: { requests: 0, matches: 0, matchDetails: 0, players: 0, weapons: 0, tags: 0 },
    rootHash: EMPTY_ROOT_HASH,
  };
  const requestScopes = new Map();
  const add = makeReporter(report, requestScopes);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    add('errors', 'REQUEST_MISSING', 'manifest.json', `manifest cannot be read: ${error.message}`);
    sortEvents(report.errors);
    return report;
  }
  if (!isObject(manifest) || !Array.isArray(manifest.requests)) {
    add('errors', 'REQUEST_MISSING', 'manifest.requests', 'manifest request inventory is missing');
    sortEvents(report.errors);
    return report;
  }
  manifest.requests.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.path !== 'string' || !isObject(entry.query)) return;
    try {
      requestScopes.set(index, requestKey(entry.path, entry.query));
    } catch {
      // The regular request-key validation below reports malformed request records.
    }
  });
  if (manifest.contractVersion !== CONTRACT.version) {
    add(
      'errors',
      'REQUEST_MISSING',
      'manifest.contractVersion',
      `CONTRACT ${CONTRACT.version} snapshot is required`,
    );
  }
  report.counts.requests = manifest.requests.length;
  const observations = await readObservations(dir, manifest, report, add);
  const classified = classifyObservations(observations, add);
  for (const row of classified) {
    validateEndpointPayload(row, add);
    scanKnownDiscrepancies(row.payload, row.location, add);
  }

  const validSteamids = new Set(discoverPlayers({
    leaderboard: onePayload(classified, 'leaderboard'),
    draftConfig: onePayload(classified, 'draftConfig'),
    matchDetails: classified
      .filter((row) => row.name === 'matchDetail')
      .map((row) => row.payload),
  }).filter(isSteamId64));
  for (const row of classified) scanSteamids(row.payload, row.location, add, validSteamids);
  requireSingletons(classified, add);
  validateBoundaries(classified, add);
  const meta = onePayload(classified, 'meta');
  if (isObject(meta) && Array.isArray(meta.maps)) {
    const mapSum = meta.maps.reduce((sum, row) => sum + (Number.isFinite(row?.n) ? row.n : 0), 0);
    if (Number.isFinite(meta.matches) && mapSum !== meta.matches) {
      add(
        'discrepancies', 'META_MAP_SUM_MISMATCH', '/api/meta.maps',
        `map sum ${mapSum} differs from meta.matches ${meta.matches}`,
      );
    }
  }
  const { matchRows, matchIds } = validatePagination(classified, meta, add);
  const detailsById = validateMatchDetails(classified, matchRows, matchIds, add);
  validatePlayerRequests(classified, validSteamids, matchIds, add);
  const weapons = collectWeapons(classified);
  validateWeaponRequests(classified, weapons, add);
  validateIgnoredFilters(classified, add);

  report.counts.matches = matchIds.size;
  report.counts.matchDetails = [...detailsById.values()].reduce((sum, rows) => sum + rows.length, 0);
  report.counts.players = validSteamids.size;
  report.counts.weapons = weapons.size;
  report.counts.tags = Array.isArray(onePayload(classified, 'tags'))
    ? onePayload(classified, 'tags').length
    : 0;
  for (const bucket of ['errors', 'warnings', 'discrepancies']) sortEvents(report[bucket]);
  report.status = report.errors.length === 0 ? 'complete' : 'incomplete';
  return report;
}
