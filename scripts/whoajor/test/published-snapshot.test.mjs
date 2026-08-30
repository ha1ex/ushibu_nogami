import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { collectSnapshot } from '../collect.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { buildDatabase } from '../lib/normalize.mjs';
import { writeDataProfile } from '../lib/profile.mjs';
import { loadSnapshot } from '../lib/raw-store.mjs';
import { verifySample } from '../lib/sampling.mjs';
import { renderSourceSummary } from '../lib/summary.mjs';
import { validateSnapshot } from '../lib/validation.mjs';
import { createSummaryInput, serializeContract } from '../sync.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const NOW = () => new Date('2026-08-30T09:00:00Z');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CURRENT_SNAPSHOT_NAME = '2026-08-30-full-v2-snapshot';
const LEGACY_SNAPSHOT_NAME = '2026-08-30-full-snapshot';
const PINNED_ARTIFACTS = [
  'manifest.json',
  'contract.json',
  'validation-report.json',
  'sampling-report.json',
  'data-profile.json',
  'source-summary.md',
  'whoajor.sqlite.gz',
];
const PLAYERS = [
  '76561198000000001',
  '76561198000000002',
  '76561198000000003',
  '76561198000000004',
  '76561198000000005',
];

function storedResponseClient(snapshot) {
  return {
    async get(path, query = {}) {
      const queryText = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      ).toString();
      const identity = `GET ${path}${queryText ? `?${queryText}` : ''}`;
      const entry = snapshot.manifest.requests.find((candidate) => (
        candidate.key === identity && candidate.boundaryRole !== 'end'
      ));
      assert.ok(entry, `fixture snapshot must contain ${identity}`);
      return {
        path,
        query,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: await readFile(join(snapshot.root, entry.blob)),
        durationMs: 0,
      };
    },
  };
}

async function buildPublishedFixture({ gzip = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'whoajor-published-root-'));
  const snapshotDir = join(root, CURRENT_SNAPSHOT_NAME);
  await mkdir(snapshotDir);
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-1', 'match-2', 'match-3', 'match-4'],
    leaderboardPlayers: PLAYERS,
    draftPlayers: [],
    detailPlayers: PLAYERS,
    roundPlayers: PLAYERS.slice(0, 2),
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  await collectSnapshot({ outputDir: snapshotDir, client, now: NOW, pageSize: 2 });
  const validation = await validateSnapshot(snapshotDir);
  assert.equal(validation.status, 'complete', JSON.stringify(validation.errors));
  await writeFile(
    join(snapshotDir, 'validation-report.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
  );
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  await buildDatabase(snapshotDir, dbPath);
  await writeDataProfile(snapshotDir, dbPath);
  const snapshot = await loadSnapshot(snapshotDir);
  const sampling = await verifySample({
    snapshotDir,
    client: storedResponseClient(snapshot),
    now: NOW,
  });
  assert.equal(sampling.status, 'complete', JSON.stringify(sampling.reasons));
  if (gzip) {
    const { finalizeDatabaseArtifact } = await import('../lib/database-artifact.mjs');
    await finalizeDatabaseArtifact(snapshotDir, async () => ({}), { thresholdBytes: 0 });
  }
  const publishedTarget = join(
    REPO_ROOT,
    '01_raw',
    'whoajor',
    CURRENT_SNAPSHOT_NAME,
  );
  const summaryInput = await createSummaryInput(snapshotDir, publishedTarget);
  await writeFile(join(snapshotDir, 'contract.json'), serializeContract());
  await writeFile(join(snapshotDir, 'source-summary.md'), renderSourceSummary(summaryInput));
  return { root, snapshotDir };
}

async function copyPublishedFixture(t, options) {
  const source = await buildPublishedFixture(options);
  const root = await mkdtemp(join(tmpdir(), 'whoajor-published-copy-'));
  await cp(source.snapshotDir, join(root, CURRENT_SNAPSHOT_NAME), { recursive: true });
  await rm(source.root, { recursive: true, force: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, snapshotDir: join(root, CURRENT_SNAPSHOT_NAME) };
}

async function mutateJson(path, mutate) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function testFileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function buildPinnedLegacyFixture(t) {
  const built = await buildPublishedFixture();
  t.after(() => rm(built.root, { recursive: true, force: true }));
  const snapshotDir = join(built.root, LEGACY_SNAPSHOT_NAME);
  await rename(built.snapshotDir, snapshotDir);

  const manifestPath = join(snapshotDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.contractVersion = '1.0.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const db = new Database(dbPath);
  db.prepare('UPDATE snapshots SET contract_version = ?, source_json = ?').run(
    '1.0.0',
    JSON.stringify(manifest),
  );
  db.close();

  await mutateJson(join(snapshotDir, 'sampling-report.json'), (report) => {
    report.contractVersion = '1.0.0';
  });
  await writeFile(join(snapshotDir, 'contract.json'), '{"version":"1.0.0"}\n');
  await writeFile(join(snapshotDir, 'source-summary.md'), '# pinned legacy fixture\n');
  await writeDataProfile(snapshotDir, dbPath);
  await mutateJson(join(snapshotDir, 'data-profile.json'), (profile) => {
    profile.version = 1;
  });
  const { finalizeDatabaseArtifact } = await import('../lib/database-artifact.mjs');
  await finalizeDatabaseArtifact(snapshotDir, async () => ({}), { thresholdBytes: 0 });

  const [validation, profile] = await Promise.all([
    readFile(join(snapshotDir, 'validation-report.json'), 'utf8').then(JSON.parse),
    readFile(join(snapshotDir, 'data-profile.json'), 'utf8').then(JSON.parse),
  ]);
  const fileSha256 = Object.fromEntries(await Promise.all(PINNED_ARTIFACTS.map(async (name) => [
    name,
    await testFileSha256(join(snapshotDir, name)),
  ])));
  return {
    snapshotDir,
    descriptor: {
      snapshotId: manifest.snapshotId,
      contractVersion: '1.0.0',
      rootHash: manifest.rootHash,
      counts: validation.counts,
      database: {
        artifact: 'whoajor.sqlite.gz',
        artifactSha256: fileSha256['whoajor.sqlite.gz'],
        decompressedSha256: profile.database.decompressedSha256,
        dataFingerprint: profile.database.dataFingerprint,
      },
      fileSha256,
    },
  };
}

async function publishedTemporaryDirectories() {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('whoajor-published-'))
    .map(({ name }) => join(tmpdir(), name));
}

async function waitForNewTemporaryDirectory(before, child) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const found = (await publishedTemporaryDirectories()).find((path) => !before.has(path));
    if (found) return found;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('verification child exited before creating its OS temp directory');
    }
    await delay(2);
  }
  throw new Error('verification child did not create an observable OS temp directory');
}

test('published gate отклоняет корпус без полного снимка', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const whoajorRoot = await mkdtemp(join(tmpdir(), 'whoajor-published-empty-'));
  t.after(() => rm(whoajorRoot, { recursive: true, force: true }));

  await assert.rejects(
    verifyPublishedSnapshots(whoajorRoot),
    /at least one published full snapshot/i,
  );
});

test('published gate офлайн сверяет raw, reports и SQLite полного снимка', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root } = await copyPublishedFixture(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('published gate attempted network access'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await verifyPublishedSnapshots(root);

  assert.equal(result.status, 'complete');
  assert.equal(result.fullSnapshotCount, 1);
  assert.deepEqual(result.snapshots.map(({ name, status }) => ({ name, status })), [{
    name: CURRENT_SNAPSHOT_NAME,
    status: 'complete',
  }]);
  assert.deepEqual(result.snapshots[0].counts, {
    requests: 45,
    matches: 4,
    matchDetails: 4,
    players: 5,
    weapons: 2,
    tags: 1,
    trendsPlayers: 2,
    trendMatches: 2,
  });
  assert.equal(result.snapshots[0].verificationMode, 'fresh-current-contract');
  assert.match(result.snapshots[0].rootHash, /^[a-f0-9]{64}$/);
  assert.match(result.snapshots[0].database.dataFingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.snapshots[0].database.decompressedSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.snapshots[0].database.artifact, 'whoajor.sqlite');
});

test('versioned full snapshot использует строгую fresh-проверку текущего CONTRACT', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'manifest.json'), (manifest) => {
    manifest.contractVersion = '1.0.0';
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /fresh offline validation failed.*CONTRACT 1\.1\.0 snapshot is required/i,
  );
});

test('pinned legacy path не переинтерпретирует снимок текущим CONTRACT', async (t) => {
  const { verifyPinnedLegacySnapshot } = await import('../lib/published-snapshot.mjs');
  const { snapshotDir, descriptor } = await buildPinnedLegacyFixture(t);
  const fresh = await validateSnapshot(snapshotDir);
  assert.equal(fresh.status, 'incomplete');
  assert.match(
    JSON.stringify(fresh.errors),
    /CONTRACT 1\.1\.0 snapshot is required/,
  );

  const result = await verifyPinnedLegacySnapshot(
    snapshotDir,
    LEGACY_SNAPSHOT_NAME,
    descriptor,
  );

  assert.equal(result.name, LEGACY_SNAPSHOT_NAME);
  assert.equal(result.status, 'complete');
  assert.equal(result.verificationMode, 'pinned-legacy');
  assert.equal(result.rootHash, descriptor.rootHash);
  assert.deepEqual(result.counts, descriptor.counts);
  assert.equal(result.database.artifactSha256, descriptor.database.artifactSha256);
});

test('pinned legacy path отклоняет согласованную подмену metadata по code-pinned SHA', async (t) => {
  const { verifyPinnedLegacySnapshot } = await import('../lib/published-snapshot.mjs');
  const { snapshotDir, descriptor } = await buildPinnedLegacyFixture(t);
  for (const name of [
    'manifest.json', 'contract.json', 'validation-report.json',
    'sampling-report.json', 'data-profile.json',
  ]) {
    await mutateJson(join(snapshotDir, name), (value) => {
      value.coordinatedTamper = true;
    });
  }

  await assert.rejects(
    verifyPinnedLegacySnapshot(snapshotDir, LEGACY_SNAPSHOT_NAME, descriptor),
    /pinned artifact SHA-256 mismatch.*manifest\.json/i,
  );
});

test('published gate отклоняет validation report без точного ISO checkedAt', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const reportPath = join(snapshotDir, 'validation-report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.checkedAt = 'yesterday';
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /validation report checkedAt must be an exact ISO timestamp/i,
  );
});

test('published gate сверяет fingerprint SQLite с независимой сборкой из raw', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const db = new Database(dbPath);
  db.prepare("UPDATE matches SET metrics_json = '{\"tampered\":true}' WHERE match_id = 'match-1'").run();
  db.close();
  await writeDataProfile(snapshotDir, dbPath);

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /independent rebuild.*fingerprint/i,
  );
});

test('published gate отклоняет отсутствующий exact response blob', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const manifest = JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8'));
  await rm(join(snapshotDir, manifest.requests[0].blob));

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /raw snapshot verification failed.*blob is missing/i,
  );
});

test('published gate отклоняет stale validation counts', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'validation-report.json'), (report) => {
    report.counts.matches += 1;
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /validation report is stale/i,
  );
});

test('published gate отклоняет stale sampling report', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'sampling-report.json'), (report) => {
    report.checks[0].actualCanonicalSha256 = '0'.repeat(64);
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /sampling report verification failed/i,
  );
});

test('published gate отклоняет incomplete data profile', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'data-profile.json'), (report) => {
    report.status = 'incomplete';
    report.blockingChecks = 1;
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /data profile is incomplete/i,
  );
});

test('fresh current path отклоняет legacy data-profile version как stale', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'data-profile.json'), (report) => {
    report.version = 1;
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /data profile is incomplete, stale, or differs from fresh offline profile/i,
  );
});

test('published gate требует ровно один SQLite artifact', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const missing = await copyPublishedFixture(t);
  await rm(join(missing.snapshotDir, 'whoajor.sqlite'));
  await assert.rejects(
    verifyPublishedSnapshots(missing.root),
    /required database artifact.*is missing/i,
  );

  const duplicate = await copyPublishedFixture(t);
  await writeFile(join(duplicate.snapshotDir, 'whoajor.sqlite.gz'), 'not-a-database');
  await assert.rejects(
    verifyPublishedSnapshots(duplicate.root),
    /exactly one database artifact/i,
  );
});

test('published gate проверяет deterministic gzip и его SHA', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root } = await copyPublishedFixture(t, { gzip: true });

  const result = await verifyPublishedSnapshots(root);

  assert.equal(result.snapshots[0].database.artifact, 'whoajor.sqlite.gz');
  assert.match(result.snapshots[0].database.artifactSha256, /^[a-f0-9]{64}$/);
  assert.match(result.snapshots[0].database.decompressedSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(
    result.snapshots[0].database.artifactSha256,
    result.snapshots[0].database.decompressedSha256,
  );
});

test('published gate отклоняет неканоничный gzip', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t, { gzip: true });
  const gzipPath = join(snapshotDir, 'whoajor.sqlite.gz');
  const bytes = await readFile(gzipPath);
  bytes.writeUInt32LE(1, 4);
  await writeFile(gzipPath, bytes);

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /canonical deterministic gzip/i,
  );
});

test('published gate распаковывает gzip в OS temp и не изменяет read-only snapshot', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t, { gzip: true });
  await chmod(snapshotDir, 0o555);
  let result;
  try {
    result = await verifyPublishedSnapshots(root);
  } finally {
    await chmod(snapshotDir, 0o755);
  }

  assert.equal(result.status, 'complete');
  assert.equal(result.snapshots[0].database.artifact, 'whoajor.sqlite.gz');
});

test('published gate не создаёт WAL/SHM рядом с direct SQLite в read-only snapshot', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.close();
  await writeDataProfile(snapshotDir, dbPath);
  const summaryInput = await createSummaryInput(
    snapshotDir,
    join(REPO_ROOT, '01_raw', 'whoajor', CURRENT_SNAPSHOT_NAME),
  );
  await writeFile(join(snapshotDir, 'source-summary.md'), renderSourceSummary(summaryInput));
  await Promise.all([
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
  await chmod(snapshotDir, 0o555);
  let result;
  try {
    result = await verifyPublishedSnapshots(root);
  } finally {
    await chmod(snapshotDir, 0o755);
  }

  assert.equal(result.status, 'complete');
  await assert.rejects(readFile(`${dbPath}-wal`), { code: 'ENOENT' });
  await assert.rejects(readFile(`${dbPath}-shm`), { code: 'ENOENT' });
});

test('published gate очищает большой OS temp при SIGINT/SIGTERM', async (t) => {
  const source = await buildPublishedFixture({ gzip: true });
  t.after(() => rm(source.root, { recursive: true, force: true }));
  const moduleUrl = pathToFileURL(join(
    REPO_ROOT,
    'scripts',
    'whoajor',
    'lib',
    'published-snapshot.mjs',
  )).href;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const before = new Set(await publishedTemporaryDirectories());
    const child = spawn(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { verifyPublishedSnapshots } from ${JSON.stringify(moduleUrl)};`
        + `await verifyPublishedSnapshots(${JSON.stringify(source.root)});`,
    ], { stdio: 'ignore' });
    let temporaryDir;
    try {
      temporaryDir = await waitForNewTemporaryDirectory(before, child);
      child.kill(signal);
      await once(child, 'exit');

      assert.equal((await publishedTemporaryDirectories()).includes(temporaryDir), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true });
    }
  }
});

test('published gate валидирует все manifest, а не только full snapshot', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const secondary = join(root, '2026-08-30-partial-snapshot');
  await cp(snapshotDir, secondary, { recursive: true });
  const manifest = JSON.parse(await readFile(join(secondary, 'manifest.json'), 'utf8'));
  await rm(join(secondary, manifest.requests[0].blob));

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /2026-08-30-partial-snapshot.*raw snapshot verification failed/i,
  );
});

test('published gate не считает canonical SPA surface audit соседним API snapshot', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const genericName = 'manual-snapshot';
  const generic = join(root, genericName);
  await cp(snapshotDir, generic, { recursive: true });
  const summaryInput = await createSummaryInput(
    generic,
    join(REPO_ROOT, '01_raw', 'whoajor', genericName),
  );
  await writeFile(join(generic, 'source-summary.md'), renderSourceSummary(summaryInput));

  const auditName = '2026-08-30-spa-surface-audit';
  const auditDir = join(root, auditName);
  await mkdir(auditDir);
  await writeFile(join(auditDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    auditId: auditName,
    origin: 'https://stats.whoajor.com',
    rootUrl: 'https://stats.whoajor.com/',
    policy: {
      method: 'GET',
      bodyReadMethod: 'Response.arrayBuffer',
      sequential: true,
      scope: 'root-and-recursive-same-origin-javascript',
    },
    assets: [],
    assetGraph: { rootScripts: [], edges: [] },
    report: { path: 'report.json', bytes: 2, sha256: '0'.repeat(64) },
  }, null, 2)}\n`);

  const result = await verifyPublishedSnapshots(root);

  assert.equal(result.fullSnapshotCount, 1);
  assert.deepEqual(result.snapshots.map(({ name }) => name), [
    CURRENT_SNAPSHOT_NAME,
    genericName,
  ]);
});

test('published gate берёт дату generic snapshot из manifest.startedAt', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  const genericName = 'manual-snapshot';
  const generic = join(root, genericName);
  await cp(snapshotDir, generic, { recursive: true });
  const summaryInput = await createSummaryInput(
    generic,
    join(REPO_ROOT, '01_raw', 'whoajor', genericName),
  );
  await writeFile(join(generic, 'source-summary.md'), renderSourceSummary(summaryInput));

  const result = await verifyPublishedSnapshots(root);

  assert.deepEqual(result.snapshots.map(({ name }) => name), [
    CURRENT_SNAPSHOT_NAME,
    genericName,
  ]);
});

test('published gate сканирует manifest в symlink-каталоге из прямого glob', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const source = await buildPublishedFixture();
  const root = await mkdtemp(join(tmpdir(), 'whoajor-published-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(source.root, { recursive: true, force: true }));
  await symlink(
    source.snapshotDir,
    join(root, CURRENT_SNAPSHOT_NAME),
    'dir',
  );

  const result = await verifyPublishedSnapshots(root);

  assert.equal(result.fullSnapshotCount, 1);
  assert.deepEqual(result.snapshots.map(({ name }) => name), [CURRENT_SNAPSHOT_NAME]);
});

test('published gate сверяет manifest sourceCounts с raw', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const { root, snapshotDir } = await copyPublishedFixture(t);
  await mutateJson(join(snapshotDir, 'manifest.json'), (manifest) => {
    manifest.sourceCounts.players += 1;
  });

  await assert.rejects(
    verifyPublishedSnapshots(root),
    /sourceCounts\.players differs from validation count/i,
  );
});

test('published gate требует присутствующий канонический contract.json', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const missing = await copyPublishedFixture(t);
  await rm(join(missing.snapshotDir, 'contract.json'));
  await assert.rejects(
    verifyPublishedSnapshots(missing.root),
    /contract\.json is missing/i,
  );

  const tampered = await copyPublishedFixture(t);
  await writeFile(join(tampered.snapshotDir, 'contract.json'), '{}\n');
  await assert.rejects(
    verifyPublishedSnapshots(tampered.root),
    /contract\.json is stale.*non-canonical/i,
  );
});

test('published gate требует присутствующий exact source-summary.md', async (t) => {
  const { verifyPublishedSnapshots } = await import('../lib/published-snapshot.mjs');
  const missing = await copyPublishedFixture(t);
  await rm(join(missing.snapshotDir, 'source-summary.md'));
  await assert.rejects(
    verifyPublishedSnapshots(missing.root),
    /source-summary\.md is missing/i,
  );

  const tampered = await copyPublishedFixture(t);
  await writeFile(join(tampered.snapshotDir, 'source-summary.md'), '# stale\n');
  await assert.rejects(
    verifyPublishedSnapshots(tampered.root),
    /source-summary\.md is stale/i,
  );
});

test('standalone CLI проверяет переданный published root и печатает итог', async (t) => {
  const { runVerifyPublishedCli } = await import('../verify-published.mjs');
  const { root } = await copyPublishedFixture(t);
  let output = '';

  const result = await runVerifyPublishedCli([root], {
    stdout: { write: (chunk) => { output += chunk; } },
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.fullSnapshotCount, 1);
  assert.deepEqual(JSON.parse(output), {
    status: 'complete',
    fullSnapshotCount: 1,
    snapshots: result.snapshots,
  });
});
