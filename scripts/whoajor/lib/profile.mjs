import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import {
  mkdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalStringify } from './canonical-json.mjs';
import { computeDataFingerprint } from './normalize.mjs';

const PROFILE_VERSION = 1;
const REQUIRED_TABLES = Object.freeze([
  'draft_config', 'draft_igls', 'draft_players', 'leaderboard_snapshots',
  'match_player_weapons', 'match_players', 'match_rounds', 'match_tags', 'matches',
  'meta_maps', 'player_aliases', 'player_clutches', 'player_map_snapshots',
  'player_match_stats', 'player_rounds', 'player_side_stats', 'player_weapon_daily_stats',
  'player_weapon_stats', 'players', 'requests', 'round_rosters', 'snapshots',
  'source_discrepancies', 'tags', 'weapon_daily_stats', 'weapon_splits', 'weapons',
]);
const COUNT_METRIC_KEYS = Object.freeze([
  'assists', 'bomb_planted', 'cost', 'damage', 'deaths', 'discrepancy_index',
  'duration_seconds', 'headshots', 'hits', 'hs_kills', 'kills', 'matches',
  'matches_total', 'n', 'players', 'round', 'rounds', 'rounds_played',
  'rounds_with', 'rounds_won', 'shots', 'start_tick', 'team_a_rounds',
  'team_b_rounds', 'teams', 'tickrate', 'version',
]);
const COUNT_METRIC_SET = new Set(COUNT_METRIC_KEYS);
const COUNT_SUFFIXES = Object.freeze([
  '_assists', '_count', '_damage', '_deaths', '_hits', '_kills', '_matches',
  '_players', '_rounds', '_seconds', '_shots', '_total',
]);
const DISCRETE_COUNT_KEYS = new Set([
  'assists', 'bomb_planted', 'deaths', 'discrepancy_index', 'headshots', 'hits',
  'hs_kills', 'kills', 'matches', 'matches_total', 'n', 'players', 'round',
  'rounds', 'rounds_played', 'rounds_with', 'rounds_won', 'shots', 'start_tick',
  'team_a_rounds', 'team_b_rounds', 'teams', 'tickrate', 'version',
]);
const DISCRETE_COUNT_SUFFIXES = Object.freeze([
  '_assists', '_count', '_deaths', '_hits', '_kills', '_players', '_rounds', '_shots',
]);
const DATE_KEYS = new Set(['date', 'day']);
const FLEXIBLE_DATE_KEYS = new Set(['max_date', 'min_date']);
const TIMESTAMP_KEYS = new Set(['published_at', 'publishedat', 'started_at', 'startedat']);
const STEAM_ID_KEYS = new Set([
  'ct_steamids', 'ctsteamids', 'steamid', 'steamids', 't_steamids', 'tsteamids',
]);
const DIMENSION_ID_KEYS = new Set(['map', 'tag', 'weapon']);
const POSITIVE_METRIC_KEYS = new Set(['round', 'teams', 'tickrate']);
const BOOLEAN_METRIC_KEYS = new Set(['bomb_planted']);
let temporaryFileSequence = 0;

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string') throw new TypeError('SQLite identifier must be a string');
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizedKey(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toLowerCase();
}

function pathTokens(path) {
  return String(path ?? '')
    .replaceAll('"', '')
    .replaceAll("'", '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((token) => token.replace(/^\$+/, '').trim())
    .filter(Boolean)
    .map(normalizedKey);
}

function semanticPathKey(path) {
  return pathTokens(path).filter((token) => !/^\d+$/.test(token)).at(-1) ?? '';
}

function isCountMetricKey(value) {
  const key = normalizedKey(value);
  return COUNT_METRIC_SET.has(key) || COUNT_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function isDiscreteCountMetricKey(value) {
  const key = normalizedKey(value);
  if (DISCRETE_COUNT_KEYS.has(key)) return true;
  if (key.endsWith('_matches') && !key.includes('equiv')) return true;
  return DISCRETE_COUNT_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function isPercentageKey(value) {
  const key = normalizedKey(value);
  return key === 'pct'
    || key === 'percent'
    || key === 'percentage'
    || key.endsWith('_pct')
    || key.endsWith('_percent')
    || key.endsWith('_percentage');
}

function isNumericType(type) {
  return type === 'integer' || type === 'real';
}

function validSteamId(value) {
  return typeof value === 'string' && /^\d{17}$/.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const matched = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!matched || !validDate(matched[1])) return false;
  const hour = Number(matched[2]);
  const minute = Number(matched[3]);
  const second = Number(matched[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const zone = matched[5];
  if (zone && zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return false;
    }
  }
  return true;
}

function dateKind(key) {
  const normalized = normalizedKey(key);
  if (DATE_KEYS.has(normalized)) return 'date';
  if (FLEXIBLE_DATE_KEYS.has(normalized)) return 'flexible-date';
  if (TIMESTAMP_KEYS.has(normalized) || normalized.endsWith('_at')) return 'timestamp';
  return null;
}

function dateValue(value, kind) {
  if (kind === 'date') return value;
  return typeof value === 'string' ? value.slice(0, 10) : null;
}

function snapshotDate(snapshotId) {
  const candidate = typeof snapshotId === 'string' ? snapshotId.slice(0, 10) : '';
  return validDate(candidate) ? candidate : null;
}

function invalidIdentifier(name, value) {
  if (value === null || value === undefined) return false;
  const key = normalizedKey(name);
  if (key === 'steamid') return !validSteamId(value);
  if (key === 'id' || key.endsWith('_id') || DIMENSION_ID_KEYS.has(key)) {
    return typeof value !== 'string' || value.trim() === '';
  }
  return false;
}

function isIdentifierKey(name) {
  const key = normalizedKey(name);
  return key === 'id' || key === 'steamid' || key.endsWith('_id') || DIMENSION_ID_KEYS.has(key);
}

function invalidJsonIdentifier(path, type, value) {
  const tokens = pathTokens(path);
  if (type === 'null' || type === 'array' || type === 'object') return false;
  if (tokens.some((token) => STEAM_ID_KEYS.has(token))) {
    return type !== 'text' || !validSteamId(value);
  }
  const key = semanticPathKey(path);
  if (key === 'id' || key === 'matchid' || key.endsWith('_id') || DIMENSION_ID_KEYS.has(key)) {
    return type !== 'text' || String(value).trim() === '';
  }
  return false;
}

function invalidDateValue(key, value) {
  const kind = dateKind(key);
  if (!kind || value === null || value === undefined) return false;
  if (kind === 'date') return !validDate(value);
  if (kind === 'flexible-date') return !validDate(value) && !validTimestamp(value);
  return !validTimestamp(value);
}

function futureDateValue(key, value, asOf) {
  const kind = dateKind(key);
  if (!asOf || !kind || invalidDateValue(key, value)) return false;
  return dateValue(value, kind) > asOf;
}

function impossibleMetric(key, value) {
  if (value === null || value === undefined) return false;
  const number = Number(value);
  if (!Number.isFinite(number)) return true;
  if (isPercentageKey(key) && (number < 0 || number > 100)) return true;
  return POSITIVE_METRIC_KEYS.has(normalizedKey(key)) && number <= 0;
}

function invalidMetricTypeOrValue(key, type, value) {
  const normalized = normalizedKey(key);
  const semanticMetric = isCountMetricKey(normalized)
    || isPercentageKey(normalized)
    || POSITIVE_METRIC_KEYS.has(normalized);
  if (!semanticMetric || type === 'null' || type === 'array' || type === 'object') return false;
  if (BOOLEAN_METRIC_KEYS.has(normalized) && (type === 'true' || type === 'false')) return false;
  if (!isNumericType(type)) return true;
  return impossibleMetric(normalized, value);
}

function invalidJsonDate(path, type, value) {
  const tokens = pathTokens(path);
  if (tokens.at(-2) === 'observed_headers' && tokens.at(-1) === 'date') return false;
  const key = semanticPathKey(path);
  if (!dateKind(key) || type === 'null') return false;
  return type !== 'text' || invalidDateValue(key, value);
}

function futureJsonDate(path, type, value, asOf) {
  const tokens = pathTokens(path);
  if (tokens.at(-2) === 'observed_headers' && tokens.at(-1) === 'date') return false;
  return type === 'text' && futureDateValue(semanticPathKey(path), value, asOf);
}

function registerAuditFunctions(db, asOf) {
  const deterministic = { deterministic: true };
  db.function('whoajor_invalid_typed_id', deterministic, (key, value) => (
    invalidIdentifier(key, value) ? 1 : 0
  ));
  db.function('whoajor_invalid_typed_date', deterministic, (key, value) => (
    invalidDateValue(key, value) ? 1 : 0
  ));
  db.function('whoajor_future_typed_date', deterministic, (key, value) => (
    futureDateValue(key, value, asOf) ? 1 : 0
  ));
  db.function('whoajor_negative_count', deterministic, (key, type, value) => (
    isNumericType(type) && isCountMetricKey(key) && Number(value) < 0 ? 1 : 0
  ));
  db.function('whoajor_fractional_count', deterministic, (key, type, value) => (
    isNumericType(type)
      && isDiscreteCountMetricKey(key)
      && !Number.isInteger(Number(value)) ? 1 : 0
  ));
  db.function('whoajor_impossible_metric', deterministic, (key, type, value) => (
    invalidMetricTypeOrValue(key, type, value) ? 1 : 0
  ));
  db.function('whoajor_invalid_json_id', deterministic, (path, type, value) => (
    invalidJsonIdentifier(path, type, value) ? 1 : 0
  ));
  db.function('whoajor_invalid_json_date', deterministic, (path, type, value) => (
    invalidJsonDate(path, type, value) ? 1 : 0
  ));
  db.function('whoajor_future_json_date', deterministic, (path, type, value) => (
    futureJsonDate(path, type, value, asOf) ? 1 : 0
  ));
}

function normalizeRows(rows, { sort = false } = {}) {
  const normalized = rows.map((row) => Object.fromEntries(Object.entries(row)));
  if (sort) {
    normalized.sort((left, right) => compareText(canonicalStringify(left), canonicalStringify(right)));
  }
  return normalized;
}

function createQueryRecorder(db) {
  const queries = [];
  const ids = new Set();
  const all = (id, sql, parameters = [], options = {}) => {
    if (ids.has(id)) throw new Error(`duplicate profile query id: ${id}`);
    ids.add(id);
    const normalizedSql = sql.trim();
    const result = normalizeRows(db.prepare(normalizedSql).all(...parameters), options);
    queries.push({ id, parameters: [...parameters], result, sql: normalizedSql });
    return result;
  };
  const one = (id, sql, parameters = []) => all(id, sql, parameters)[0] ?? null;
  return { all, one, queries };
}

function tableQueryId(table, suffix) {
  return `table.${table}.${suffix}`;
}

function primaryKeyDuplicateSql(table, primaryKeyColumns) {
  const grouping = primaryKeyColumns.map(quoteIdentifier).join(', ');
  return `
    SELECT COALESCE(SUM(group_size - 1), 0) AS duplicate_rows
    FROM (
      SELECT COUNT(*) AS group_size
      FROM ${quoteIdentifier(table)}
      GROUP BY ${grouping}
      HAVING COUNT(*) > 1
    )
  `;
}

function predicateCountSql(table, predicate, alias) {
  return `
    SELECT COUNT(*) AS ${quoteIdentifier(alias)}
    FROM ${quoteIdentifier(table)}
    WHERE ${predicate}
  `;
}

function profileTable(recorder, table) {
  const columns = recorder.all(tableQueryId(table, 'columns'), `
    SELECT cid, name, type, "notnull" AS not_null, dflt_value, pk
    FROM pragma_table_info(?)
    ORDER BY cid
  `, [table]);
  const foreignKeys = recorder.all(tableQueryId(table, 'foreign-keys'), `
    SELECT id, seq, "table" AS parent_table, "from" AS child_column,
           "to" AS parent_column, on_update, on_delete, match
    FROM pragma_foreign_key_list(?)
    ORDER BY id, seq
  `, [table]);
  const primaryKeyColumns = columns
    .filter(({ pk }) => pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(({ name }) => name);
  const rowCount = recorder.one(
    tableQueryId(table, 'row-count'),
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`,
  ).row_count;
  const duplicatePrimaryKeyRows = primaryKeyColumns.length === 0 ? 0 : recorder.one(
    tableQueryId(table, 'duplicate-primary-key'),
    primaryKeyDuplicateSql(table, primaryKeyColumns),
  ).duplicate_rows;
  const nullPrimaryKeyRows = primaryKeyColumns.length === 0 ? 0 : recorder.one(
    tableQueryId(table, 'null-primary-key'),
    predicateCountSql(
      table,
      primaryKeyColumns.map((column) => `${quoteIdentifier(column)} IS NULL`).join(' OR '),
      'null_rows',
    ),
  ).null_rows;
  const emptyPrimaryKeyRows = primaryKeyColumns.length === 0 ? 0 : recorder.one(
    tableQueryId(table, 'empty-primary-key'),
    predicateCountSql(
      table,
      primaryKeyColumns.map((column) => (
        `(typeof(${quoteIdentifier(column)}) = 'text' AND trim(${quoteIdentifier(column)}) = '')`
      )).join(' OR '),
      'empty_rows',
    ),
  ).empty_rows;

  const roles = new Map();
  for (const column of primaryKeyColumns) roles.set(column, new Set(['primary-key']));
  for (const { child_column: column } of foreignKeys) {
    const columnRoles = roles.get(column) ?? new Set();
    columnRoles.add('foreign-key');
    roles.set(column, columnRoles);
  }
  const roleOrder = new Map([['primary-key', 0], ['foreign-key', 1]]);
  const keyColumns = [...roles]
    .sort(([left], [right]) => compareText(left, right))
    .map(([column, columnRoles]) => {
      const result = recorder.one(tableQueryId(table, `key.${column}`), `
        SELECT
          COALESCE(SUM(CASE WHEN ${quoteIdentifier(column)} IS NULL THEN 1 ELSE 0 END), 0)
            AS null_count,
          COALESCE(SUM(CASE
            WHEN typeof(${quoteIdentifier(column)}) = 'text'
              AND trim(${quoteIdentifier(column)}) = '' THEN 1 ELSE 0 END), 0)
            AS empty_string_count
        FROM ${quoteIdentifier(table)}
      `);
      return {
        column,
        emptyStringCount: result.empty_string_count,
        nullCount: result.null_count,
        roles: [...columnRoles].sort((left, right) => roleOrder.get(left) - roleOrder.get(right)),
      };
    });

  return {
    columns,
    duplicatePrimaryKeyRows,
    emptyPrimaryKeyRows,
    foreignKeys,
    grain: primaryKeyColumns.length === 0
      ? 'no declared primary-key grain'
      : `one row per ${primaryKeyColumns.join(' + ')}`,
    keyColumns,
    name: table,
    nullPrimaryKeyRows,
    primaryKeyColumns,
    rowCount,
  };
}

function typedColumnNeedsAudit(column) {
  const key = normalizedKey(column.name);
  return isIdentifierKey(key)
    || Boolean(dateKind(key))
    || isCountMetricKey(key)
    || isPercentageKey(key)
    || POSITIVE_METRIC_KEYS.has(key);
}

function profileTypedColumn(recorder, table, column) {
  const identifier = quoteIdentifier(column.name);
  const result = recorder.one(tableQueryId(table, `typed.${column.name}`), `
    SELECT
      COALESCE(SUM(whoajor_invalid_typed_id(?, ${identifier})), 0) AS "invalidIds",
      COALESCE(SUM(whoajor_invalid_typed_date(?, ${identifier})), 0) AS "invalidDates",
      COALESCE(SUM(whoajor_future_typed_date(?, ${identifier})), 0) AS "futureDates",
      COALESCE(SUM(whoajor_negative_count(?, typeof(${identifier}), ${identifier})), 0)
        AS "negativeCountMetrics",
      COALESCE(SUM(whoajor_fractional_count(?, typeof(${identifier}), ${identifier})), 0)
        AS "fractionalCountMetrics",
      COALESCE(SUM(whoajor_impossible_metric(?, typeof(${identifier}), ${identifier})), 0)
        AS "impossibleMetrics"
    FROM ${quoteIdentifier(table)}
  `, Array(6).fill(column.name));
  return result;
}

function profileJsonColumn(recorder, table, column) {
  const identifier = quoteIdentifier(column.name);
  return recorder.one(tableQueryId(table, `json.${column.name}`), `
    WITH documents AS MATERIALIZED (
      SELECT ${identifier} AS document, json_valid(${identifier}) AS valid
      FROM ${quoteIdentifier(table)}
    ), nodes AS (
      SELECT tree.fullkey, tree.key, tree.type, tree.atom
      FROM documents
      JOIN json_tree(CASE WHEN documents.valid THEN documents.document ELSE '{}' END) AS tree
    )
    SELECT
      (SELECT COUNT(*) FROM documents WHERE valid = 0) AS "malformedJson",
      COALESCE(SUM(whoajor_invalid_json_id(fullkey, type, atom)), 0) AS "invalidIds",
      COALESCE(SUM(whoajor_invalid_json_date(fullkey, type, atom)), 0) AS "invalidDates",
      COALESCE(SUM(whoajor_future_json_date(fullkey, type, atom)), 0) AS "futureDates",
      COALESCE(SUM(whoajor_negative_count(key, type, atom)), 0) AS "negativeCountMetrics",
      COALESCE(SUM(whoajor_fractional_count(key, type, atom)), 0)
        AS "fractionalCountMetrics",
      COALESCE(SUM(whoajor_impossible_metric(key, type, atom)), 0) AS "impossibleMetrics"
    FROM nodes
  `);
}

function addAnomalies(target, result) {
  for (const key of Object.keys(target)) target[key] += Number(result[key] ?? 0);
}

function existingSourceSql(tableMap, sources) {
  return sources
    .filter(([table, column]) => tableMap.get(table)?.columns.some(({ name }) => name === column))
    .map(([table, column]) => `
      SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(table)}
      WHERE ${quoteIdentifier(column)} IS NOT NULL
        AND (typeof(${quoteIdentifier(column)}) != 'text' OR trim(${quoteIdentifier(column)}) != '')
    `);
}

function cardinality(recorder, tableMap, name, sources) {
  const selections = existingSourceSql(tableMap, sources);
  if (selections.length === 0) return 0;
  return recorder.one(`cardinality.${name}`, `
    SELECT COUNT(*) AS cardinality
    FROM (${selections.join('\nUNION\n')})
  `).cardinality;
}

function profileCrossCounts(recorder, tableNames) {
  if (!tableNames.has('matches') || !tableNames.has('match_rounds')) {
    return {
      detailIdentityMismatch: 0,
      detailRequestCount: 0,
      matchesWithDetail: 0,
      matchesTotal: 0,
      metaTotals: [],
      roundsActual: 0,
      roundsDeclared: 0,
      roundsPerMatchMismatch: 0,
    };
  }
  const aggregate = recorder.one('cross.match-aggregate', `
    SELECT
      COUNT(*) AS matches_total,
      COALESCE(SUM(CASE WHEN has_detail = 1 THEN 1 ELSE 0 END), 0) AS matches_with_detail,
      COALESCE(SUM(CASE WHEN has_detail = 1 THEN rounds_played ELSE 0 END), 0)
        AS rounds_declared
    FROM matches
  `);
  const roundsActual = recorder.one(
    'cross.round-count',
    'SELECT COUNT(*) AS rounds_actual FROM match_rounds',
  ).rounds_actual;
  const roundsPerMatchMismatch = recorder.one('cross.rounds-per-match', `
    WITH actual AS (
      SELECT match_id, COUNT(*) AS rounds_actual
      FROM match_rounds
      GROUP BY match_id
    )
    SELECT COUNT(*) AS mismatch_count
    FROM matches
    LEFT JOIN actual USING (match_id)
    WHERE matches.has_detail = 1
      AND matches.rounds_played != COALESCE(actual.rounds_actual, 0)
  `).mismatch_count;

  let detailRequestCount = 0;
  let detailIdentityMismatch = 0;
  let metaTotals = [];
  if (tableNames.has('requests')) {
    detailRequestCount = recorder.one('cross.detail-request-count', `
      SELECT COUNT(*) AS detail_request_count
      FROM requests
      WHERE path GLOB '/api/matches/*'
    `).detail_request_count;
    detailIdentityMismatch = recorder.one('cross.detail-identity', `
      WITH detail_requests AS (
        SELECT substr(path, length('/api/matches/') + 1) AS match_id,
               COUNT(*) AS request_count
        FROM requests
        WHERE path GLOB '/api/matches/*'
        GROUP BY substr(path, length('/api/matches/') + 1)
      ), expected_mismatches AS (
        SELECT matches.match_id
        FROM matches
        LEFT JOIN detail_requests USING (match_id)
        WHERE (matches.has_detail = 1 AND COALESCE(detail_requests.request_count, 0) != 1)
           OR (matches.has_detail = 0 AND COALESCE(detail_requests.request_count, 0) != 0)
      ), unexpected_mismatches AS (
        SELECT detail_requests.match_id
        FROM detail_requests
        LEFT JOIN matches USING (match_id)
        WHERE matches.match_id IS NULL
      )
      SELECT
        (SELECT COUNT(*) FROM expected_mismatches)
          + (SELECT COUNT(*) FROM unexpected_mismatches) AS mismatch_count
    `).mismatch_count;
  }
  if (tableNames.has('snapshots')) {
    metaTotals = recorder.all('cross.meta-totals', `
      WITH snapshot_sources AS (
        SELECT CASE WHEN json_valid(source_json) THEN source_json ELSE '{}' END AS source_json
        FROM snapshots
      )
      SELECT CASE
        WHEN json_type(source_json, '$.sourceCounts.matches') = 'integer'
          AND json_extract(source_json, '$.sourceCounts.matches') >= 0
        THEN json_extract(source_json, '$.sourceCounts.matches')
        ELSE NULL
      END AS total
      FROM snapshot_sources
    `).map(({ total }) => total);
  }
  return {
    detailIdentityMismatch,
    detailRequestCount,
    matchesWithDetail: aggregate.matches_with_detail,
    matchesTotal: aggregate.matches_total,
    metaTotals,
    roundsActual,
    roundsDeclared: aggregate.rounds_declared,
    roundsPerMatchMismatch,
  };
}

function matchDates(recorder, tableNames) {
  if (!tableNames.has('matches')) return { max: null, min: null };
  const row = recorder.one(
    'matches.date-range',
    `SELECT
      (SELECT started_at FROM matches
        ORDER BY julianday(started_at), started_at LIMIT 1) AS min,
      (SELECT started_at FROM matches
        ORDER BY julianday(started_at) DESC, started_at DESC LIMIT 1) AS max`,
  );
  return { max: row.max, min: row.min };
}

function violationCheck(id, violationCount) {
  return {
    id,
    status: violationCount === 0 ? 'pass' : 'fail',
    violationCount,
  };
}

function crossCountViolations(crossCounts) {
  let count = 0;
  if (crossCounts.matchesWithDetail !== crossCounts.matchesTotal) count += 1;
  if (crossCounts.detailRequestCount !== crossCounts.matchesWithDetail) count += 1;
  if (crossCounts.roundsActual !== crossCounts.roundsDeclared) count += 1;
  count += crossCounts.roundsPerMatchMismatch;
  count += crossCounts.detailIdentityMismatch;
  if (crossCounts.metaTotals.length !== 1) count += 1;
  count += crossCounts.metaTotals.filter((total) => total !== crossCounts.matchesTotal).length;
  return count;
}

function snapshotViolations(rows) {
  if (rows.length !== 1) return Math.abs(rows.length - 1) || 1;
  const row = rows[0];
  return Number(typeof row.snapshot_id !== 'string' || row.snapshot_id.trim() === '')
    + Number(typeof row.root_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.root_hash))
    + Number(row.status !== 'complete')
    + Number(typeof row.contract_version !== 'string' || row.contract_version.trim() === '');
}

function buildProfile(db, snapshotDir) {
  const recorder = createQueryRecorder(db);
  const schemaRows = recorder.all('schema.tables', `
    SELECT name, sql
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT GLOB 'sqlite_*'
    ORDER BY name
  `);
  const tableNames = new Set(schemaRows.map(({ name }) => name));
  const integrityCheck = recorder.all('pragma.integrity-check', 'PRAGMA integrity_check', [], {
    sort: true,
  });
  const foreignKeyViolations = recorder.all(
    'pragma.foreign-key-check',
    'PRAGMA foreign_key_check',
    [],
    { sort: true },
  );
  const tables = schemaRows.map(({ name }) => profileTable(recorder, name));
  const tableMap = new Map(tables.map((table) => [table.name, table]));

  const snapshotRows = tableNames.has('snapshots') ? recorder.all('snapshot.identity', `
    SELECT snapshot_id, contract_version, root_hash, status
    FROM snapshots
    ORDER BY snapshot_id
  `) : [];
  const snapshotRow = snapshotRows.length === 1 ? snapshotRows[0] : null;
  const snapshot = snapshotRow ? {
    contractVersion: snapshotRow.contract_version,
    id: snapshotRow.snapshot_id,
    rootHash: snapshotRow.root_hash,
    status: snapshotRow.status,
  } : {
    contractVersion: null,
    id: basename(snapshotDir),
    rootHash: null,
    status: null,
  };
  registerAuditFunctions(db, snapshotDate(snapshot.id));

  const anomalies = {
    fractionalCountMetrics: 0,
    futureDates: 0,
    impossibleMetrics: 0,
    invalidDates: 0,
    invalidIds: 0,
    malformedJson: 0,
    negativeCountMetrics: 0,
  };
  for (const table of tables) {
    for (const column of table.columns) {
      if (typedColumnNeedsAudit(column)) {
        addAnomalies(anomalies, profileTypedColumn(recorder, table.name, column));
      }
      if (normalizedKey(column.name).endsWith('_json')) {
        addAnomalies(anomalies, profileJsonColumn(recorder, table.name, column));
      }
    }
  }

  const cardinalities = {
    maps: cardinality(recorder, tableMap, 'maps', [
      ['matches', 'map'], ['meta_maps', 'map'], ['player_map_snapshots', 'map'],
    ]),
    tags: cardinality(recorder, tableMap, 'tags', [
      ['match_tags', 'tag'], ['tags', 'tag'],
    ]),
    weapons: cardinality(recorder, tableMap, 'weapons', [
      ['match_player_weapons', 'weapon'], ['player_weapon_daily_stats', 'weapon'],
      ['player_weapon_stats', 'weapon'], ['weapon_daily_stats', 'weapon'],
      ['weapon_splits', 'weapon'], ['weapons', 'weapon'],
    ]),
  };
  const crossCounts = profileCrossCounts(recorder, tableNames);
  const dates = matchDates(recorder, tableNames);

  const integrityViolations = Number(
    integrityCheck.length !== 1 || integrityCheck[0]?.integrity_check !== 'ok',
  );
  const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
  const unexpectedTables = [...tableNames].filter((name) => !REQUIRED_TABLES.includes(name));
  const primaryKeyViolations = tables.reduce((sum, table) => (
    sum
      + Number(table.primaryKeyColumns.length === 0)
      + table.duplicatePrimaryKeyRows
      + table.nullPrimaryKeyRows
      + table.emptyPrimaryKeyRows
  ), 0);
  const anomalyViolations = Object.values(anomalies).reduce((sum, count) => sum + count, 0);
  const checks = [
    violationCheck('sqlite.integrity', integrityViolations),
    violationCheck('sqlite.foreign-keys', foreignKeyViolations.length),
    violationCheck('schema.required-tables', missingTables.length + unexpectedTables.length),
    violationCheck('snapshot.identity', snapshotViolations(snapshotRows)),
    violationCheck('tables.primary-key-grain', primaryKeyViolations),
    violationCheck('matches.cross-counts', crossCountViolations(crossCounts)),
    violationCheck('data.anomalies', anomalyViolations),
  ];
  const blockingChecks = checks.filter(({ status }) => status === 'fail').length;

  return {
    anomalies,
    blockingChecks,
    cardinalities,
    checks,
    crossCounts,
    integrity: { foreignKeyViolations, integrityCheck },
    matchDates: dates,
    queries: recorder.queries,
    rules: {
      countMetricKeys: [...COUNT_METRIC_KEYS],
      countMetricSuffixes: [...COUNT_SUFFIXES],
      datePolicy: 'strict recognized ISO calendar date/timestamp fields; RFC HTTP observedHeaders.date is transport metadata; future means after dated snapshot id',
      identifierPolicy: 'SteamID64 is exactly 17 digits; other known IDs are non-empty text',
      percentageRange: [0, 100],
      requiredTables: [...REQUIRED_TABLES],
    },
    snapshot,
    status: blockingChecks === 0 ? 'complete' : 'incomplete',
    tables,
    version: PROFILE_VERSION,
  };
}

export function profileDatabase(snapshotDir, dbPath = join(snapshotDir, 'whoajor.sqlite')) {
  if (typeof snapshotDir !== 'string' || snapshotDir.length === 0) {
    throw new TypeError('snapshotDir must be a non-empty string');
  }
  if (typeof dbPath !== 'string' || dbPath.length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  const db = new Database(dbPath, { fileMustExist: true, readonly: true });
  try {
    const profile = buildProfile(db, snapshotDir);
    let dataFingerprint = null;
    try {
      dataFingerprint = computeDataFingerprint(db);
    } catch (error) {
      if (profile.anomalies.malformedJson === 0) throw error;
    }
    return {
      ...profile,
      database: {
        dataFingerprint,
        decompressedSha256: sha256FileSync(dbPath),
      },
    };
  } finally {
    db.close();
  }
}

function sha256FileSync(path) {
  const descriptor = openSync(path, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    closeSync(descriptor);
  }
}

function stablePrettyJson(value) {
  return `${JSON.stringify(JSON.parse(canonicalStringify(value)), null, 2)}\n`;
}

async function writeAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileSequence += 1}`;
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeDataProfile(
  snapshotDir,
  dbPath = join(snapshotDir, 'whoajor.sqlite'),
  outputPath = join(snapshotDir, 'data-profile.json'),
) {
  const report = profileDatabase(snapshotDir, dbPath);
  await writeAtomically(outputPath, stablePrettyJson(report));
  return report;
}
