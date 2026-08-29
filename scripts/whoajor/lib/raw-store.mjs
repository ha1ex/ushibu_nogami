import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalStringify, requestKey, sha256Hex } from './canonical-json.mjs';

const MANIFEST_FILE = 'manifest.json';
const RESPONSES_DIR = 'responses';
const REQUEST_FIELDS = [
  'key', 'path', 'query', 'url', 'status', 'contentType', 'contentLength',
  'observedHeaders', 'fetchedAt', 'durationMs', 'bodyBytes', 'bodySha256',
  'canonicalSha256', 'itemCount', 'reportedTotal', 'blob',
];
let temporaryFileSequence = 0;

function resumeError(message) {
  return new Error(`snapshot cannot resume: ${message}`);
}

function bodyBuffer(body) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) return Buffer.from(body);
  throw new TypeError('response body must be a string or Buffer');
}

function copyHeaders(headers = {}) {
  if (headers && typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers));
}

function headerValue(headers, name) {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry ? entry[1] : null;
}

function exactRequestFields(entry) {
  const fields = Object.keys(entry).sort();
  const expected = [...REQUEST_FIELDS].sort();
  return fields.length === expected.length && fields.every((field, index) => field === expected[index]);
}

function deriveCounts(payload, responseRecord) {
  const itemCount = responseRecord.itemCount ?? (
    Array.isArray(payload)
      ? payload.length
      : Object.values(payload ?? {}).find(Array.isArray)?.length ?? null
  );
  const reportedTotal = responseRecord.reportedTotal ?? (
    typeof payload?.total === 'number' ? payload.total : null
  );
  return { itemCount, reportedTotal };
}

function parseJson(body) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new Error(`response body is not valid JSON: ${error.message}`, { cause: error });
  }
}

async function writeAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileSequence += 1}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
}

async function readValidBlob(root, entry, { resume = false } = {}) {
  const fail = resume ? resumeError : (message) => new Error(message);
  if (!/^[a-f0-9]{64}$/.test(entry.bodySha256)) {
    throw fail(`body blob has invalid SHA-256 for ${entry.key}`);
  }
  if (entry.blob !== join(RESPONSES_DIR, `${entry.bodySha256}.json`)) {
    throw fail(`body blob path does not match SHA-256 for ${entry.key}`);
  }

  let body;
  try {
    body = await readFile(join(root, entry.blob));
  } catch (error) {
    throw fail(`body blob is missing for ${entry.key}`);
  }
  if (body.byteLength !== entry.bodyBytes || sha256Hex(body) !== entry.bodySha256) {
    throw fail(`body blob integrity check failed for ${entry.key}`);
  }
  return body;
}

function validateManifestEntry(entry) {
  if (!entry || typeof entry !== 'object' || !exactRequestFields(entry)) {
    throw resumeError('request entry has an unexpected shape');
  }
  if (!entry.path || !entry.query || typeof entry.query !== 'object') {
    throw resumeError('request entry has an invalid path or query');
  }
  if (entry.key !== requestKey(entry.path, entry.query)) {
    throw resumeError(`request key does not match path and query for ${entry.key}`);
  }
}

export function computeRootHash(requests) {
  const lines = requests
    .map(({ key, bodySha256 }) => `${key}\0${bodySha256}\n`)
    .sort()
    .join('');
  return sha256Hex(lines);
}

export async function createSnapshot(root, metadata = {}) {
  const manifestPath = join(root, MANIFEST_FILE);
  try {
    await stat(manifestPath);
    throw new Error(`snapshot manifest already exists at ${manifestPath}; use loadSnapshot to resume`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const snapshot = {
    root,
    manifestPath,
    manifest: {
      ...metadata,
      status: 'staging',
      requests: [],
      rootHash: computeRootHash([]),
    },
  };
  await mkdir(join(root, RESPONSES_DIR), { recursive: true });
  await writeAtomically(manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
  return snapshot;
}

export async function loadSnapshot(root) {
  const manifestPath = join(root, MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw resumeError(`manifest cannot be read: ${error.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.requests)) {
    throw resumeError('manifest has no request list');
  }

  const observations = new Set();
  for (const entry of manifest.requests) {
    validateManifestEntry(entry);
    const observation = `${entry.key}\0${entry.bodySha256}`;
    if (observations.has(observation)) {
      throw resumeError(`manifest repeats response ${entry.key} with body ${entry.bodySha256}`);
    }
    observations.add(observation);
    const body = await readValidBlob(root, entry, { resume: true });
    if (entry.canonicalSha256 === null) {
      throw resumeError(`canonical JSON hash is unavailable for ${entry.key}`);
    }
    const canonicalSha256 = sha256Hex(canonicalStringify(parseJson(body)));
    if (canonicalSha256 !== entry.canonicalSha256) {
      throw resumeError(`canonical JSON hash does not match body blob for ${entry.key}`);
    }
  }
  if (manifest.rootHash !== computeRootHash(manifest.requests)) {
    throw resumeError('manifest root hash does not match request list');
  }
  return { root, manifestPath, manifest };
}

export async function storeResponse(snapshot, responseRecord, { allowConflict = false } = {}) {
  const { path, query = {}, body, headers, ...rest } = responseRecord;
  const key = requestKey(path, query);
  const exactBody = bodyBuffer(body);
  const bodySha256 = sha256Hex(exactBody);
  const observedHeaders = copyHeaders(headers);
  const blob = join(RESPONSES_DIR, `${bodySha256}.json`);
  const entry = {
    key,
    path,
    query: { ...query },
    url: rest.url ?? null,
    status: rest.status ?? null,
    contentType: headerValue(observedHeaders, 'content-type'),
    contentLength: headerValue(observedHeaders, 'content-length'),
    observedHeaders,
    fetchedAt: rest.fetchedAt ?? new Date().toISOString(),
    durationMs: rest.durationMs ?? null,
    bodyBytes: exactBody.byteLength,
    bodySha256,
    canonicalSha256: null,
    itemCount: null,
    reportedTotal: null,
    blob,
  };

  const blobPath = join(snapshot.root, blob);
  try {
    await readValidBlob(snapshot.root, entry);
  } catch (error) {
    if (error.code !== 'ENOENT' && !/body blob is missing/.test(error.message)) throw error;
    await writeAtomically(blobPath, exactBody);
  }

  const existing = snapshot.manifest.requests.find((stored) => (
    stored.key === key && stored.bodySha256 === bodySha256
  ));
  if (existing) {
    await readValidBlob(snapshot.root, existing);
    if (existing.canonicalSha256 === null) parseJson(exactBody);
    return existing;
  }
  if (!allowConflict && snapshot.manifest.requests.some((stored) => stored.key === key)) {
    throw new Error(`request ${key} is already stored with a different body`);
  }

  let payload;
  try {
    payload = parseJson(exactBody);
  } catch (error) {
    snapshot.manifest.requests.push(entry);
    snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
    await writeAtomically(snapshot.manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
    throw error;
  }
  const { itemCount, reportedTotal } = deriveCounts(payload, responseRecord);
  entry.canonicalSha256 = sha256Hex(canonicalStringify(payload));
  entry.itemCount = itemCount;
  entry.reportedTotal = reportedTotal;

  snapshot.manifest.requests.push(entry);
  snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
  await writeAtomically(snapshot.manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
  return entry;
}

export async function finalizeManifest(snapshot, status) {
  snapshot.manifest.status = status;
  snapshot.manifest.rootHash = computeRootHash(snapshot.manifest.requests);
  await writeAtomically(snapshot.manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
  return snapshot.manifest;
}
