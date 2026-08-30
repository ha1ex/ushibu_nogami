import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp, readFile, readdir, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  finalizeDatabaseArtifact, inspectDatabaseArtifact,
} from '../lib/database-artifact.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactDatabaseBytes() {
  const rows = [];
  for (let index = 0; index < 16_384; index += 1) {
    rows.push(`row=${index};bucket=${index % 97};payload=${'abcdef0123456789'.repeat(index % 13)}\n`);
  }
  return Buffer.from(rows.join(''));
}

async function temporaryArtifacts(dir) {
  return (await readdir(dir)).filter((name) => (
    name.includes('.whoajor.sqlite.gunzip-') || name.includes('.whoajor.sqlite.canonical-')
  ));
}

async function canonicalFixture(prefix) {
  const snapshotDir = await mkdtemp(join(tmpdir(), prefix));
  const source = exactDatabaseBytes();
  await writeFile(join(snapshotDir, 'whoajor.sqlite'), source);
  await finalizeDatabaseArtifact(
    snapshotDir,
    async (path) => {
      assert.equal(sha256(await readFile(path)), sha256(source));
      return { inspected: true };
    },
    { thresholdBytes: 0 },
  );
  return { snapshotDir, source, gzipPath: join(snapshotDir, 'whoajor.sqlite.gz') };
}

test('канонический deterministic gzip проходит проверку без временных файлов', async () => {
  const { gzipPath, snapshotDir, source } = await canonicalFixture('whoajor-canonical-gzip-');

  const result = await inspectDatabaseArtifact(snapshotDir, async (path) => ({
    exactSha256: sha256(await readFile(path)),
  }));

  assert.equal(result.artifact, 'whoajor.sqlite.gz');
  assert.equal(result.artifactSha256, sha256(await readFile(gzipPath)));
  assert.equal(result.decompressedSha256, sha256(source));
  assert.equal(result.exactSha256, sha256(source));
  assert.deepEqual(await temporaryArtifacts(snapshotDir), []);
});

test('изменённый MTIME отклоняется как неканонический gzip и очищает temp', async () => {
  const { snapshotDir, gzipPath } = await canonicalFixture('whoajor-mtime-gzip-');
  const tampered = await readFile(gzipPath);
  tampered.writeUInt32LE(1, 4);
  await writeFile(gzipPath, tampered);

  await assert.rejects(
    inspectDatabaseArtifact(snapshotDir, async () => ({ inspected: true })),
    /canonical deterministic gzip/i,
  );
  assert.deepEqual(await temporaryArtifacts(snapshotDir), []);
});

test('эквивалентный gzip с другим deflate отклоняется и очищает temp', async () => {
  const { snapshotDir, source, gzipPath } = await canonicalFixture('whoajor-alternate-gzip-');
  const canonical = await readFile(gzipPath);
  const alternate = gzipSync(source, { level: 1, mtime: 0 });
  assert.equal(sha256(gunzipSync(alternate)), sha256(source));
  assert.notEqual(sha256(alternate), sha256(canonical));
  await writeFile(gzipPath, alternate);

  await assert.rejects(
    inspectDatabaseArtifact(snapshotDir, async () => ({ inspected: true })),
    /canonical deterministic gzip/i,
  );
  assert.deepEqual(await temporaryArtifacts(snapshotDir), []);
});
