import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalStringify, requestKey, sha256Hex } from './canonical-json.mjs';

const MANIFEST_FILE = 'manifest.json';
const RESPONSES_DIR = 'responses';
const REQUEST_FIELDS = [
  'key', 'path', 'query', 'boundaryRole', 'url', 'status', 'contentType', 'contentLength',
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
  if (![null, 'start', 'end'].includes(entry.boundaryRole)) {
    throw resumeError(`request entry has an invalid boundary role for ${entry.key}`);
  }
}

function isBoundaryRequest(entry) {
  if (entry.path === '/api/meta' && Object.keys(entry.query).length === 0) return true;
  return entry.path === '/api/matches'
    && Number.isInteger(Number(entry.query.limit))
    && Number(entry.query.limit) > 0
    && Number(entry.query.offset) === 0;
}

function validateObservationGroups(manifest) {
  const groups = new Map();
  const metaBoundaryKeys = new Set();
  const matchesHeadBoundaryKeys = new Set();
  manifest.requests.forEach((entry, index) => {
    const rows = groups.get(entry.key) ?? [];
    rows.push({ entry, index });
    groups.set(entry.key, rows);
  });
  for (const [key, rows] of groups) {
    if (isBoundaryRequest(rows[0].entry)) {
      if (rows[0].entry.path === '/api/meta') metaBoundaryKeys.add(key);
      else matchesHeadBoundaryKeys.add(key);
    }
    const boundaryRows = rows.filter(({ entry }) => entry.boundaryRole !== null);
    if (boundaryRows.length === 0) {
      if (rows.length > 1) throw resumeError(`ordinary request ${key} is duplicated`);
      continue;
    }
    if (boundaryRows.length !== rows.length || !rows.every(({ entry }) => isBoundaryRequest(entry))) {
      throw resumeError(`boundary observations are invalid for ${key}`);
    }
    const starts = rows.filter(({ entry }) => entry.boundaryRole === 'start');
    const ends = rows.filter(({ entry }) => entry.boundaryRole === 'end');
    if (starts.length !== 1 || ends.length > 1 || (ends.length === 1 && starts[0].index > ends[0].index)) {
      throw resumeError(`boundary observation sequence is invalid for ${key}`);
    }
  }
  if (metaBoundaryKeys.size > 1) {
    throw resumeError('multiple meta boundary keys violate boundary cardinality');
  }
  if (matchesHeadBoundaryKeys.size > 1) {
    throw resumeError('multiple matches-head boundary keys violate boundary cardinality');
  }
}

export function computeRootHash(requests) {
  const lines = requests
    .map(({ key, bodySha256, boundaryRole = null }) => (
      `${key}\0${bodySha256}\0${boundaryRole ?? ''}\n`
    ))
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
    const observation = `${entry.key}\0${entry.bodySha256}\0${entry.boundaryRole ?? ''}`;
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
  validateObservationGroups(manifest);
  if (manifest.rootHash !== computeRootHash(manifest.requests)) {
    throw resumeError('manifest root hash does not match request list');
  }
  return { root, manifestPath, manifest };
}

export async function storeResponse(
  snapshot,
  responseRecord,
  { allowConflict = false, boundaryRole = null } = {},
) {
  if (![null, 'start', 'end'].includes(boundaryRole)) {
    throw new TypeError('boundaryRole must be start, end, or null');
  }
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
    boundaryRole,
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
    stored.key === key
      && stored.bodySha256 === bodySha256
      && stored.boundaryRole === boundaryRole
  ));
  if (existing) {
    await readValidBlob(snapshot.root, existing);
    if (existing.canonicalSha256 === null) parseJson(exactBody);
    return existing;
  }
  const sameKey = snapshot.manifest.requests.filter((stored) => stored.key === key);
  if (boundaryRole !== null) {
    if (!isBoundaryRequest(entry)) throw new Error(`request ${key} cannot be a boundary observation`);
    if (sameKey.some((stored) => stored.boundaryRole === boundaryRole)) {
      throw new Error(`request ${key} already has boundary role ${boundaryRole}`);
    }
    if (sameKey.some((stored) => stored.boundaryRole === null)) {
      throw new Error(`request ${key} mixes ordinary and boundary observations`);
    }
    if (boundaryRole === 'end' && (
      !allowConflict || !sameKey.some((stored) => stored.boundaryRole === 'start')
    )) {
      throw new Error(`request ${key} boundary end requires an explicit start`);
    }
    if (boundaryRole === 'start' && sameKey.length > 0) {
      throw new Error(`request ${key} boundary start must be the first observation`);
    }
  } else if (sameKey.length > 0) {
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
