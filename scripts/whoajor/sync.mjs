#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { collectSnapshot as collectSnapshotDefault } from './collect.mjs';
import { WHOAJOR_BASE_URL, DEFAULT_DELAY_MS } from './config.mjs';
import { canonicalStringify } from './lib/canonical-json.mjs';
import { CONTRACT } from './lib/contract.mjs';
import { createHttpClient } from './lib/http-client.mjs';
import {
  DATABASE_GZIP_THRESHOLD_BYTES, finalizeDatabaseArtifact, inspectDatabaseArtifact,
  resolveDatabaseArtifact,
} from './lib/database-artifact.mjs';
import {
  buildDatabase as buildDatabaseDefault, computeDataFingerprint,
} from './lib/normalize.mjs';
import { loadSnapshot } from './lib/raw-store.mjs';
import { renderSourceSummary } from './lib/summary.mjs';
import { validateSnapshot as validateSnapshotDefault } from './lib/validation.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');
const RENAME_NOREPLACE_HELPER = join(MODULE_DIR, 'rename-noreplace.py');
const REQUIRED_ARTIFACTS = Object.freeze([
  'manifest.json', 'validation-report.json', 'contract.json', 'source-summary.md',
]);
let temporarySequence = 0;
const execFileAsync = promisify(execFile);

function transformContract(value) {
  if (typeof value === 'function') {
    return { functionSource: Function.prototype.toString.call(value) };
  }
  if (Array.isArray(value)) return value.map(transformContract);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => (
      [key, transformContract(nested)]
    )));
  }
  return value;
}

export function contractDocument() {
  return JSON.parse(canonicalStringify(transformContract(CONTRACT)));
}

export function serializeContract() {
  return `${canonicalStringify(contractDocument())}\n`;
}

export async function writeFileAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${temporarySequence += 1}`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

export function defaultRawTarget(stagingDir) {
  const stagingName = basename(resolve(stagingDir));
  const targetName = stagingName.endsWith('-snapshot') ? stagingName : `${stagingName}-snapshot`;
  return join(REPO_ROOT, '01_raw', 'whoajor', targetName);
}

export function rawCitationPath(rawDir) {
  const absolute = resolve(rawDir);
  const repoRelative = relative(REPO_ROOT, absolute);
  if (repoRelative && !repoRelative.startsWith(`..${sep}`) && repoRelative !== '..') {
    return `/${repoRelative.split(sep).join('/')}`;
  }
  return `/${basename(absolute)}`;
}

function checkedDate(manifest, rawDir) {
  const fromName = basename(rawDir).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (fromName) return fromName;
  const fromManifest = typeof manifest.startedAt === 'string'
    ? manifest.startedAt.slice(0, 10)
    : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromManifest)) return fromManifest;
  throw new Error('snapshot date is unavailable from manifest.startedAt or target basename');
}

function sourceUrl(manifest) {
  const url = manifest.requests?.find(({ url: value }) => typeof value === 'string')?.url;
  if (!url) return WHOAJOR_BASE_URL;
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`manifest contains an invalid source URL: ${url}`);
  }
}

function readDatabaseResult(dbPath, expectedRootHash) {
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${JSON.stringify(integrity)}`);
    }
    const foreignKeys = db.pragma('foreign_key_check');
    if (foreignKeys.length !== 0) {
      throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeys)}`);
    }
    const snapshots = db.prepare('SELECT snapshot_id, root_hash, status FROM snapshots').all();
    if (snapshots.length !== 1 || snapshots[0].status !== 'complete') {
      throw new Error('SQLite must contain exactly one complete snapshot row');
    }
    if (snapshots[0].root_hash !== expectedRootHash) {
      throw new Error('SQLite snapshot root does not match manifest root');
    }
    const counts = {
      requests: db.prepare('SELECT count(*) AS n FROM requests').get().n,
      matches: db.prepare('SELECT count(*) AS n FROM matches').get().n,
      matchDetails: db.prepare('SELECT count(*) AS n FROM matches WHERE has_detail = 1').get().n,
      players: db.prepare('SELECT count(*) AS n FROM players').get().n,
      weapons: db.prepare('SELECT count(*) AS n FROM weapons').get().n,
      tags: db.prepare('SELECT count(*) AS n FROM tags').get().n,
    };
    return { counts, dataFingerprint: computeDataFingerprint(db) };
  } catch (error) {
    if (/SQLite/.test(error.message)) throw error;
    throw new Error(`SQLite verification failed: ${error.message}`, { cause: error });
  } finally {
    if (db?.open) db.close();
  }
}

export async function createSummaryInput(stagingDir, rawDir, database = undefined) {
  const [{ manifest }, report] = await Promise.all([
    loadSnapshot(stagingDir),
    readJson(join(stagingDir, 'validation-report.json'), 'validation report'),
  ]);
  if (report.rootHash !== manifest.rootHash) {
    throw new Error('validation report root does not match manifest root');
  }
  const checkedDatabase = await inspectDatabaseArtifact(
    stagingDir,
    (path) => readDatabaseResult(path, manifest.rootHash),
  );
  if (database) {
    if (canonicalStringify(database.counts) !== canonicalStringify(checkedDatabase.counts)) {
      throw new Error('database build result counts differ from persisted SQLite');
    }
    if (database.dataFingerprint !== checkedDatabase.dataFingerprint) {
      throw new Error('database build result dataFingerprint differs from persisted SQLite');
    }
  }
  const metaEntry = manifest.requests.find((entry) => (
    entry.path === '/api/meta' && entry.boundaryRole === 'start'
  ));
  if (!metaEntry) throw new Error('manifest has no start meta response for source range');
  const meta = await readJson(join(stagingDir, metaEntry.blob), 'start meta response');
  if (typeof meta.min_date !== 'string' || typeof meta.max_date !== 'string') {
    throw new Error('start meta response has no min_date/max_date source range');
  }
  return {
    snapshotName: basename(rawDir),
    date: checkedDate(manifest, rawDir),
    rawPath: rawCitationPath(rawDir),
    sourceUrl: sourceUrl(manifest),
    sourceRange: {
      minDate: meta.min_date,
      maxDate: meta.max_date,
      artifact: metaEntry.blob.split(sep).join('/'),
    },
    report,
    database: checkedDatabase,
  };
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

function deterministicReport(report) {
  const { checkedAt, ...deterministic } = report;
  return deterministic;
}

async function cleanupDatabaseArtifacts(path) {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-journal`, { force: true }),
  ]);
}

async function renameNoReplace(source, target) {
  try {
    await execFileAsync('python3', [RENAME_NOREPLACE_HELPER, source, target]);
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim();
    throw new Error(`atomic no-clobber publication failed: ${detail}`, { cause: error });
  }
}

async function assertRequiredArtifacts(stagingDir) {
  for (const artifact of REQUIRED_ARTIFACTS) {
    try {
      const metadata = await stat(join(stagingDir, artifact));
      if (!metadata.isFile()) throw new Error('not a file');
    } catch (error) {
      throw new Error(`required artifact ${artifact} is missing: ${error.message}`, { cause: error });
    }
  }
  await resolveDatabaseArtifact(stagingDir);
}

export async function publishSnapshot(stagingDir, rawDir) {
  if (!stagingDir || !rawDir) throw new TypeError('stagingDir and rawDir are required');
  const stagingPath = resolve(stagingDir);
  const rawPath = resolve(rawDir);
  if (stagingPath === rawPath) throw new Error('stagingDir and rawDir must differ');
  const [stagingMetadata, parentMetadata] = await Promise.all([
    stat(stagingPath),
    stat(dirname(rawPath)),
  ]);
  if (!stagingMetadata.isDirectory()) throw new Error('stagingDir must be a directory');
  if (!parentMetadata.isDirectory()) throw new Error('raw target parent must be a directory');
  if (stagingMetadata.dev !== parentMetadata.dev) {
    throw new Error('atomic publication requires staging and raw target on the same filesystem');
  }
  await assertRequiredArtifacts(stagingPath);

  const { manifest } = await loadSnapshot(stagingPath);
  if (manifest.status !== 'collected') {
    throw new Error(`manifest status must be collected before publication; got ${manifest.status}`);
  }
  const report = await readJson(join(stagingPath, 'validation-report.json'), 'validation report');
  if (report.status !== 'complete') {
    throw new Error(`validation report status must be complete; got ${report.status}`);
  }
  if (!Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error('validation report must contain an empty errors array');
  }
  if (report.rootHash !== manifest.rootHash) {
    throw new Error('validation report root does not match manifest root');
  }
  const freshReport = await validateSnapshotDefault(stagingPath);
  if (
    freshReport.status !== 'complete'
      || !Array.isArray(freshReport.errors)
      || freshReport.errors.length !== 0
  ) throw new Error('independent validation did not produce a complete report without errors');
  if (
    canonicalStringify(deterministicReport(freshReport))
      !== canonicalStringify(deterministicReport(report))
  ) throw new Error('persisted report differs from fresh validation report');

  const contractContents = await readFile(join(stagingPath, 'contract.json'), 'utf8');
  if (contractContents !== serializeContract()) {
    throw new Error('contract.json is stale, incomplete, or non-canonical');
  }
  const persistedDatabase = await inspectDatabaseArtifact(
    stagingPath,
    (path) => readDatabaseResult(path, manifest.rootHash),
  );
  const verificationDatabasePath = join(
    stagingPath,
    `whoajor.sqlite.publish-verify-${process.pid}-${randomUUID()}.sqlite`,
  );
  let independentDatabase;
  try {
    independentDatabase = await buildDatabaseDefault(stagingPath, verificationDatabasePath);
  } finally {
    await cleanupDatabaseArtifacts(verificationDatabasePath);
  }
  if (
    canonicalStringify(independentDatabase.counts)
      !== canonicalStringify(persistedDatabase.counts)
      || independentDatabase.dataFingerprint !== persistedDatabase.dataFingerprint
  ) throw new Error('persisted database differs from independent SQLite rebuild dataFingerprint/counts');

  const summaryInput = await createSummaryInput(stagingPath, rawPath, persistedDatabase);
  const expectedSummary = renderSourceSummary(summaryInput);
  const summary = await readFile(join(stagingPath, 'source-summary.md'), 'utf8');
  if (summary !== expectedSummary) {
    throw new Error('source-summary.md is stale or does not describe the publication target');
  }

  await renameNoReplace(stagingPath, rawPath);
  return rawPath;
}

function dependencies(overrides) {
  return {
    collectSnapshot: collectSnapshotDefault,
    validateSnapshot: validateSnapshotDefault,
    buildDatabase: buildDatabaseDefault,
    publishSnapshot,
    ...overrides,
  };
}

export async function sync(options = {}, overrides = {}) {
  const deps = dependencies(overrides);
  const stagingDir = options.publishExisting ?? options.stagingDir ?? options.outputDir;
  if (!stagingDir) throw new TypeError('stagingDir/outputDir or publishExisting is required');
  const rawDir = options.rawDir ?? options.rawTarget ?? defaultRawTarget(stagingDir);

  if (!options.publishExisting) {
    const client = options.client ?? createHttpClient({
      baseUrl: options.baseUrl ?? WHOAJOR_BASE_URL,
      delayMs: options.delayMs ?? DEFAULT_DELAY_MS,
    });
    const manifest = await deps.collectSnapshot({
      outputDir: stagingDir,
      client,
      now: options.now,
      pageSize: options.pageSize ?? 100,
      resume: options.resume ?? false,
    });
    if (manifest.status !== 'collected') {
      throw new Error(`snapshot collection did not complete: ${manifest.status}`);
    }
  }

  const report = await deps.validateSnapshot(stagingDir);
  await writeFileAtomically(
    join(stagingDir, 'validation-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (report.status !== 'complete' || !Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error('snapshot is not complete or validation reported errors');
  }
  await writeFileAtomically(join(stagingDir, 'contract.json'), serializeContract());
  const builtDatabase = await deps.buildDatabase(stagingDir, join(stagingDir, 'whoajor.sqlite'));
  const database = await finalizeDatabaseArtifact(
    stagingDir,
    (path) => readDatabaseResult(path, report.rootHash),
    {
      thresholdBytes: options.databaseGzipThresholdBytes
        ?? DATABASE_GZIP_THRESHOLD_BYTES,
    },
  );
  if (
    canonicalStringify(database.counts) !== canonicalStringify(builtDatabase.counts)
      || database.dataFingerprint !== builtDatabase.dataFingerprint
  ) throw new Error('final database artifact differs from database build result');
  const summaryInput = await createSummaryInput(stagingDir, rawDir, database);
  await writeFileAtomically(
    join(stagingDir, 'source-summary.md'),
    renderSourceSummary(summaryInput),
  );
  const published = await deps.publishSnapshot(stagingDir, rawDir);
  return { rawDir: published, report, database };
}

function parseNonNegativeInteger(value, option, { positive = false } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (positive ? 1 : 0)) {
    throw new Error(`${option} must be a ${positive ? 'positive' : 'non-negative'} integer`);
  }
  return parsed;
}

export function parseSyncCliArgs(args) {
  const values = args.filter((value) => value !== '--');
  const options = {
    baseUrl: WHOAJOR_BASE_URL,
    delayMs: DEFAULT_DELAY_MS,
    pageSize: 100,
    resume: false,
  };
  const positionals = [];
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    if (option === '--resume') {
      options.resume = true;
      continue;
    }
    if (!option.startsWith('--')) {
      positionals.push(option);
      continue;
    }
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    index += 1;
    if (option === '--publish-existing') options.publishExisting = value;
    else if (option === '--output') options.stagingDir = value;
    else if (option === '--raw-target') options.rawDir = value;
    else if (option === '--base-url') options.baseUrl = value;
    else if (option === '--delay-ms') options.delayMs = parseNonNegativeInteger(value, option);
    else if (option === '--page-size') {
      options.pageSize = parseNonNegativeInteger(value, option, { positive: true });
    } else throw new Error(`unknown option ${option}`);
  }
  if (positionals.length > 1 || (positionals.length === 1 && options.rawDir)) {
    throw new Error('usage: whoajor:sync [options] [raw-target]');
  }
  if (positionals.length === 1) options.rawDir = positionals[0];
  if (!options.publishExisting && !options.stagingDir) {
    throw new Error('whoajor:sync requires --output or --publish-existing');
  }
  return options;
}

async function main() {
  const options = parseSyncCliArgs(process.argv.slice(2));
  const result = await sync(options);
  process.stdout.write(`${JSON.stringify({
    rawDir: result.rawDir,
    status: result.report.status,
    rootHash: result.report.rootHash,
    counts: result.database.counts,
    dataFingerprint: result.database.dataFingerprint,
    databaseArtifact: result.database.artifact,
    decompressedSha256: result.database.decompressedSha256,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
