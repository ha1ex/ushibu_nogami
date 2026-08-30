import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  constants as zlibConstants, createGunzip, createGzip,
} from 'node:zlib';

export const DATABASE_GZIP_THRESHOLD_BYTES = 90 * 1024 * 1024;
export const SQLITE_ARTIFACT = 'whoajor.sqlite';
export const SQLITE_GZIP_ARTIFACT = 'whoajor.sqlite.gz';

async function fileMetadata(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() ? metadata : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function resolveDatabaseArtifact(snapshotDir) {
  const candidates = await Promise.all(
    [SQLITE_ARTIFACT, SQLITE_GZIP_ARTIFACT].map(async (artifact) => ({
      artifact,
      metadata: await fileMetadata(join(snapshotDir, artifact)),
    })),
  );
  const present = candidates.filter(({ metadata }) => metadata);
  if (present.length === 0) {
    throw new Error(`required database artifact ${SQLITE_ARTIFACT} or ${SQLITE_GZIP_ARTIFACT} is missing`);
  }
  if (present.length !== 1) {
    throw new Error(`snapshot must contain exactly one database artifact: ${SQLITE_ARTIFACT} or ${SQLITE_GZIP_ARTIFACT}`);
  }
  return {
    artifact: present[0].artifact,
    path: join(snapshotDir, present[0].artifact),
    size: present[0].metadata.size,
  };
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function hashingTransform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

async function assertCanonicalGzip(gzipPath, sqlitePath, snapshotDir) {
  const canonical = join(
    snapshotDir,
    `.whoajor.sqlite.canonical-${process.pid}-${randomUUID()}.gz`,
  );
  try {
    await writeDeterministicGzip(sqlitePath, canonical);
    const [persistedMetadata, canonicalMetadata, persistedSha256, canonicalSha256] = await Promise.all([
      stat(gzipPath),
      stat(canonical),
      sha256File(gzipPath),
      sha256File(canonical),
    ]);
    if (
      persistedMetadata.size !== canonicalMetadata.size
        || persistedSha256 !== canonicalSha256
    ) {
      throw new Error('persisted SQLite gzip is not canonical deterministic gzip');
    }
    return persistedSha256;
  } finally {
    await rm(canonical, { force: true });
  }
}

async function inspectGzipArtifact(gzipPath, snapshotDir, inspect) {
  const temporary = join(
    snapshotDir,
    `.whoajor.sqlite.gunzip-${process.pid}-${randomUUID()}.sqlite`,
  );
  const hash = createHash('sha256');
  try {
    await pipeline(
      createReadStream(gzipPath),
      createGunzip(),
      hashingTransform(hash),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    const artifactSha256 = await assertCanonicalGzip(gzipPath, temporary, snapshotDir);
    const result = await inspect(temporary);
    return { artifactSha256, result, decompressedSha256: hash.digest('hex') };
  } catch (error) {
    throw new Error(`gzip SQLite verification failed: ${error.message}`, { cause: error });
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function inspectDatabaseArtifact(snapshotDir, inspect) {
  if (typeof inspect !== 'function') throw new TypeError('inspect callback is required');
  const selected = await resolveDatabaseArtifact(snapshotDir);
  if (selected.artifact === SQLITE_ARTIFACT) {
    const [result, decompressedSha256] = await Promise.all([
      inspect(selected.path),
      sha256File(selected.path),
    ]);
    return {
      ...result,
      artifact: selected.artifact,
      artifactSha256: decompressedSha256,
      decompressedSha256,
    };
  }
  const checked = await inspectGzipArtifact(selected.path, snapshotDir, inspect);
  return {
    ...checked.result,
    artifact: selected.artifact,
    artifactSha256: checked.artifactSha256,
    decompressedSha256: checked.decompressedSha256,
  };
}

async function writeDeterministicGzip(source, target) {
  await pipeline(
    createReadStream(source),
    createGzip({
      level: zlibConstants.Z_BEST_COMPRESSION,
      mtime: 0,
    }),
    createWriteStream(target, { flags: 'wx', mode: 0o644 }),
  );
}

export async function finalizeDatabaseArtifact(
  snapshotDir,
  inspect,
  { thresholdBytes = DATABASE_GZIP_THRESHOLD_BYTES } = {},
) {
  if (!Number.isSafeInteger(thresholdBytes) || thresholdBytes < 0) {
    throw new TypeError('database gzip thresholdBytes must be a non-negative safe integer');
  }
  const sqlitePath = join(snapshotDir, SQLITE_ARTIFACT);
  const gzipPath = join(snapshotDir, SQLITE_GZIP_ARTIFACT);
  const metadata = await fileMetadata(sqlitePath);
  if (!metadata) throw new Error(`database build did not create ${SQLITE_ARTIFACT}`);

  if (metadata.size < thresholdBytes) {
    await rm(gzipPath, { force: true });
    return inspectDatabaseArtifact(snapshotDir, inspect);
  }

  const temporaryGzip = `${gzipPath}.tmp-${process.pid}-${randomUUID()}`;
  const sourceSha256 = await sha256File(sqlitePath);
  try {
    await writeDeterministicGzip(sqlitePath, temporaryGzip);
    const checked = await inspectGzipArtifact(temporaryGzip, snapshotDir, inspect);
    if (checked.decompressedSha256 !== sourceSha256) {
      throw new Error('gzip round-trip changed SQLite bytes');
    }
    await rm(gzipPath, { force: true });
    await rename(temporaryGzip, gzipPath);
    await rm(sqlitePath);
    return {
      ...checked.result,
      artifact: SQLITE_GZIP_ARTIFACT,
      artifactSha256: checked.artifactSha256,
      decompressedSha256: checked.decompressedSha256,
    };
  } finally {
    await rm(temporaryGzip, { force: true });
  }
}
