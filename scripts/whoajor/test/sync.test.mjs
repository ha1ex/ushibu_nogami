import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { collectSnapshot } from '../collect.mjs';
import { CONTRACT } from '../lib/contract.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { buildDatabase } from '../lib/normalize.mjs';
import { renderSourceSummary } from '../lib/summary.mjs';
import { validateSnapshot } from '../lib/validation.mjs';
import {
  contractDocument, defaultRawTarget, parseSyncCliArgs, publishSnapshot, rawCitationPath,
  serializeContract, sync,
} from '../sync.mjs';
import { createFixtureApi } from './fixture-api.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SYNC_CLI = join(HERE, '..', 'sync.mjs');
const SUMMARIZE_CLI = join(HERE, '..', 'summarize.mjs');
const NOW = () => new Date('2026-08-30T07:00:00Z');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function buildCollectedFixture(prefix = 'whoajor-sync-') {
  const stagingDir = await mkdtemp(join(tmpdir(), prefix));
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-2', 'match-1'],
    detailPlayers: ['76561198000000001', '76561198000000002'],
    roundPlayers: ['76561198000000001', '76561198000000002'],
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });
  await collectSnapshot({ outputDir: stagingDir, client, now: NOW, pageSize: 2 });
  return { stagingDir, fixture, client };
}

async function writeReadyArtifacts(stagingDir, rawDir) {
  const report = await validateSnapshot(stagingDir);
  await writeFile(join(stagingDir, 'validation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const database = await buildDatabase(stagingDir, join(stagingDir, 'whoajor.sqlite'));
  await writeFile(join(stagingDir, 'contract.json'), serializeContract());
  const manifest = JSON.parse(await readFile(join(stagingDir, 'manifest.json'), 'utf8'));
  const input = {
    snapshotName: basename(rawDir),
    date: '2026-08-30',
    rawPath: rawCitationPath(rawDir),
    sourceUrl: 'https://fixture.whoajor.test',
    sourceRange: {
      minDate: '2026-08-01',
      maxDate: '2026-08-29',
      artifact: manifest.requests.find((entry) => (
        entry.path === '/api/meta' && entry.boundaryRole === 'start'
      )).blob,
    },
    report,
    database,
  };
  await writeFile(join(stagingDir, 'source-summary.md'), renderSourceSummary(input));
  return { manifest, report, database };
}

async function buildReadyFixture(prefix = 'whoajor-ready-') {
  const { stagingDir } = await buildCollectedFixture(prefix);
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-raw-parent-'));
  const rawDir = join(rawParent, '2026-08-30-full-snapshot');
  const artifacts = await writeReadyArtifacts(stagingDir, rawDir);
  return { stagingDir, rawDir, ...artifacts };
}

test('contract.json сериализует весь CONTRACT, fixed queries, pagination и primary-key logic', () => {
  const serialized = contractDocument();

  assert.equal(serialized.version, CONTRACT.version);
  assert.deepEqual(Object.keys(serialized.endpoints).sort(), Object.keys(CONTRACT.endpoints).sort());
  assert.deepEqual(serialized.endpoints.playerWeaponsByDay.fixedQuery, { by: 'day' });
  assert.equal(serialized.endpoints.matches.limitParam, 'limit');
  assert.equal(serialized.endpoints.matches.offsetParam, 'offset');
  assert.deepEqual(serialized.endpoints.weaponSplits.required, CONTRACT.endpoints.weaponSplits.required);
  assert.match(serialized.endpoints.matches.primaryKey.functionSource, /row\.id/);
  assert.match(serialized.entities.playerRound.primaryKey.functionSource, /context\.matchId/);
});

test('publishSnapshot делает проверенный rename и сохраняет все обязательные артефакты', async () => {
  const { stagingDir, rawDir, manifest } = await buildReadyFixture();

  const published = await publishSnapshot(stagingDir, rawDir);

  assert.equal(published, rawDir);
  assert.equal(await exists(stagingDir), false);
  for (const artifact of [
    'manifest.json', 'validation-report.json', 'contract.json', 'whoajor.sqlite', 'source-summary.md',
  ]) assert.equal(await exists(join(rawDir, artifact)), true, artifact);
  const db = new Database(join(rawDir, 'whoajor.sqlite'), { readonly: true });
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare('select root_hash from snapshots').get().root_hash, manifest.rootHash);
  db.close();
});

test('publishSnapshot не перезаписывает существующий raw target и сохраняет его bytes', async () => {
  const { stagingDir, rawDir } = await buildReadyFixture('whoajor-existing-target-');
  await writeFile(rawDir, 'immutable-existing-target');

  await assert.rejects(publishSnapshot(stagingDir, rawDir), /already exists/i);

  assert.equal(await readFile(rawDir, 'utf8'), 'immutable-existing-target');
  assert.equal(await exists(stagingDir), true);
});

test('publishSnapshot блокирует incomplete report, errors и stale report root', async () => {
  for (const mutate of [
    (report) => { report.status = 'incomplete'; },
    (report) => { report.errors.push({ code: 'TEST', location: 'test', message: 'blocked' }); },
    (report) => { report.rootHash = '0'.repeat(64); },
  ]) {
    const { stagingDir, rawDir } = await buildReadyFixture('whoajor-bad-report-');
    const reportPath = join(stagingDir, 'validation-report.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    mutate(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    await assert.rejects(publishSnapshot(stagingDir, rawDir), /complete|errors|root/i);
    assert.equal(await exists(rawDir), false);
    assert.equal(await exists(stagingDir), true);
  }
});

test('publishSnapshot блокирует missing report, manifest, DB, summary, contract и response blob', async () => {
  for (const missing of [
    'manifest.json', 'validation-report.json', 'whoajor.sqlite', 'source-summary.md',
    'contract.json', 'response-blob',
  ]) {
    const { stagingDir, rawDir, manifest } = await buildReadyFixture(`whoajor-missing-${missing}-`);
    const path = missing === 'response-blob'
      ? join(stagingDir, manifest.requests[0].blob)
      : join(stagingDir, missing);
    await rm(path);

    await assert.rejects(publishSnapshot(stagingDir, rawDir), /missing|cannot|manifest/i, missing);
    assert.equal(await exists(rawDir), false);
    assert.equal(await exists(stagingDir), true);
  }
});

test('publishSnapshot блокирует stale summary, contract и manifest status', async () => {
  for (const mutation of ['summary', 'contract', 'manifest-status']) {
    const { stagingDir, rawDir } = await buildReadyFixture(`whoajor-stale-${mutation}-`);
    if (mutation === 'summary') {
      const path = join(stagingDir, 'source-summary.md');
      await writeFile(path, `${await readFile(path, 'utf8')}stale\n`);
    } else if (mutation === 'contract') {
      const path = join(stagingDir, 'contract.json');
      const contract = JSON.parse(await readFile(path, 'utf8'));
      contract.version = 'stale';
      await writeFile(path, `${JSON.stringify(contract)}\n`);
    } else {
      const path = join(stagingDir, 'manifest.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      manifest.status = 'incomplete';
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    await assert.rejects(publishSnapshot(stagingDir, rawDir), /summary|contract|status/i);
    assert.equal(await exists(rawDir), false);
    assert.equal(await exists(stagingDir), true);
  }
});

test('publishSnapshot повторно проверяет SQLite integrity, FK и snapshot root', async () => {
  for (const mutation of ['fk', 'root', 'corrupt']) {
    const { stagingDir, rawDir } = await buildReadyFixture(`whoajor-sqlite-${mutation}-`);
    const dbPath = join(stagingDir, 'whoajor.sqlite');
    if (mutation === 'corrupt') {
      await writeFile(dbPath, 'not sqlite');
    } else {
      const db = new Database(dbPath);
      if (mutation === 'root') db.prepare('update snapshots set root_hash = ?').run('0'.repeat(64));
      else {
        db.pragma('foreign_keys = OFF');
        db.prepare('update round_rosters set steamid = ? where rowid = (select min(rowid) from round_rosters)')
          .run('76561198999999999');
      }
      db.close();
    }

    await assert.rejects(publishSnapshot(stagingDir, rawDir), /SQLite|integrity|foreign|root/i);
    assert.equal(await exists(rawDir), false);
    assert.equal(await exists(stagingDir), true);
  }
});

test('sync выполняет полный offline-injected pipeline и публикует только после сборки', async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), 'whoajor-sync-success-root-'));
  await rm(stagingDir, { recursive: true });
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-sync-success-raw-'));
  const rawDir = join(rawParent, '2026-08-30-full-snapshot');
  const fixture = createFixtureApi({
    pageSize: 2,
    matchIds: ['match-2', 'match-1'],
    detailPlayers: ['76561198000000001', '76561198000000002'],
    roundPlayers: ['76561198000000001', '76561198000000002'],
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });

  const result = await sync({ stagingDir, rawDir, client, pageSize: 2, now: NOW });

  assert.equal(result.rawDir, rawDir);
  assert.equal(await exists(stagingDir), false);
  assert.equal(await exists(rawDir), true);
  assert.equal(JSON.parse(await readFile(join(rawDir, 'validation-report.json'))).status, 'complete');
  fixture.assertNoUnexpectedCalls();
});

test('failed database build оставляет staging и не создаёт raw', async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), 'whoajor-sync-build-fail-root-'));
  await rm(stagingDir, { recursive: true });
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-sync-build-fail-raw-'));
  const rawDir = join(rawParent, '2026-08-30-full-snapshot');
  const fixture = createFixtureApi({
    pageSize: 2,
    detailPlayers: ['76561198000000001', '76561198000000002'],
    roundPlayers: ['76561198000000001', '76561198000000002'],
  });
  const client = createHttpClient({
    baseUrl: fixture.baseUrl,
    fetchImpl: fixture.fetch,
    delayMs: 0,
    maxRetries: 0,
  });

  await assert.rejects(
    sync(
      { stagingDir, rawDir, client, pageSize: 2, now: NOW },
      { buildDatabase: async () => { throw new Error('injected database failure'); } },
    ),
    /injected database failure/,
  );

  assert.equal(await exists(stagingDir), true);
  assert.equal(await exists(join(stagingDir, 'validation-report.json')), true);
  assert.equal(await exists(rawDir), false);
});

test('process CLI publish-existing revalidates offline and rebuilds missing derived artifacts', async () => {
  const { stagingDir } = await buildCollectedFixture('whoajor-publish-existing-cli-');
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-publish-existing-cli-raw-'));
  const rawDir = join(rawParent, 'arbitrary-snapshot-name');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    SYNC_CLI, '--', '--publish-existing', stagingDir, '--raw-target', rawDir,
  ], { env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' } });

  assert.equal(stderr, '');
  const output = JSON.parse(stdout.trim());
  assert.equal(output.rawDir, rawDir);
  assert.equal(await exists(stagingDir), false);
  for (const artifact of ['validation-report.json', 'whoajor.sqlite', 'source-summary.md', 'contract.json']) {
    assert.equal(await exists(join(rawDir, artifact)), true, artifact);
  }
  const contract = JSON.parse(await readFile(join(rawDir, 'contract.json'), 'utf8'));
  assert.deepEqual(Object.keys(contract.endpoints).sort(), Object.keys(CONTRACT.endpoints).sort());
  assert.match(contract.endpoints.weaponDetail.primaryKey.functionSource, /context\.weapon/);
  assert.match(await readFile(join(rawDir, 'source-summary.md'), 'utf8'), /arbitrary-snapshot-name/);
});

test('summarize.mjs process CLI атомарно пересоздаёт summary без сети', async () => {
  const { stagingDir } = await buildCollectedFixture('whoajor-summarize-cli-');
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-summarize-cli-raw-'));
  const rawDir = join(rawParent, 'summary-process-target');
  await writeReadyArtifacts(stagingDir, rawDir);
  const output = join(stagingDir, 'process-summary.md');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    SUMMARIZE_CLI, '--', stagingDir, rawDir, output,
  ]);

  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).output, output);
  const summary = await readFile(output, 'utf8');
  assert.match(summary, /^---\ntype: source-summary/m);
  assert.match(summary, /summary-process-target/);
  assert.ok((await readdir(stagingDir)).every((name) => !name.startsWith('process-summary.md.tmp-')));
});

test('publish-existing не обращается к сети', async () => {
  const { stagingDir } = await buildCollectedFixture('whoajor-publish-offline-');
  const rawParent = await mkdtemp(join(tmpdir(), 'whoajor-publish-offline-raw-'));
  const rawDir = join(rawParent, 'offline-snapshot');

  await sync(
    { publishExisting: stagingDir, rawDir },
    { collectSnapshot: async () => { throw new Error('network collector must not run'); } },
  );

  assert.equal(await exists(rawDir), true);
});

test('CLI strips literal --, принимает normal options и generic basename без hardcoded date', () => {
  assert.deepEqual(parseSyncCliArgs([
    '--', '--output', '.context/whoajor-staging/2031-01-02-full',
    '--base-url', 'https://fixture.whoajor.test', '--delay-ms', '0', '--page-size', '2',
    '--resume', '--raw-target', '/tmp/explicit-target',
  ]), {
    baseUrl: 'https://fixture.whoajor.test',
    delayMs: 0,
    pageSize: 2,
    resume: true,
    stagingDir: '.context/whoajor-staging/2031-01-02-full',
    rawDir: '/tmp/explicit-target',
  });
  assert.equal(
    basename(defaultRawTarget('.context/whoajor-staging/2031-01-02-full')),
    '2031-01-02-full-snapshot',
  );
  assert.equal(parseSyncCliArgs([
    '--publish-existing', '/tmp/staging', '/tmp/positional-raw',
  ]).rawDir, '/tmp/positional-raw');
});
