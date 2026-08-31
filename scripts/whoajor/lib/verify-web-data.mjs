import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat, mkdtemp, readFile, readdir, realpath, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  isAbsolute, join, normalize, relative, sep,
} from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  assertShardGzipSize, CANONICAL_ROOT, DETAIL_INDEX_FIELDS, GAMEPLAY_TABLES, generateWebData,
  RECENT_WINDOW, VERSION,
} from './web-data.mjs';

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertFiniteNumbers(value, path = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`non-finite number at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertFiniteNumbers(nested, `${path}.${key}`);
    }
  }
}

function assertSafeValues(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValues(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'source_json') throw new Error(`source_json leaked at ${path}.${key}`);
    if (/steamids$/i.test(key)) {
      if (!Array.isArray(nested) || nested.some((item) => typeof item !== 'string')) {
        throw new Error(`SteamID array is not string-safe at ${path}.${key}`);
      }
    } else if (/steamid$/i.test(key) && nested !== null && typeof nested !== 'string') {
      throw new Error(`SteamID is not a string at ${path}.${key}`);
    }
    assertSafeValues(nested, `${path}.${key}`);
  }
}

function safeRelativePath(value, label, prefix) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')) {
    throw new Error(`unsafe ${label} path: ${value}`);
  }
  const safe = normalize(value);
  if (safe !== value || safe === '..' || safe.startsWith(`..${sep}`)
    || (prefix && !safe.startsWith(`${prefix}${sep}`))) {
    throw new Error(`unsafe ${label} path: ${value}`);
  }
  return safe;
}

async function listFilesRejectSymlinks(root, relativePath = '') {
  const path = join(root, relativePath);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`symlink forbidden: ${relativePath || '.'}`);
  if (!info.isDirectory()) return [relativePath];
  const files = [];
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(relativePath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink forbidden: ${child}`);
    files.push(...await listFilesRejectSymlinks(root, child));
  }
  return files;
}

async function assertRealpathContained(rootReal, path, label) {
  const targetReal = await realpath(path);
  const fromRoot = relative(rootReal, targetReal);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes output root`);
  }
}

function assertUnique(rows, dataset, grain) {
  const seen = new Set();
  for (const row of rows) {
    const key = grain(row);
    if (seen.has(key)) throw new Error(`${dataset} duplicate logical row: ${key}`);
    seen.add(key);
  }
}

function assertMetricDenominator(value, denominator, label) {
  if (!Number.isFinite(denominator) || denominator < 0) {
    throw new Error(`denominator invariant failed at ${label}`);
  }
  if ((denominator === 0 && value !== null)
    || (denominator > 0 && (typeof value !== 'number' || !Number.isFinite(value)))) {
    throw new Error(`denominator invariant failed at ${label}`);
  }
}

function assertWindow(window, label) {
  const { sums, metrics } = window;
  assertMetricDenominator(metrics.rating, sums.rounds, `${label}.rating`);
  assertMetricDenominator(metrics.adr, sums.rounds, `${label}.adr`);
  assertMetricDenominator(metrics.kast, sums.rounds, `${label}.kast`);
  assertMetricDenominator(metrics.roundWinRate, sums.rounds, `${label}.roundWinRate`);
  assertMetricDenominator(metrics.openingDiffPer100, sums.rounds, `${label}.openingDiffPer100`);
  assertMetricDenominator(metrics.kd, sums.deaths, `${label}.kd`);
  assertMetricDenominator(metrics.tradeRate, sums.deaths, `${label}.tradeRate`);
  assertMetricDenominator(metrics.retakeWinRate, sums.retakeAttempts, `${label}.retakeWinRate`);
  assertMetricDenominator(metrics.postplantWinRate, sums.postplantRounds, `${label}.postplantWinRate`);
  assertMetricDenominator(metrics.clutchWinRate, sums.clutchAttempts, `${label}.clutchWinRate`);
  for (const side of ['T', 'CT']) {
    const sideSums = sums.sides[side];
    const sideMetrics = metrics.sides[side];
    for (const metric of ['rating', 'adr', 'roundWinRate', 'openingDiffPer100']) {
      assertMetricDenominator(sideMetrics[metric], sideSums.rounds, `${label}.sides.${side}.${metric}`);
    }
  }
}

function assertCalculatedNumericSemantics(rowsByDataset) {
  for (const dataset of ['playerMetrics', 'teamMetrics']) {
    for (const [index, row] of (rowsByDataset.get(dataset) ?? []).entries()) {
      assertWindow(row.recent, `${dataset}[${index}].recent`);
      assertWindow(row.allTime, `${dataset}[${index}].allTime`);
    }
  }
}

function assertGameplayCompleteness(manifest, rowsByDataset) {
  const expected = GAMEPLAY_TABLES.map(([table, dataset]) => `${table}:${dataset}`);
  const actual = (manifest.gameplayTables ?? []).map(({ table, dataset }) => `${table}:${dataset}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('canonical gameplay allowlist mismatch');
  }
  for (const entry of manifest.gameplayTables) {
    const exported = rowsByDataset.get(entry.dataset)?.length ?? 0;
    if (entry.table === 'player_weapon_stats') {
      if (exported <= 0 || exported > entry.sourceRows) {
        throw new Error(`${entry.dataset} gameplay completeness mismatch`);
      }
    } else if (exported !== entry.sourceRows) {
      throw new Error(`${entry.dataset} gameplay completeness mismatch`);
    }
  }
}

function assertDetailIndexes(manifest, rowsByPath) {
  const expectedDatasets = Object.keys(DETAIL_INDEX_FIELDS).sort();
  const actual = manifest.detailIndexes;
  if (!actual || Array.isArray(actual)
    || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(expectedDatasets)) {
    throw new Error('detail index dataset allowlist mismatch');
  }
  for (const dataset of expectedDatasets) {
    const expectedFields = DETAIL_INDEX_FIELDS[dataset];
    const fields = actual[dataset];
    if (!fields || Array.isArray(fields)
      || JSON.stringify(Object.keys(fields).sort()) !== JSON.stringify([...expectedFields].sort())) {
      throw new Error(`detail index field allowlist mismatch: ${dataset}`);
    }
    for (const field of expectedFields) {
      const expected = {};
      for (const asset of manifest.assets.filter((entry) => entry.dataset === dataset)) {
        for (const row of rowsByPath.get(asset.path) ?? []) {
          const key = row[field];
          if (typeof key !== 'string' || !key) {
            throw new Error(`detail index key is not a string: ${dataset}.${field}`);
          }
          if (!expected[key]) expected[key] = [];
          if (expected[key].at(-1) !== asset.path) expected[key].push(asset.path);
        }
      }
      const indexed = fields[field];
      const normalizeKeys = (value) => Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, value[key]]),
      );
      if (!indexed || Array.isArray(indexed)
        || JSON.stringify(normalizeKeys(indexed)) !== JSON.stringify(normalizeKeys(expected))) {
        throw new Error(`detail index mapping mismatch: ${dataset}.${field}`);
      }
    }
  }
}

export async function verifyPublishedTree({ outputDir, sourceGzip }) {
  const files = await listFilesRejectSymlinks(outputDir);
  const rootReal = await realpath(outputDir);
  const currentPath = join(outputDir, 'current.json');
  await assertRealpathContained(rootReal, currentPath, 'current pointer');
  const currentBytes = await readFile(currentPath);
  const current = JSON.parse(currentBytes.toString('utf8'));
  if (current.root !== CANONICAL_ROOT || current.version !== VERSION) {
    throw new Error('current pointer root/version mismatch');
  }
  if (current.manifest !== `${VERSION}/manifest.json`) {
    throw new Error(`unsafe manifest path: ${current.manifest}`);
  }
  const manifestRelative = safeRelativePath(current.manifest, 'manifest', VERSION);
  const manifestPath = join(outputDir, manifestRelative);
  await assertRealpathContained(rootReal, manifestPath, 'manifest');
  const manifestBytes = await readFile(manifestPath);
  if (sha256Bytes(manifestBytes) !== current.manifestSha256) {
    throw new Error('manifest SHA mismatch');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.root !== CANONICAL_ROOT || manifest.contractVersion !== '1.1.0') {
    throw new Error('manifest canonical root/contract mismatch');
  }
  if (manifest.window.recentStart !== RECENT_WINDOW.recentStart
    || manifest.window.recentEnd !== RECENT_WINDOW.recentEnd) {
    throw new Error('manifest recent window mismatch');
  }
  if (sourceGzip && await sha256File(sourceGzip) !== manifest.source.gzipSha256) {
    throw new Error('canonical gzip SHA mismatch');
  }
  const expectedHashes = {
    gzipSha256: '917af8cec282dc68fa00ffbcbd2117b0b4587c02da0313ebe8359f7fca8b1234',
    sqliteSha256: '0cc8105931ef2491c29504eb5b0ef115d77090def76bd0adcf1b3ab5fff2d4a1',
    dataFingerprint: '5a0e563128ab92cc2bad823852850c2fd3668155120f216a0116694b4de578a7',
  };
  for (const [field, expected] of Object.entries(expectedHashes)) {
    if (manifest.source[field] !== expected) throw new Error(`canonical ${field} mismatch`);
  }

  const assetPaths = new Set();
  for (const asset of manifest.assets) {
    const safe = safeRelativePath(asset.path, 'asset', 'data');
    if (assetPaths.has(safe)) throw new Error(`duplicate asset path: ${safe}`);
    assetPaths.add(safe);
  }
  const versionPrefix = `${VERSION}${sep}`;
  const actualVersionFiles = files.filter((path) => path.startsWith(versionPrefix))
    .map((path) => path.slice(versionPrefix.length));
  const listedVersionFiles = new Set(['manifest.json', ...assetPaths]);
  const unlisted = actualVersionFiles.filter((path) => !listedVersionFiles.has(path));
  if (unlisted.length) throw new Error(`unlisted file: ${unlisted[0]}`);
  if (actualVersionFiles.length !== listedVersionFiles.size) {
    throw new Error('listed asset file missing');
  }
  const listedFiles = new Set([
    'current.json',
    ...[...listedVersionFiles].map((path) => join(VERSION, path)),
  ]);
  const stale = files.filter((path) => !listedFiles.has(path));
  if (stale.length) throw new Error(`unlisted file: ${stale[0]}`);

  const rowsByDataset = new Map();
  const rowsByPath = new Map();
  let maxGzipBytes = 0;
  const versionDir = join(outputDir, current.version);
  for (const asset of manifest.assets) {
    const assetPath = join(versionDir, asset.path);
    await assertRealpathContained(rootReal, assetPath, 'asset');
    const bytes = await readFile(assetPath);
    if (sha256Bytes(bytes) !== asset.sha256) throw new Error(`asset SHA mismatch: ${asset.path}`);
    if (bytes.length !== asset.bytes) throw new Error(`asset byte count mismatch: ${asset.path}`);
    const gzipBytes = gzipSync(bytes, { mtime: 0 }).length;
    if (gzipBytes !== asset.gzipBytes) throw new Error(`asset gzip count mismatch: ${asset.path}`);
    assertShardGzipSize(gzipBytes, asset.path);
    maxGzipBytes = Math.max(maxGzipBytes, gzipBytes);
    const payload = JSON.parse(bytes.toString('utf8'));
    if (payload.root !== CANONICAL_ROOT || payload.dataset !== asset.dataset) {
      throw new Error(`asset envelope mismatch: ${asset.path}`);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length !== asset.count) {
      throw new Error(`asset row count mismatch: ${asset.path}`);
    }
    assertFiniteNumbers(payload);
    assertSafeValues(payload);
    rowsByPath.set(asset.path, payload.rows);
    if (!rowsByDataset.has(asset.dataset)) rowsByDataset.set(asset.dataset, []);
    rowsByDataset.get(asset.dataset).push(...payload.rows);
  }
  assertDetailIndexes(manifest, rowsByPath);
  assertGameplayCompleteness(manifest, rowsByDataset);
  const requiredCounts = {
    players: manifest.counts.players,
    matches: manifest.counts.matches,
    matchRounds: manifest.counts.rounds,
    maps: manifest.counts.maps,
    weapons: manifest.counts.weapons,
    trendPlayers: manifest.counts.trendPlayers,
    trendMatches: manifest.counts.trendMatches,
    playerRounds: manifest.counts.playerRounds,
    matchPlayerWeapons: manifest.counts.matchPlayerWeapons,
    playerClutches: manifest.counts.playerClutches,
    leaderboardSnapshots: manifest.counts.leaderboardSnapshots,
  };
  for (const [dataset, expected] of Object.entries(requiredCounts)) {
    if (rowsByDataset.get(dataset)?.length !== expected) {
      throw new Error(`${dataset} source count mismatch`);
    }
  }
  const grains = {
    leaderboardSnapshots: (row) => `${row.snapshotId}|${row.queryFingerprint}|${row.steamid}`,
    matchPlayerWeapons: (row) => `${row.matchId}|${row.steamid}|${row.weapon}`,
    playerWeaponStats: (row) => `${row.steamid}|${row.weapon}`,
    playerWeaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponSplits: (row) => `${row.steamid}|${row.weapon}`,
    mirrorScouting: (row) => row.opponentTeamId,
  };
  for (const [dataset, grain] of Object.entries(grains)) {
    assertUnique(rowsByDataset.get(dataset) ?? [], dataset, grain);
  }
  assertCalculatedNumericSemantics(rowsByDataset);
  const rosters = rowsByDataset.get('rosters') ?? [];
  const rosterPlayers = rosters.flatMap(({ players }) => players);
  if (rosters.length !== 5 || rosterPlayers.length !== 30
    || new Set(rosterPlayers.map(({ steamid }) => steamid)).size !== 30
    || rosterPlayers.some(({ mapped }) => mapped !== true)) {
    throw new Error('roster mapping is not 30/30');
  }
  const evidence = rowsByDataset.get('evidence') ?? [];
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  if (evidenceIds.size !== evidence.length) throw new Error('duplicate evidence ID');
  const recommendations = rowsByDataset.get('recommendations') ?? [];
  const matchIds = recommendations.map(({ matchId }) => matchId);
  if (JSON.stringify(matchIds) !== JSON.stringify(['m01', 'm02', 'm09', 'm10'])
    || new Set(matchIds).size !== matchIds.length) {
    throw new Error('recommendation matchId mismatch');
  }
  for (const plan of recommendations) {
    if (plan.snapshotRoot !== CANONICAL_ROOT) throw new Error('recommendations root mismatch');
    if (plan.reviewed !== true) throw new Error('recommendations must be reviewed');
    if (plan.dataThrough !== RECENT_WINDOW.recentEnd) throw new Error('recommendations are stale');
    const references = [
      ...plan.threatEvidence, ...plan.weaknessEvidence, ...plan.mapEvidence,
      ...plan.caveats.map(({ evidenceId }) => evidenceId),
      ...(plan.mapOverrides ?? []).flatMap(({ evidenceIds = [] }) => evidenceIds),
    ];
    const missing = references.filter((id) => !evidenceIds.has(id));
    if (missing.length) throw new Error(`recommendations missing evidence: ${missing.join(', ')}`);
  }
  const mirrorScouting = rowsByDataset.get('mirrorScouting') ?? [];
  const mirrorTeamIds = mirrorScouting.map(({ opponentTeamId }) => opponentTeamId);
  if (mirrorScouting.length !== 4 || mirrorTeamIds.includes('us')) {
    throw new Error('mirror scouting must cover exactly the four opponents');
  }
  const rosterTeamIds = new Set(rosters.map(({ teamId }) => teamId));
  for (const mirror of mirrorScouting) {
    if (!rosterTeamIds.has(mirror.opponentTeamId)) {
      throw new Error(`mirror scouting unknown opponent: ${mirror.opponentTeamId}`);
    }
    if (mirror.maps.length !== 7) throw new Error('mirror scouting must cover the seven-map pool');
    for (const map of mirror.maps) {
      if (map.mirrorEdge !== -map.edge) throw new Error('mirror edge must invert the map edge');
    }
    for (const key of ['likelyPick', 'likelyBan']) {
      const value = mirror[key];
      if (value !== null && !mirror.maps.some((map) => map.map === value)) {
        throw new Error(`mirror scouting ${key} is outside the map pool`);
      }
    }
    const references = [
      ...mirror.maps.map(({ evidenceId }) => evidenceId),
      ...mirror.metricEdges.flatMap(({ usEvidenceId, opponentEvidenceId }) => [
        usEvidenceId, opponentEvidenceId,
      ]),
      ...mirror.focusTargets.map(({ evidenceId }) => evidenceId),
      ...mirror.softTargets.map(({ evidenceId }) => evidenceId),
      ...mirror.caveatEvidenceIds,
    ];
    const missing = references.filter((id) => !evidenceIds.has(id));
    if (missing.length) throw new Error(`mirror scouting missing evidence: ${missing.join(', ')}`);
  }
  return {
    status: 'ok', root: CANONICAL_ROOT, assets: manifest.assets.length,
    maxGzipBytes, rosterMapping: `${rosterPlayers.length}/30`,
    evidence: evidenceIds.size, recommendations: recommendations.length,
    mirrorScouting: mirrorScouting.length,
  };
}

async function byteTree(root, relativePath = '') {
  const files = [];
  const entries = await readdir(join(root, relativePath), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await byteTree(root, child));
    else files.push([child, await readFile(join(root, child))]);
  }
  return files;
}

export async function verifyWebData({ outputDir, sourceGzip }) {
  const receipt = await verifyPublishedTree({ outputDir, sourceGzip });
  const canonicalParent = await mkdtemp(join(tmpdir(), 'whoajor-canonical-verify-'));
  try {
    const canonicalDir = join(canonicalParent, 'whoajor');
    await generateWebData({ sourceGzip, outputDir: canonicalDir });
    const [actual, expected] = await Promise.all([byteTree(outputDir), byteTree(canonicalDir)]);
    if (actual.length !== expected.length) throw new Error('canonical byte mismatch: file count');
    for (let index = 0; index < expected.length; index += 1) {
      if (actual[index][0] !== expected[index][0]
        || !actual[index][1].equals(expected[index][1])) {
        throw new Error(`canonical byte mismatch: ${expected[index][0]}`);
      }
    }
    return receipt;
  } finally {
    await rm(canonicalParent, { recursive: true, force: true });
  }
}
