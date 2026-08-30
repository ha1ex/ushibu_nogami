import {
  copyFile, mkdtemp, readdir, readFile, rm, stat,
} from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { WHOAJOR_BASE_URL } from '../config.mjs';
import { serializeContract } from '../sync.mjs';
import { canonicalStringify } from './canonical-json.mjs';
import {
  inspectDatabaseArtifact, resolveDatabaseArtifact, sha256File,
} from './database-artifact.mjs';
import { buildDatabase } from './normalize.mjs';
import { profileDatabase } from './profile.mjs';
import { loadSnapshot } from './raw-store.mjs';
import { assertSamplingReport } from './sampling.mjs';
import { renderSourceSummary } from './summary.mjs';
import { validateSnapshot } from './validation.mjs';

const FULL_SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}-full(?:-v[1-9]\d*)?-snapshot$/;
const SPA_SURFACE_AUDIT_NAME = /^\d{4}-\d{2}-\d{2}-spa-surface-audit$/;
const COUNT_FIELDS = Object.freeze([
  'requests', 'matches', 'matchDetails', 'players', 'weapons', 'tags',
]);
const LEGACY_PINNED_FILES = Object.freeze([
  'manifest.json', 'contract.json', 'validation-report.json', 'sampling-report.json',
  'data-profile.json', 'source-summary.md', 'whoajor.sqlite.gz',
]);
const LEGACY_SNAPSHOT_DESCRIPTORS = Object.freeze({
  '2026-08-30-full-snapshot': Object.freeze({
    snapshotId: '2026-08-30-full',
    contractVersion: '1.0.0',
    rootHash: '3ec0c97ff8e1ba4181b6a7a72aa4aa9391926b4afeda617880a1a25d0298eb34',
    counts: Object.freeze({
      requests: 863,
      matches: 368,
      matchDetails: 368,
      players: 81,
      weapons: 39,
      tags: 1,
    }),
    database: Object.freeze({
      artifact: 'whoajor.sqlite.gz',
      artifactSha256: '9aaea6cb8854f0469869e96cc68f56ed82f9a3980ca2e12b77a3411f6fea2452',
      decompressedSha256: 'd0c575401a5c1caf62c4b551327b6bf43aa7426ed9c39c9d073d07a34084fad8',
      dataFingerprint: 'eb8f79492f442d2fb3cc57f5751d226dd23c73f66f3425e33fdc0376a1bee3a0',
    }),
    fileSha256: Object.freeze({
      'manifest.json': '54aa682f16a32e704bc4adc0fe5419d6737c7b6f9fa5d9dfae408a896a83940d',
      'contract.json': 'c326db4993d849c3ff92d1f30e083c1011c7ff1167bac4f3d92411466012a465',
      'validation-report.json': '84cea916e5db54f2942aed8cd1d6aa1b33b510de55c18c020e6b7b7e6bcb65aa',
      'sampling-report.json': '6d122ef9e0a270621c35f5015a9a8764bf2b60b42f6e14a52aafaf4175d39b2e',
      'data-profile.json': '36d67798cb748ed04820032f033848b6d2d5ffb31d9c64c8e57a67c132c6d3ba',
      'source-summary.md': 'e443f38182de358253c6c4042ecfb5c6ba7d65404375d406c83957a839785a37',
      'whoajor.sqlite.gz': '9aaea6cb8854f0469869e96cc68f56ed82f9a3980ca2e12b77a3411f6fea2452',
    }),
  }),
});
const ACTIVE_TEMPORARY_DIRECTORIES = new Set();
const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
let cleanupHandlers = null;

function cleanupTemporaryDirectoriesSync() {
  for (const path of ACTIVE_TEMPORARY_DIRECTORIES) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Best-effort signal/exit cleanup cannot replace the normal awaited cleanup below.
    }
    ACTIVE_TEMPORARY_DIRECTORIES.delete(path);
  }
}

function installCleanupHandlers() {
  if (cleanupHandlers) return;
  const onExit = () => cleanupTemporaryDirectoriesSync();
  const signals = Object.fromEntries(Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => [
    signal,
    () => {
      cleanupTemporaryDirectoriesSync();
      process.exitCode = code;
      setImmediate(() => process.exit(code));
    },
  ]));
  process.on('exit', onExit);
  for (const [signal, handler] of Object.entries(signals)) process.on(signal, handler);
  cleanupHandlers = { onExit, signals };
}

function removeCleanupHandlersIfIdle() {
  if (ACTIVE_TEMPORARY_DIRECTORIES.size !== 0 || !cleanupHandlers) return;
  process.removeListener('exit', cleanupHandlers.onExit);
  for (const [signal, handler] of Object.entries(cleanupHandlers.signals)) {
    process.removeListener(signal, handler);
  }
  cleanupHandlers = null;
}

async function createTemporaryDirectory(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  ACTIVE_TEMPORARY_DIRECTORIES.add(path);
  installCleanupHandlers();
  return path;
}

async function removeTemporaryDirectory(path) {
  try {
    await rm(path, { recursive: true, force: true });
  } finally {
    ACTIVE_TEMPORARY_DIRECTORIES.delete(path);
    removeCleanupHandlersIfIdle();
  }
}

async function readJson(path, label) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

async function readText(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`, { cause: error });
  }
}

function deterministicValidation(report) {
  const { checkedAt: _checkedAt, ...deterministic } = report;
  return deterministic;
}

function assertExactIsoTimestamp(value, label) {
  const parsed = new Date(value);
  if (
    typeof value !== 'string'
      || Number.isNaN(parsed.getTime())
      || parsed.toISOString() !== value
  ) throw new Error(`${label} must be an exact ISO timestamp`);
}

function sameJson(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

async function hasManifest(root, name) {
  try {
    const metadata = await stat(join(root, name, 'manifest.json'));
    return metadata.isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

async function isSpaSurfaceAudit(root, name) {
  if (!SPA_SURFACE_AUDIT_NAME.test(name)) return false;
  let manifest;
  try {
    manifest = await readJson(join(root, name, 'manifest.json'), `${name}: manifest`);
  } catch {
    return false;
  }
  return (
    manifest.schemaVersion === 1
      && manifest.auditId === name
      && manifest.origin === WHOAJOR_BASE_URL
      && manifest.rootUrl === `${WHOAJOR_BASE_URL}/`
      && manifest.policy?.method === 'GET'
      && manifest.policy?.bodyReadMethod === 'Response.arrayBuffer'
      && manifest.policy?.sequential === true
      && manifest.policy?.scope === 'root-and-recursive-same-origin-javascript'
      && Array.isArray(manifest.assets)
      && Array.isArray(manifest.assetGraph?.rootScripts)
      && Array.isArray(manifest.assetGraph?.edges)
      && manifest.report?.path === 'report.json'
  );
}

async function discoverSnapshotNames(whoajorRoot) {
  const entries = await readdir(whoajorRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, symbolicLink: entry.isSymbolicLink() }));
  const present = await Promise.all(candidates.map(async ({ name, symbolicLink }) => {
    if (!(await hasManifest(whoajorRoot, name))) return null;
    if (!symbolicLink && await isSpaSurfaceAudit(whoajorRoot, name)) return null;
    return name;
  }));
  return present.filter(Boolean).sort();
}

function inspectSqlite(dbPath, manifest, counts) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${canonicalStringify(integrity)}`);
    }
    const foreignKeys = db.pragma('foreign_key_check');
    if (foreignKeys.length !== 0) {
      throw new Error(`SQLite foreign_key_check failed: ${canonicalStringify(foreignKeys)}`);
    }
    const snapshotRows = db.prepare(`
      SELECT snapshot_id, contract_version, root_hash, status
      FROM snapshots
      ORDER BY snapshot_id
    `).all();
    if (snapshotRows.length !== 1) {
      throw new Error('SQLite must contain exactly one snapshot row');
    }
    const row = snapshotRows[0];
    if (
      row.snapshot_id !== manifest.snapshotId
        || row.contract_version !== manifest.contractVersion
        || row.root_hash !== manifest.rootHash
        || row.status !== 'complete'
    ) throw new Error('SQLite snapshot identity differs from manifest');

    const actualCounts = {
      requests: db.prepare('SELECT count(*) AS n FROM requests').get().n,
      matches: db.prepare('SELECT count(*) AS n FROM matches').get().n,
      matchDetails: db.prepare('SELECT count(*) AS n FROM matches WHERE has_detail = 1').get().n,
      players: db.prepare('SELECT count(*) AS n FROM players').get().n,
      weapons: db.prepare('SELECT count(*) AS n FROM weapons').get().n,
      tags: db.prepare('SELECT count(*) AS n FROM tags').get().n,
    };
    if (Object.hasOwn(counts, 'trendsPlayers')) {
      actualCounts.trendsPlayers = db.prepare('SELECT count(*) AS n FROM trend_players').get().n;
    }
    if (Object.hasOwn(counts, 'trendMatches')) {
      actualCounts.trendMatches = db.prepare('SELECT count(*) AS n FROM trend_matches').get().n;
    }
    for (const field of Object.keys(counts)) {
      if (!Object.hasOwn(actualCounts, field)) {
        throw new Error(`SQLite count field is unsupported by published gate: ${field}`);
      }
      if (actualCounts[field] !== counts[field]) {
        throw new Error(
          `SQLite count mismatch for ${field}: expected ${counts[field]}, got ${actualCounts[field]}`,
        );
      }
    }
    return { counts: actualCounts };
  } finally {
    db.close();
  }
}

function assertSourceCounts(manifest, counts) {
  for (const field of Object.keys(counts).filter((name) => name !== 'requests')) {
    if (manifest.sourceCounts?.[field] !== counts[field]) {
      throw new Error(
        `manifest sourceCounts.${field} differs from validation count ${counts[field]}`,
      );
    }
  }
}

async function inspectPublishedDatabase(snapshotDir, inspect) {
  const selected = await resolveDatabaseArtifact(snapshotDir);
  const temporaryDir = await createTemporaryDirectory('whoajor-published-artifact-');
  try {
    await copyFile(resolve(selected.path), join(temporaryDir, selected.artifact));
    return await inspectDatabaseArtifact(temporaryDir, inspect);
  } finally {
    await removeTemporaryDirectory(temporaryDir);
  }
}

function sourceOrigin(manifest) {
  const requestUrl = manifest.requests.find(({ url }) => typeof url === 'string')?.url;
  if (!requestUrl) return WHOAJOR_BASE_URL;
  try {
    return new URL(requestUrl).origin;
  } catch {
    throw new Error('manifest contains an invalid source URL');
  }
}

function snapshotDate(name, manifest) {
  const fromName = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (fromName) return fromName;
  const fromManifest = typeof manifest.startedAt === 'string'
    ? manifest.startedAt.slice(0, 10)
    : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromManifest)) return fromManifest;
  throw new Error(`${name}: snapshot date is unavailable from name or manifest.startedAt`);
}

function assertDescriptor(descriptor, name) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError(`${name}: pinned legacy descriptor must be an object`);
  }
  for (const [field, value] of [
    ['snapshotId', descriptor.snapshotId],
    ['contractVersion', descriptor.contractVersion],
    ['rootHash', descriptor.rootHash],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`${name}: pinned legacy descriptor ${field} must be a non-empty string`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(descriptor.rootHash)) {
    throw new TypeError(`${name}: pinned legacy descriptor rootHash must be a SHA-256 hash`);
  }
  if (!descriptor.counts || typeof descriptor.counts !== 'object') {
    throw new TypeError(`${name}: pinned legacy descriptor counts are required`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(descriptor.counts[field]) || descriptor.counts[field] < 0) {
      throw new TypeError(`${name}: pinned legacy descriptor counts.${field} is invalid`);
    }
  }
  if (
    descriptor.database?.artifact !== 'whoajor.sqlite.gz'
      || !['artifactSha256', 'decompressedSha256', 'dataFingerprint'].every((field) => (
        /^[a-f0-9]{64}$/.test(descriptor.database?.[field])
      ))
  ) throw new TypeError(`${name}: pinned legacy descriptor database identity is invalid`);

  const pinnedNames = Object.keys(descriptor.fileSha256 ?? {}).sort();
  const expectedNames = [...LEGACY_PINNED_FILES].sort();
  if (
    pinnedNames.length !== expectedNames.length
      || pinnedNames.some((value, index) => value !== expectedNames[index])
      || pinnedNames.some((value) => !/^[a-f0-9]{64}$/.test(descriptor.fileSha256[value]))
  ) throw new TypeError(`${name}: pinned legacy descriptor file inventory is invalid`);
  if (
    descriptor.fileSha256[descriptor.database.artifact]
      !== descriptor.database.artifactSha256
  ) throw new TypeError(`${name}: pinned legacy database artifact SHA-256 is inconsistent`);
}

async function assertPinnedArtifacts(snapshotDir, name, descriptor) {
  assertDescriptor(descriptor, name);
  for (const artifact of LEGACY_PINNED_FILES) {
    let actual;
    try {
      actual = await sha256File(join(snapshotDir, artifact));
    } catch (error) {
      throw new Error(
        `${name}: pinned artifact is missing or unreadable: ${artifact}: ${error.message}`,
        { cause: error },
      );
    }
    if (actual !== descriptor.fileSha256[artifact]) {
      throw new Error(
        `${name}: pinned artifact SHA-256 mismatch for ${artifact}: `
          + `expected ${descriptor.fileSha256[artifact]}, got ${actual}`,
      );
    }
  }
}

function assertLegacySamplingReport(name, snapshot, report, descriptor) {
  assertExactIsoTimestamp(report.checkedAt, `${name}: sampling report checkedAt`);
  if (
    report.version !== 1
      || report.status !== 'complete'
      || report.snapshotId !== descriptor.snapshotId
      || report.contractVersion !== descriptor.contractVersion
      || report.rootHash !== descriptor.rootHash
      || report.snapshotStatus !== snapshot.manifest.status
      || !Array.isArray(report.reasons)
      || report.reasons.length !== 0
      || !Array.isArray(report.checks)
      || report.selectedCount !== report.checks.length
      || !Number.isInteger(report.sampleTarget)
      || report.selectedCount < report.sampleTarget
  ) throw new Error(`${name}: pinned sampling report identity or completion state is invalid`);

  for (const check of report.checks) {
    const entry = snapshot.manifest.requests.find((candidate) => (
      candidate.key === check.identity
        && candidate.boundaryRole !== 'end'
        && candidate.canonicalSha256 === check.expectedCanonicalSha256
    ));
    if (
      !entry
        || check.status !== 'match'
        || check.reason !== null
        || check.actualCanonicalSha256 !== check.expectedCanonicalSha256
        || !/^[a-f0-9]{64}$/.test(check.expectedCanonicalSha256)
    ) throw new Error(`${name}: pinned sampling check is not backed by a raw request: ${check.identity}`);
  }
}

function assertLegacyProfile(name, profile, manifest, descriptor, database) {
  if (
    profile?.status !== 'complete'
      || profile.blockingChecks !== 0
      || profile.snapshot?.id !== descriptor.snapshotId
      || profile.snapshot?.contractVersion !== descriptor.contractVersion
      || profile.snapshot?.rootHash !== descriptor.rootHash
      || profile.snapshot?.status !== 'complete'
      || profile.database?.dataFingerprint !== descriptor.database.dataFingerprint
      || profile.database?.decompressedSha256 !== descriptor.database.decompressedSha256
      || database.dataFingerprint !== descriptor.database.dataFingerprint
      || database.decompressedSha256 !== descriptor.database.decompressedSha256
      || database.artifactSha256 !== descriptor.database.artifactSha256
      || manifest.snapshotId !== profile.snapshot.id
  ) throw new Error(`${name}: pinned data profile or SQLite identity is invalid`);
}

export async function verifyPinnedLegacySnapshot(snapshotDir, name, descriptor) {
  if (typeof snapshotDir !== 'string' || snapshotDir.length === 0) {
    throw new TypeError('snapshotDir must be a non-empty string');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('legacy snapshot name must be a non-empty string');
  }
  await assertPinnedArtifacts(snapshotDir, name, descriptor);
  const [contractDocument, persistedValidation, samplingReport, persistedProfile] = await Promise.all([
    readJson(join(snapshotDir, 'contract.json'), `${name}: contract.json`),
    readJson(join(snapshotDir, 'validation-report.json'), `${name}: validation report`),
    readJson(join(snapshotDir, 'sampling-report.json'), `${name}: sampling report`),
    readJson(join(snapshotDir, 'data-profile.json'), `${name}: data profile`),
  ]);
  if (contractDocument.version !== descriptor.contractVersion) {
    throw new Error(`${name}: pinned contract version differs from its descriptor`);
  }

  let snapshot;
  try {
    snapshot = await loadSnapshot(snapshotDir);
  } catch (error) {
    throw new Error(`${name}: raw snapshot verification failed: ${error.message}`, { cause: error });
  }
  const { manifest } = snapshot;
  if (
    manifest.snapshotId !== descriptor.snapshotId
      || manifest.contractVersion !== descriptor.contractVersion
      || manifest.rootHash !== descriptor.rootHash
      || !['collected', 'complete'].includes(manifest.status)
      || manifest.requests.length !== descriptor.counts.requests
  ) throw new Error(`${name}: pinned manifest identity differs from its descriptor`);

  assertExactIsoTimestamp(
    persistedValidation.checkedAt,
    `${name}: validation report checkedAt`,
  );
  if (
    persistedValidation.status !== 'complete'
      || !Array.isArray(persistedValidation.errors)
      || persistedValidation.errors.length !== 0
      || persistedValidation.rootHash !== descriptor.rootHash
      || !sameJson(persistedValidation.counts, descriptor.counts)
  ) throw new Error(`${name}: pinned validation report identity or completion state is invalid`);
  assertSourceCounts(manifest, descriptor.counts);
  assertLegacySamplingReport(name, snapshot, samplingReport, descriptor);

  const database = await inspectPublishedDatabase(snapshotDir, async (dbPath) => ({
    ...inspectSqlite(dbPath, manifest, descriptor.counts),
    dataFingerprint: descriptor.database.dataFingerprint,
  }));
  if (database.artifact !== descriptor.database.artifact) {
    throw new Error(`${name}: pinned SQLite artifact name is invalid`);
  }
  assertLegacyProfile(name, persistedProfile, manifest, descriptor, database);

  return {
    name,
    status: 'complete',
    full: FULL_SNAPSHOT_NAME.test(name),
    verificationMode: 'pinned-legacy',
    rootHash: descriptor.rootHash,
    counts: descriptor.counts,
    database,
  };
}

async function verifyCurrentSnapshot(whoajorRoot, name) {
  const snapshotDir = join(whoajorRoot, name);
  const contractContents = await readText(
    join(snapshotDir, 'contract.json'),
    `${name}: contract.json`,
  );
  if (contractContents !== serializeContract()) {
    throw new Error(`${name}: contract.json is stale, incomplete, or non-canonical`);
  }
  const summaryContents = await readText(
    join(snapshotDir, 'source-summary.md'),
    `${name}: source-summary.md`,
  );
  let snapshot;
  try {
    snapshot = await loadSnapshot(snapshotDir);
  } catch (error) {
    throw new Error(`${name}: raw snapshot verification failed: ${error.message}`, { cause: error });
  }
  const { manifest } = snapshot;
  if (!['collected', 'complete'].includes(manifest.status)) {
    throw new Error(`${name}: manifest status is not ready: ${manifest.status}`);
  }

  const freshValidation = await validateSnapshot(snapshotDir);
  if (
    freshValidation.status !== 'complete'
      || !Array.isArray(freshValidation.errors)
      || freshValidation.errors.length !== 0
  ) {
    throw new Error(
      `${name}: fresh offline validation failed: ${canonicalStringify(freshValidation.errors)}`,
    );
  }
  const persistedValidation = await readJson(
    join(snapshotDir, 'validation-report.json'),
    `${name}: validation report`,
  );
  assertExactIsoTimestamp(persistedValidation.checkedAt, 'validation report checkedAt');
  if (!sameJson(
    deterministicValidation(persistedValidation),
    deterministicValidation(freshValidation),
  )) throw new Error(`${name}: validation report is stale or differs from fresh offline validation`);
  assertSourceCounts(manifest, freshValidation.counts);

  const samplingReport = await readJson(
    join(snapshotDir, 'sampling-report.json'),
    `${name}: sampling report`,
  );
  try {
    await assertSamplingReport(snapshot, samplingReport);
  } catch (error) {
    throw new Error(`${name}: sampling report verification failed: ${error.message}`, { cause: error });
  }

  const persistedProfile = await readJson(
    join(snapshotDir, 'data-profile.json'),
    `${name}: data profile`,
  );
  const database = await inspectPublishedDatabase(snapshotDir, async (dbPath) => {
    const inspected = inspectSqlite(dbPath, manifest, freshValidation.counts);
    const freshProfile = profileDatabase(snapshotDir, dbPath);
    return {
      ...inspected,
      dataFingerprint: freshProfile.database.dataFingerprint,
      freshProfile,
    };
  });
  if (
    persistedProfile.status !== 'complete'
      || persistedProfile.blockingChecks !== 0
      || !sameJson(persistedProfile, database.freshProfile)
  ) throw new Error(`${name}: data profile is incomplete, stale, or differs from fresh offline profile`);
  if (
    persistedProfile.database?.dataFingerprint !== database.dataFingerprint
      || persistedProfile.database?.decompressedSha256 !== database.decompressedSha256
  ) throw new Error(`${name}: SQLite SHA-256 or data fingerprint differs from data profile`);

  const rebuildDir = await createTemporaryDirectory('whoajor-published-rebuild-');
  let independent;
  try {
    independent = await buildDatabase(snapshotDir, join(rebuildDir, 'whoajor.sqlite'));
  } finally {
    await removeTemporaryDirectory(rebuildDir);
  }
  if (
    !sameJson(independent.counts, database.counts)
      || independent.dataFingerprint !== database.dataFingerprint
  ) {
    throw new Error(
      `${name}: independent rebuild counts or fingerprint differs from published SQLite`,
    );
  }

  const { freshProfile: _freshProfile, ...databaseResult } = database;
  const metaEntry = manifest.requests.find((entry) => (
    entry.path === '/api/meta' && entry.boundaryRole === 'start'
  ));
  if (!metaEntry) throw new Error(`${name}: manifest has no start meta response`);
  const meta = await readJson(join(snapshotDir, metaEntry.blob), `${name}: start meta response`);
  if (typeof meta.min_date !== 'string' || typeof meta.max_date !== 'string') {
    throw new Error(`${name}: start meta response has no min_date/max_date`);
  }
  const expectedSummary = renderSourceSummary({
    snapshotName: name,
    date: snapshotDate(name, manifest),
    rawPath: `/01_raw/whoajor/${name}`,
    sourceUrl: sourceOrigin(manifest),
    sourceRange: {
      minDate: meta.min_date,
      maxDate: meta.max_date,
      artifact: metaEntry.blob.replaceAll('\\', '/'),
    },
    report: persistedValidation,
    database: databaseResult,
  });
  if (summaryContents !== expectedSummary) {
    throw new Error(`${name}: source-summary.md is stale or differs from verified artifacts`);
  }
  return {
    name,
    status: 'complete',
    full: FULL_SNAPSHOT_NAME.test(name),
    verificationMode: 'fresh-current-contract',
    rootHash: freshValidation.rootHash,
    counts: freshValidation.counts,
    database: databaseResult,
  };
}

export async function verifyPublishedSnapshots(whoajorRoot) {
  if (typeof whoajorRoot !== 'string' || whoajorRoot.length === 0) {
    throw new TypeError('whoajorRoot must be a non-empty string');
  }
  const snapshotNames = await discoverSnapshotNames(whoajorRoot);
  const fullSnapshotCount = snapshotNames.filter((name) => FULL_SNAPSHOT_NAME.test(name)).length;
  if (fullSnapshotCount === 0) {
    throw new Error('at least one published full snapshot is required');
  }
  const snapshots = [];
  for (const name of snapshotNames) {
    const descriptor = LEGACY_SNAPSHOT_DESCRIPTORS[name];
    snapshots.push(descriptor
      ? await verifyPinnedLegacySnapshot(join(whoajorRoot, name), name, descriptor)
      : await verifyCurrentSnapshot(whoajorRoot, name));
  }
  return { status: 'complete', fullSnapshotCount, snapshots };
}
