import {
  lstat, mkdir, readFile, readdir, writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CONTRACT } from './contract.mjs';
import { canonicalStringify, sha256Hex } from './canonical-json.mjs';
import { serializeContract } from '../sync.mjs';

export const SPA_SURFACE_AUDIT_SCHEMA_VERSION = 1;
export const SPA_SURFACE_SCOPE = 'root-and-recursive-same-origin-javascript';
export const DEFAULT_SPA_AUDIT_USER_AGENT = 'ushibu-nogami-whoajor-spa-audit/1.0';

const HTML_CONTENT_TYPE = /^text\/html(?:\s*;|\s*$)/i;
const JAVASCRIPT_CONTENT_TYPE = /^(?:(?:text|application)\/javascript|application\/x-javascript)(?:\s*;|\s*$)/i;
const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_ORIGIN = 'https://stats.whoajor.com';

function canonicalBytes(value) {
  return Buffer.from(`${canonicalStringify(value)}\n`);
}

function withoutAssetRootHash(manifest) {
  const {
    assetRootHash: _assetRootHash,
    capturedAt: _capturedAt,
    report: _report,
    ...stable
  } = manifest;
  return stable;
}

export function computeSpaAssetRootHash(manifest) {
  return sha256Hex(Buffer.from(canonicalStringify(withoutAssetRootHash(manifest))));
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const expected = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === expected)?.[1] ?? null;
}

function exactIso(now, label) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must return a valid Date`);
  }
  return value.toISOString();
}

function normalizeRootUrl(value) {
  const url = new URL(value);
  url.hash = '';
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '') {
    throw new Error('rootUrl must be an HTTPS origin root without query or fragment');
  }
  return url.href;
}

function resolveSameOrigin(specifier, fromUrl, origin, label) {
  let resolved;
  try {
    resolved = new URL(specifier, fromUrl);
  } catch (error) {
    throw new Error(`${label} has an invalid URL specifier ${JSON.stringify(specifier)}`, {
      cause: error,
    });
  }
  resolved.hash = '';
  if (resolved.origin !== origin) {
    throw new Error(`${label} references cross-origin executable asset ${resolved.href}`);
  }
  if (!['http:', 'https:'].includes(resolved.protocol)) {
    throw new Error(`${label} uses unsupported executable asset protocol ${resolved.protocol}`);
  }
  return resolved.href;
}

function tagAttribute(tag, name) {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const match = tag.match(expression);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function relTokens(tag) {
  return (tagAttribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

export function extractHtmlExecutableReferences(body, documentUrl) {
  const text = Buffer.from(body).toString('utf8');
  const origin = new URL(documentUrl).origin;
  const references = [];
  const excluded = [];
  const rootScripts = [];
  const tagPattern = /<(script|link)\b[^>]*>/gi;
  for (const match of text.matchAll(tagPattern)) {
    const tagName = match[1].toLowerCase();
    const tag = match[0];
    if (tagName === 'script') {
      const src = tagAttribute(tag, 'src');
      if (!src) continue;
      const candidate = new URL(src, documentUrl);
      candidate.hash = '';
      if (candidate.origin !== origin) {
        excluded.push({
          from: documentUrl,
          url: candidate.href,
          relationship: 'html-script',
          reason: 'cross-origin executable asset is outside the authorized same-origin scope',
        });
        continue;
      }
      const url = resolveSameOrigin(src, documentUrl, origin, 'HTML script');
      rootScripts.push(url);
      references.push({ from: documentUrl, kind: 'html-script', to: url, offset: match.index });
      continue;
    }
    const href = tagAttribute(tag, 'href');
    if (!href) continue;
    const rel = relTokens(tag);
    if (rel.includes('modulepreload')) {
      const url = resolveSameOrigin(href, documentUrl, origin, 'HTML modulepreload');
      references.push({
        from: documentUrl,
        kind: 'html-modulepreload',
        to: url,
        offset: match.index,
      });
    } else if (rel.some((token) => ['stylesheet', 'icon', 'preload'].includes(token))) {
      const url = new URL(href, documentUrl);
      url.hash = '';
      if (url.origin === origin) {
        excluded.push({
          from: documentUrl,
          url: url.href,
          relationship: `html-${rel.join('+')}`,
          reason: 'non-executable asset cannot define the SPA API request surface',
        });
      }
    }
  }

  const inlinePattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of text.matchAll(inlinePattern)) {
    if (tagAttribute(match[0], 'src')) continue;
    const type = (tagAttribute(match[0], 'type') ?? '').toLowerCase();
    const executable = ['', 'module', 'text/javascript', 'application/javascript'].includes(type);
    if (executable && match[2].trim() !== '') {
      throw new Error('inline executable script is unsupported by the exact JavaScript asset graph');
    }
  }

  references.sort((left, right) => left.offset - right.offset);
  return {
    rootScripts,
    edges: references.map(({ offset: _offset, ...edge }) => edge),
    excluded,
  };
}

export function extractJavaScriptImports(body, assetUrl) {
  const text = Buffer.from(body).toString('utf8');
  const origin = new URL(assetUrl).origin;
  const candidates = [];
  const staticPattern = /\b(?:import|export)\s*(?!\()\s*(?:[^"'`;]*?\bfrom\s*)?(["'])([^"']+)\1/g;
  const dynamicPattern = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of text.matchAll(staticPattern)) {
    candidates.push({ kind: 'static-import', specifier: match[2], offset: match.index });
  }
  for (const match of text.matchAll(dynamicPattern)) {
    candidates.push({ kind: 'dynamic-import', specifier: match[2], offset: match.index });
  }
  candidates.sort((left, right) => left.offset - right.offset);
  return candidates.map(({ kind, specifier }) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !/^https?:\/\//i.test(specifier)) {
      throw new Error(`JavaScript asset ${assetUrl} has unresolved bare import ${specifier}`);
    }
    return {
      from: assetUrl,
      kind,
      to: resolveSameOrigin(specifier, assetUrl, origin, 'JavaScript import'),
    };
  });
}

function assertContentType(kind, contentType, url) {
  if (typeof contentType !== 'string') throw new Error(`${url} has no content-type`);
  const valid = kind === 'html'
    ? HTML_CONTENT_TYPE.test(contentType)
    : JAVASCRIPT_CONTENT_TYPE.test(contentType);
  if (!valid) throw new Error(`${url} has unexpected ${kind} content-type ${contentType}`);
}

async function writeContentAddressedBlob(directory, sha256, kind, body) {
  const extension = kind === 'html' ? 'html' : 'js';
  const relative = `blobs/${sha256}.${extension}`;
  const path = join(directory, relative);
  try {
    await writeFile(path, body, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    if (!existing.equals(body)) throw new Error(`content-address collision at ${relative}`);
  }
  return relative;
}

function validateCaptureOptions({ outputDir, auditId, delayMs, userAgent }) {
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    throw new TypeError('outputDir must be a non-empty string');
  }
  if (typeof auditId !== 'string' || !/^\d{4}-\d{2}-\d{2}-spa-surface-audit$/.test(auditId)) {
    throw new Error('auditId must use YYYY-MM-DD-spa-surface-audit');
  }
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a non-negative integer');
  }
  if (typeof userAgent !== 'string' || userAgent.trim().length < 8) {
    throw new Error('userAgent must be a descriptive non-empty value');
  }
}

export async function captureSpaSurfaceAssets({
  outputDir,
  rootUrl = `${EXPECTED_ORIGIN}/`,
  auditId = basename(outputDir ?? ''),
  delayMs = 250,
  userAgent = DEFAULT_SPA_AUDIT_USER_AGENT,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
} = {}) {
  validateCaptureOptions({ outputDir, auditId, delayMs, userAgent });
  const normalizedRootUrl = normalizeRootUrl(rootUrl);
  const origin = new URL(normalizedRootUrl).origin;
  const startedAt = exactIso(now, 'now');
  await mkdir(outputDir);
  await mkdir(join(outputDir, 'blobs'));

  const queue = [{ url: normalizedRootUrl, kind: 'html' }];
  const queued = new Set([normalizedRootUrl]);
  const assets = [];
  const edges = [];
  const excludedReferences = [];
  let rootScripts = [];

  for (let index = 0; index < queue.length; index += 1) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    const expected = queue[index];
    const response = await fetchImpl(expected.url, {
      method: 'GET',
      headers: {
        accept: expected.kind === 'html'
          ? 'text/html,application/xhtml+xml'
          : 'text/javascript,application/javascript,*/*;q=0.1',
        'user-agent': userAgent,
      },
    });
    if (!response || response.status !== 200) {
      throw new Error(`GET ${expected.url} returned status ${response?.status ?? 'unavailable'}`);
    }
    const finalUrl = response.url ? new URL(response.url).href : expected.url;
    if (finalUrl !== expected.url) {
      throw new Error(`GET ${expected.url} redirected to ${finalUrl}; redirects are outside exact graph`);
    }
    if (new URL(finalUrl).origin !== origin) {
      throw new Error(`GET ${expected.url} escaped the same-origin audit scope`);
    }
    const contentType = headerValue(response.headers, 'content-type');
    assertContentType(expected.kind, contentType, expected.url);
    const body = Buffer.from(await response.arrayBuffer());
    const sha256 = sha256Hex(body);
    const blob = await writeContentAddressedBlob(outputDir, sha256, expected.kind, body);
    assets.push({
      sequence: index + 1,
      url: expected.url,
      finalUrl,
      status: response.status,
      contentType,
      bytes: body.byteLength,
      sha256,
      kind: expected.kind,
      blob,
    });

    let discovered;
    if (expected.kind === 'html') {
      discovered = extractHtmlExecutableReferences(body, expected.url);
      rootScripts = discovered.rootScripts;
      excludedReferences.push(...discovered.excluded);
    } else {
      discovered = { edges: extractJavaScriptImports(body, expected.url) };
    }
    edges.push(...discovered.edges);
    for (const edge of discovered.edges) {
      if (!queued.has(edge.to)) {
        queued.add(edge.to);
        queue.push({ url: edge.to, kind: 'javascript' });
      }
    }
  }

  const manifest = {
    schemaVersion: SPA_SURFACE_AUDIT_SCHEMA_VERSION,
    auditId,
    origin,
    rootUrl: normalizedRootUrl,
    capturedAt: {
      startedAt,
      finishedAt: exactIso(now, 'now'),
    },
    policy: {
      method: 'GET',
      bodyReadMethod: 'Response.arrayBuffer',
      sequential: true,
      delayMs,
      userAgent,
      scope: SPA_SURFACE_SCOPE,
      requestCount: assets.length,
      uniqueResourceCount: assets.length,
      duplicateRequestCount: 0,
      apiRequestCount: assets.filter(({ url }) => new URL(url).pathname.startsWith('/api/')).length,
      postRequestCount: 0,
      crossOriginRequestCount: 0,
    },
    requestOrder: assets.map(({ url }) => url),
    requestUserAgents: assets.map(() => userAgent),
    enforcedDelayBeforeMs: assets.map((_, index) => (index === 0 ? 0 : delayMs)),
    recovery: null,
    assets,
    assetGraph: { rootScripts, edges },
    excludedReferences,
    report: null,
  };
  manifest.assetRootHash = computeSpaAssetRootHash(manifest);
  await writeFile(join(outputDir, 'manifest.json'), canonicalBytes(manifest), { flag: 'wx' });
  return manifest;
}

async function readRequired(path, label) {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`, { cause: error });
  }
}

async function assertRealDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`, { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink or special file`);
  }
}

async function assertRealRegularFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`, { cause: error });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real regular file, not a symlink or special file`);
  }
}

async function readCanonicalJson(path, label) {
  const bytes = await readRequired(path, label);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!bytes.equals(canonicalBytes(value))) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return { bytes, value };
}

export async function finalizeSpaSurfaceAudit(auditDir, report) {
  const manifestPath = join(auditDir, 'manifest.json');
  const { value: manifest } = await readCanonicalJson(manifestPath, 'manifest.json');
  if (manifest.report !== null) throw new Error('SPA surface audit is already finalized');
  if (
    !report || report.schemaVersion !== SPA_SURFACE_AUDIT_SCHEMA_VERSION
      || report.auditId !== manifest.auditId
      || report.assetRootHash !== manifest.assetRootHash
  ) throw new Error('report identity differs from captured asset manifest');
  const reportBytes = canonicalBytes(report);
  await writeFile(join(auditDir, 'report.json'), reportBytes, { flag: 'wx' });
  manifest.report = {
    path: 'report.json',
    bytes: reportBytes.byteLength,
    sha256: sha256Hex(reportBytes),
  };
  await writeFile(manifestPath, canonicalBytes(manifest));
  return manifest;
}

function assertPlainArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${nonEmpty ? 'a non-empty' : 'an'} array`);
  }
}

function assertManifestIdentity(manifest, auditDir) {
  if (manifest.schemaVersion !== SPA_SURFACE_AUDIT_SCHEMA_VERSION) {
    throw new Error('manifest schemaVersion is unsupported');
  }
  if (manifest.auditId !== basename(auditDir)) {
    throw new Error('manifest auditId differs from directory name');
  }
  if (manifest.origin !== EXPECTED_ORIGIN || manifest.rootUrl !== `${EXPECTED_ORIGIN}/`) {
    throw new Error('manifest must audit the canonical stats.whoajor.com root');
  }
  if (
    manifest.policy?.method !== 'GET'
      || manifest.policy?.bodyReadMethod !== 'Response.arrayBuffer'
      || manifest.policy?.sequential !== true
      || manifest.policy?.scope !== SPA_SURFACE_SCOPE
      || manifest.policy?.apiRequestCount !== 0
      || manifest.policy?.postRequestCount !== 0
      || manifest.policy?.crossOriginRequestCount !== 0
  ) {
    throw new Error(
      'manifest capture policy bodyReadMethod must pin Response.arrayBuffer and sequential root/assets GET-only without API calls',
    );
  }
  if (
    manifest.policy.delayMs !== null
      && (!Number.isInteger(manifest.policy.delayMs) || manifest.policy.delayMs < 0)
  ) {
    throw new Error('manifest policy delayMs is invalid');
  }
  if (
    manifest.policy.userAgent !== null
      && (typeof manifest.policy.userAgent !== 'string' || manifest.policy.userAgent.length < 8)
  ) {
    throw new Error('manifest policy userAgent is invalid');
  }
  if (
    !Number.isInteger(manifest.policy.requestCount)
      || !Number.isInteger(manifest.policy.uniqueResourceCount)
      || !Number.isInteger(manifest.policy.duplicateRequestCount)
      || manifest.policy.requestCount <= 0
      || manifest.policy.uniqueResourceCount <= 0
      || manifest.policy.duplicateRequestCount < 0
      || manifest.policy.requestCount
        !== manifest.policy.uniqueResourceCount + manifest.policy.duplicateRequestCount
  ) throw new Error('manifest request/unique/duplicate counts are inconsistent');
  if (
    !Array.isArray(manifest.requestOrder)
      || manifest.requestOrder.length !== manifest.policy.requestCount
      || manifest.requestOrder.some((url) => (
        typeof url !== 'string' || new URL(url).origin !== manifest.origin
      ))
  ) throw new Error('manifest requestOrder is incomplete or outside same-origin scope');
  if (
    !Array.isArray(manifest.requestUserAgents)
      || manifest.requestUserAgents.length !== manifest.policy.requestCount
      || manifest.requestUserAgents.some((value) => typeof value !== 'string' || value.length < 8)
  ) throw new Error('manifest per-request User-Agent evidence is incomplete');
  if (
    !Array.isArray(manifest.enforcedDelayBeforeMs)
      || manifest.enforcedDelayBeforeMs.length !== manifest.policy.requestCount
      || manifest.enforcedDelayBeforeMs.some((value) => !Number.isInteger(value) || value < 0)
  ) throw new Error('manifest per-request pre-delay evidence is incomplete');
  if (
    manifest.policy.userAgent !== null
      && manifest.requestUserAgents.some((value) => value !== manifest.policy.userAgent)
  ) throw new Error('manifest uniform User-Agent differs from per-request evidence');
  if (manifest.policy.delayMs !== null) {
    const expectedDelays = manifest.requestOrder.map((_, index) => (
      index === 0 ? 0 : manifest.policy.delayMs
    ));
    if (canonicalStringify(manifest.enforcedDelayBeforeMs) !== canonicalStringify(expectedDelays)) {
      throw new Error('manifest uniform delay differs from per-request pre-delay evidence');
    }
  }
  const assetUrls = manifest.assets?.map(({ url }) => url) ?? [];
  if (
    new Set(manifest.requestOrder).size !== manifest.policy.uniqueResourceCount
      || canonicalStringify([...new Set(manifest.requestOrder)].sort())
        !== canonicalStringify([...assetUrls].sort())
  ) throw new Error('manifest requestOrder does not cover the exact unique asset inventory');
  if (manifest.policy.duplicateRequestCount === 0) {
    if (manifest.recovery !== null) throw new Error('manifest has recovery metadata without a duplicate GET');
  } else {
    const recovery = manifest.recovery;
    if (
      manifest.policy.duplicateRequestCount !== 1
        || !recovery
        || recovery.sequence !== manifest.policy.requestCount
        || manifest.requestOrder[recovery.sequence - 1] !== recovery.url
        || recovery.initialAndRecoveryShaMatch !== true
        || typeof recovery.reason !== 'string'
        || recovery.reason.length === 0
    ) throw new Error('manifest duplicate GET lacks exact single recovery evidence');
    const asset = manifest.assets.find(({ url }) => url === recovery.url);
    if (!asset || ['status', 'contentType', 'bytes', 'sha256', 'blob'].some((field) => (
      recovery[field] !== asset[field]
    ))) throw new Error('manifest recovery metadata differs from the exact recovered asset');
  }
  if (!SHA256.test(manifest.assetRootHash)) throw new Error('manifest assetRootHash is invalid');
  if (computeSpaAssetRootHash(manifest) !== manifest.assetRootHash) {
    throw new Error('manifest assetRootHash differs from canonical asset inventory');
  }
}

async function verifyAssets(auditDir, manifest) {
  await assertRealDirectory(join(auditDir, 'blobs'), 'blobs directory');
  assertPlainArray(manifest.assets, 'manifest assets', { nonEmpty: true });
  if (manifest.policy.uniqueResourceCount !== manifest.assets.length) {
    throw new Error('manifest uniqueResourceCount differs from asset count');
  }
  const urls = new Set();
  const blobs = new Set();
  const records = new Map();
  let htmlAssets = 0;
  let javascriptAssets = 0;
  for (const [index, asset] of manifest.assets.entries()) {
    if (asset.sequence !== index + 1) throw new Error('manifest asset sequence is not contiguous');
    if (urls.has(asset.url)) throw new Error(`manifest has duplicate asset URL ${asset.url}`);
    urls.add(asset.url);
    if (new URL(asset.url).origin !== manifest.origin || asset.finalUrl !== asset.url) {
      throw new Error(`asset URL/finalUrl escaped or redirected: ${asset.url}`);
    }
    if (asset.status !== 200) throw new Error(`${asset.url} status is not 200`);
    if (!['html', 'javascript'].includes(asset.kind)) {
      throw new Error(`${asset.url} has unsupported asset kind ${asset.kind}`);
    }
    assertContentType(asset.kind, asset.contentType, asset.url);
    if (!SHA256.test(asset.sha256)) throw new Error(`${asset.url} SHA-256 is invalid`);
    const extension = asset.kind === 'html' ? 'html' : 'js';
    const expectedBlob = `blobs/${asset.sha256}.${extension}`;
    if (asset.blob !== expectedBlob) {
      throw new Error(`${asset.url} blob is not content-addressed by SHA-256`);
    }
    const blobPath = join(auditDir, asset.blob);
    await assertRealRegularFile(blobPath, `${asset.url} blob`);
    const body = await readRequired(blobPath, `${asset.url} blob`);
    if (body.byteLength !== asset.bytes || sha256Hex(body) !== asset.sha256) {
      throw new Error(`${asset.url} exact bytes, byte count, or SHA-256 differ from manifest`);
    }
    blobs.add(asset.blob);
    records.set(asset.url, { ...asset, body });
    if (asset.kind === 'html') htmlAssets += 1;
    else javascriptAssets += 1;
  }
  if (htmlAssets !== 1 || javascriptAssets === 0) {
    throw new Error('SPA surface audit requires exactly one HTML root and non-empty JavaScript assets');
  }
  const blobEntries = await readdir(join(auditDir, 'blobs'), { withFileTypes: true });
  if (blobEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('blob directory must contain only real regular files, never symlinks');
  }
  const actualBlobFiles = blobEntries.map(({ name }) => name).sort();
  const expectedBlobFiles = [...blobs].map((path) => path.slice('blobs/'.length)).sort();
  if (canonicalStringify(actualBlobFiles) !== canonicalStringify(expectedBlobFiles)) {
    throw new Error('blob directory has missing or unmanifested files');
  }
  return { records, htmlAssets, javascriptAssets };
}

function deriveAssetGraph(manifest, records) {
  const root = records.get(manifest.rootUrl);
  if (!root || root.kind !== 'html') throw new Error('manifest has no exact root HTML asset');
  const html = extractHtmlExecutableReferences(root.body, root.url);
  const edges = [...html.edges];
  for (const asset of manifest.assets) {
    if (asset.kind !== 'javascript') continue;
    edges.push(...extractJavaScriptImports(records.get(asset.url).body, asset.url));
  }
  return { rootScripts: html.rootScripts, edges, excluded: html.excluded };
}

function assertGraph(manifest, records) {
  const derived = deriveAssetGraph(manifest, records);
  if (canonicalStringify(derived.rootScripts) !== canonicalStringify(manifest.assetGraph?.rootScripts)) {
    throw new Error('root script inventory differs from exact HTML');
  }
  if (canonicalStringify(derived.edges) !== canonicalStringify(manifest.assetGraph?.edges)) {
    throw new Error('full asset graph differs from exact HTML/JavaScript imports');
  }
  if (canonicalStringify(derived.excluded) !== canonicalStringify(manifest.excludedReferences)) {
    throw new Error('non-executable asset exclusion inventory differs from exact HTML');
  }
  if (derived.rootScripts.length === 0) throw new Error('root HTML has no JavaScript scripts');
  for (const edge of derived.edges) {
    const target = records.get(edge.to);
    if (!target || target.kind !== 'javascript') {
      throw new Error(`asset graph target ${edge.to} is missing as exact JavaScript blob`);
    }
  }
  const reachable = new Set([manifest.rootUrl]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of derived.edges) {
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
    }
  }
  const unreachable = manifest.assets
    .filter(({ kind, url }) => kind === 'javascript' && !reachable.has(url))
    .map(({ url }) => url);
  if (unreachable.length > 0) {
    throw new Error(`JavaScript assets are unreachable from root graph: ${unreachable.join(', ')}`);
  }
  return derived;
}

function exactFixedQuery(descriptor) {
  return descriptor.fixedQuery ?? null;
}

function validateEvidence(report, records) {
  assertPlainArray(report.references, 'report references', { nonEmpty: true });
  const references = new Map();
  for (const reference of report.references) {
    if (typeof reference.id !== 'string' || references.has(reference.id)) {
      throw new Error('report evidence reference IDs must be unique strings');
    }
    const asset = [...records.values()].find(({ sha256 }) => sha256 === reference.assetSha256);
    if (!asset || asset.kind !== 'javascript' || asset.blob !== reference.blob) {
      throw new Error(`evidence ${reference.id} does not reference a captured JavaScript blob`);
    }
    if (
      !Number.isInteger(reference.byteOffset) || reference.byteOffset < 0
        || !Number.isInteger(reference.byteLength) || reference.byteLength <= 0
        || typeof reference.exact !== 'string'
    ) throw new Error(`evidence ${reference.id} has invalid exact-byte coordinates`);
    const exact = Buffer.from(reference.exact);
    if (exact.byteLength !== reference.byteLength) {
      throw new Error(`evidence ${reference.id} byteLength differs from exact UTF-8 bytes`);
    }
    const observed = asset.body.subarray(
      reference.byteOffset,
      reference.byteOffset + reference.byteLength,
    );
    if (!observed.equals(exact)) throw new Error(`evidence ${reference.id} exact bytes differ from blob`);
    references.set(reference.id, { ...reference, asset });
  }
  return references;
}

function referenceFor(references, id, label) {
  const reference = references.get(id);
  if (!reference) throw new Error(`${label} names unknown evidence reference ${id}`);
  return reference;
}

function assertMethodEvidence(entry, references) {
  const evidence = entry.evidence;
  assertPlainArray(evidence?.path, `${entry.id} path evidence`, { nonEmpty: true });
  assertPlainArray(evidence?.method, `${entry.id} method evidence`, { nonEmpty: true });
  const pathReferences = evidence.path.map((id) => referenceFor(references, id, entry.id));
  if (!pathReferences.some(({ exact }) => exact.includes('/api/'))) {
    throw new Error(`${entry.id} path evidence has no /api/ anchor`);
  }
  for (const methodEvidence of evidence.method) {
    const reference = referenceFor(references, methodEvidence.reference, entry.id);
    if (methodEvidence.kind === 'fetch-default-get') {
      if (
        entry.method !== 'GET'
          || !/\bfetch\s*\(/.test(reference.exact)
          || /\bmethod\s*:/.test(reference.exact)
      ) throw new Error(`${entry.id} does not prove fetch default GET semantics`);
    } else if (methodEvidence.kind === 'explicit-method') {
      const escaped = entry.method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\bmethod\\s*:\\s*["']${escaped}["']`, 'i').test(reference.exact)) {
        throw new Error(`${entry.id} does not prove explicit ${entry.method} semantics`);
      }
    } else {
      throw new Error(`${entry.id} uses unsupported method evidence ${methodEvidence.kind}`);
    }
  }
  return pathReferences;
}

function expectedContractSha256() {
  return sha256Hex(Buffer.from(serializeContract()));
}

function assertFamilyInventory(report, references) {
  assertPlainArray(report.families, 'report families', { nonEmpty: true });
  const expected = Object.entries(CONTRACT.endpoints);
  const actualIds = report.families.map(({ id }) => id);
  if (
    report.families.length !== expected.length
      || new Set(actualIds).size !== actualIds.length
      || canonicalStringify([...actualIds].sort())
        !== canonicalStringify(expected.map(([id]) => id).sort())
  ) {
    throw new Error(
      `report family inventory must contain the exact ${expected.length} CONTRACT v${CONTRACT.version} families`,
    );
  }
  const familyPaths = new Map();
  for (const [id, descriptor] of expected) {
    const family = report.families.find((candidate) => candidate.id === id);
    if (
      family.method !== 'GET'
        || family.pathTemplate !== descriptor.path
        || canonicalStringify(family.fixedQuery) !== canonicalStringify(exactFixedQuery(descriptor))
    ) throw new Error(`family ${id} method/path/query differs from CONTRACT v${CONTRACT.version}`);
    if (
      id === 'trends'
        && canonicalStringify(family.observed?.fixedUiQuery) !== canonicalStringify({ top: 10 })
    ) throw new Error('family trends observed fixed UI query must pin top=10');
    familyPaths.set(id, assertMethodEvidence(family, references));
  }
  return familyPaths;
}

function assertExclusions(report, references) {
  if (!Array.isArray(report.exclusions) || report.exclusions.length === 0) {
    throw new Error('report must contain an explicit POST match tags exclusion');
  }
  const ids = new Set();
  const exclusionPaths = new Map();
  for (const exclusion of report.exclusions) {
    if (typeof exclusion.id !== 'string' || ids.has(exclusion.id)) {
      throw new Error('exclusion IDs must be unique strings');
    }
    ids.add(exclusion.id);
    if (
      exclusion.method === 'GET'
        || exclusion.disposition !== 'excluded-non-get'
        || typeof exclusion.reason !== 'string'
        || exclusion.reason.length === 0
    ) throw new Error(`${exclusion.id} is not an explicit non-GET exclusion`);
    exclusionPaths.set(exclusion.id, assertMethodEvidence(exclusion, references));
  }
  const postTags = report.exclusions.filter((entry) => (
    entry.method === 'POST' && entry.pathTemplate === '/api/matches/{matchId}/tags'
  ));
  if (postTags.length !== 1) {
    throw new Error('report must contain exactly one explicit POST match tags exclusion');
  }
  return exclusionPaths;
}

function scanApiOccurrences(manifest, records) {
  const needle = Buffer.from('/api/');
  const found = [];
  for (const asset of manifest.assets) {
    if (asset.kind !== 'javascript') continue;
    const body = records.get(asset.url).body;
    let offset = body.indexOf(needle);
    while (offset !== -1) {
      found.push({ assetSha256: asset.sha256, blob: asset.blob, byteOffset: offset });
      offset = body.indexOf(needle, offset + 1);
    }
  }
  return found;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactBindingEdge(asset, text, characterOffset, exact, details) {
  return {
    ...details,
    assetUrl: asset.url,
    assetSha256: asset.sha256,
    blob: asset.blob,
    byteOffset: Buffer.byteLength(text.slice(0, characterOffset)),
    byteLength: Buffer.byteLength(exact),
    exact,
  };
}

function parseNamedBindingClause(clause, characterOffset, asset, text, detailsFor) {
  const entries = [];
  let cursor = 0;
  while (cursor < clause.length) {
    const separator = /^[\s,]*/.exec(clause.slice(cursor))[0];
    cursor += separator.length;
    if (cursor === clause.length) break;
    const match = /^([$A-Z_a-z][$\w]*)(?:\s+as\s+([$A-Z_a-z][$\w]*))?/.exec(
      clause.slice(cursor),
    );
    if (!match) throw new Error(`unsupported ESM named binding clause near ${clause.slice(cursor, cursor + 40)}`);
    const next = clause[cursor + match[0].length];
    if (next !== undefined && next !== ',' && !/\s/.test(next)) {
      throw new Error(`unsupported ESM named binding separator near ${clause.slice(cursor, cursor + 40)}`);
    }
    entries.push(exactBindingEdge(
      asset,
      text,
      characterOffset + cursor,
      match[0],
      detailsFor(match[1], match[2] ?? match[1]),
    ));
    cursor += match[0].length;
  }
  return entries;
}

function extractEsmNamedBindingEdges(manifest, records) {
  const localExports = [];
  const imports = [];
  const reExports = [];
  for (const asset of manifest.assets) {
    if (asset.kind !== 'javascript') continue;
    const text = records.get(asset.url).body.toString('utf8');
    const importPattern = /\bimport\s*\{([^{}]*)\}\s*from\s*(["'])([^"']+)\2/g;
    for (const match of text.matchAll(importPattern)) {
      const clauseOffset = match.index + match[0].indexOf(match[1]);
      const sourceUrl = resolveSameOrigin(
        match[3],
        asset.url,
        manifest.origin,
        'ESM named import',
      );
      imports.push(...parseNamedBindingClause(
        match[1],
        clauseOffset,
        asset,
        text,
        (importedName, localName) => ({
          kind: 'named-import',
          sourceUrl,
          importedName,
          localName,
        }),
      ));
    }

    const exportPattern = /\bexport\s*\{([^{}]*)\}\s*(?:from\s*(["'])([^"']+)\2)?/g;
    for (const match of text.matchAll(exportPattern)) {
      const clauseOffset = match.index + match[0].indexOf(match[1]);
      if (match[3] === undefined) {
        localExports.push(...parseNamedBindingClause(
          match[1],
          clauseOffset,
          asset,
          text,
          (localName, exportedName) => ({
            kind: 'named-export',
            localName,
            exportedName,
          }),
        ));
      } else {
        const sourceUrl = resolveSameOrigin(
          match[3],
          asset.url,
          manifest.origin,
          'ESM named re-export',
        );
        reExports.push(...parseNamedBindingClause(
          match[1],
          clauseOffset,
          asset,
          text,
          (importedName, exportedName) => ({
            kind: 'named-re-export',
            sourceUrl,
            importedName,
            exportedName,
          }),
        ));
      }
    }
  }
  return { localExports, imports, reExports };
}

function deriveGetHelperLocalBindings(manifest, records, definition, helperName) {
  const { localExports, imports, reExports } = extractEsmNamedBindingEdges(manifest, records);
  const localBindings = new Map();
  const exportedBindings = new Map();
  const localKey = (assetUrl, name) => `${assetUrl}\u0000${name}`;
  const exportedKey = (assetUrl, name) => `${assetUrl}\u0000${name}`;
  const definitionAsset = definition.asset;
  localBindings.set(localKey(definitionAsset.url, helperName), {
    asset: definitionAsset,
    name: helperName,
    path: [],
  });
  const maximumPasses = (localExports.length + imports.length + reExports.length) * 2 + 2;
  let changed = true;
  let pass = 0;
  while (changed) {
    if (pass >= maximumPasses) {
      throw new Error('bounded ESM helper binding closure did not converge');
    }
    pass += 1;
    changed = false;
    for (const edge of localExports) {
      const source = localBindings.get(localKey(edge.assetUrl, edge.localName));
      const targetKey = exportedKey(edge.assetUrl, edge.exportedName);
      if (source && !exportedBindings.has(targetKey)) {
        exportedBindings.set(targetKey, { path: [...source.path, edge] });
        changed = true;
      }
    }
    for (const edge of reExports) {
      const source = exportedBindings.get(exportedKey(edge.sourceUrl, edge.importedName));
      const targetKey = exportedKey(edge.assetUrl, edge.exportedName);
      if (source && !exportedBindings.has(targetKey)) {
        exportedBindings.set(targetKey, { path: [...source.path, edge] });
        changed = true;
      }
    }
    for (const edge of imports) {
      const source = exportedBindings.get(exportedKey(edge.sourceUrl, edge.importedName));
      const targetKey = localKey(edge.assetUrl, edge.localName);
      if (source && !localBindings.has(targetKey)) {
        const asset = records.get(edge.assetUrl);
        if (!asset) throw new Error(`ESM helper alias module is absent from asset inventory: ${edge.assetUrl}`);
        localBindings.set(targetKey, {
          asset,
          name: edge.localName,
          path: [...source.path, edge],
        });
        changed = true;
      }
    }
  }
  const assetSequence = new Map(manifest.assets.map(({ url }, index) => [url, index]));
  return [...localBindings.values()].sort((left, right) => (
    assetSequence.get(left.asset.url) - assetSequence.get(right.asset.url)
      || left.name.localeCompare(right.name)
  ));
}

function closingCallParenthesis(text, openingOffset, label) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let offset = openingOffset; offset < text.length; offset += 1) {
    const character = text[offset];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['"', "'", '`'].includes(character)) {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  throw new Error(`${label} has an unbalanced helper call`);
}

function scanGetHelperCallSites(manifest, records, bindings) {
  const found = [];
  const assetSequence = new Map(manifest.assets.map(({ url }, index) => [url, index]));
  for (const binding of bindings) {
    const { asset, name: helperName } = binding;
    const pattern = new RegExp(`\\b${escapeRegExp(helperName)}\\s*\\(`, 'g');
    const text = records.get(asset.url).body.toString('utf8');
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(Math.max(0, match.index - 80), match.index);
      if (/\bfunction\s*$/.test(prefix)) continue;
      const openingOffset = text.indexOf('(', match.index + helperName.length);
      const closingOffset = closingCallParenthesis(text, openingOffset, helperName);
      const exact = text.slice(match.index, closingOffset + 1);
      found.push({
        assetUrl: asset.url,
        assetSha256: asset.sha256,
        blob: asset.blob,
        byteOffset: Buffer.byteLength(text.slice(0, match.index)),
        byteLength: Buffer.byteLength(exact),
        exact,
        helperName,
        bindingPath: binding.path,
      });
    }
  }
  return found.sort((left, right) => (
    assetSequence.get(left.assetUrl) - assetSequence.get(right.assetUrl)
      || left.byteOffset - right.byteOffset
      || left.helperName.localeCompare(right.helperName)
  ));
}

function skipBracedTemplateExpression(text, openingOffset) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let offset = openingOffset + 1; offset < text.length; offset += 1) {
    const character = text[offset];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['"', "'", '`'].includes(character)) {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  throw new Error('GET helper call-site template expression is unbalanced');
}

function normalizedCallArgument(callExact, helperName) {
  const opening = callExact.indexOf('(', helperName.length);
  let offset = opening + 1;
  while (/\s/.test(callExact[offset] ?? '')) offset += 1;
  const quote = callExact[offset];
  if (!['"', "'", '`'].includes(quote)) {
    throw new Error('GET helper call-site first argument is not a static string/template');
  }
  let normalized = '';
  let escaped = false;
  for (offset += 1; offset < callExact.length; offset += 1) {
    const character = callExact[offset];
    if (escaped) {
      normalized += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === quote) return normalized;
    if (quote === '`' && character === '$' && callExact[offset + 1] === '{') {
      normalized += '{dynamic}';
      offset = skipBracedTemplateExpression(callExact, offset + 1);
      continue;
    }
    normalized += character;
  }
  throw new Error('GET helper call-site first argument is unterminated');
}

function queryValuePattern(value) {
  if (typeof value === 'string') return `["']${escapeRegExp(value)}["']`;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return escapeRegExp(String(value));
  }
  throw new Error(`unsupported fixed GET query evidence value ${JSON.stringify(value)}`);
}

function callProvesFixedQuery(callExact, fixedQuery) {
  return Object.entries(fixedQuery ?? {}).every(([key, value]) => {
    const escapedKey = escapeRegExp(key);
    const encodedValue = escapeRegExp(encodeURIComponent(String(value)));
    return new RegExp(`(?:[?&])${escapedKey}=${encodedValue}(?:[&#"'\x60]|$)`).test(callExact)
      || new RegExp(`(?:^|[,{])\\s*${escapedKey}\\s*:\\s*${queryValuePattern(value)}\\s*(?:[,}])`).test(
        callExact,
      );
  });
}

function assertCallMatchesContractFamily(
  callExact,
  helperName,
  familyId,
  observedFixedQuery = null,
) {
  const descriptor = CONTRACT.endpoints[familyId];
  const expectedPath = descriptor.path
    .slice('/api/'.length)
    .replace(/\{[^}]+\}/g, '{dynamic}');
  const actual = normalizedCallArgument(callExact, helperName);
  if (!actual.startsWith(expectedPath)) {
    throw new Error(`${familyId} static path tokens differ from its GET helper call-site`);
  }
  const remainder = actual.slice(expectedPath.length);
  if (remainder !== '' && remainder !== '{dynamic}' && !remainder.startsWith('?')) {
    throw new Error(`${familyId} static path shape differs from its GET helper call-site`);
  }
  if (descriptor.fixedQuery && !callProvesFixedQuery(callExact, descriptor.fixedQuery)) {
    throw new Error(`${familyId} CONTRACT fixedQuery is absent from its GET helper call-site`);
  }
  if (observedFixedQuery && !callProvesFixedQuery(callExact, observedFixedQuery)) {
    throw new Error(`${familyId} observed fixed UI query is absent from its GET helper call-site`);
  }
  const provesByDay = callProvesFixedQuery(callExact, { by: 'day' });
  const samePathByDayFamily = Object.entries(CONTRACT.endpoints).some(([otherId, other]) => (
    otherId !== familyId
      && other.path === descriptor.path
      && other.fixedQuery?.by === 'day'
  ));
  if (!descriptor.fixedQuery && samePathByDayFamily && provesByDay) {
    throw new Error(`${familyId} non-by-day family is mapped to a fixedQuery by=day call-site`);
  }
}

function assertGetCallSiteInventory(report, manifest, records, references, familyPaths) {
  const helper = report.getHelper;
  if (
    !helper || typeof helper.name !== 'string'
      || !/^[$A-Z_a-z][$\w]*$/.test(helper.name)
      || typeof helper.definition !== 'string'
  ) throw new Error('report getHelper declaration is invalid');
  const definition = referenceFor(references, helper.definition, 'getHelper');
  if (
    !new RegExp(`\\bfunction\\s+${escapeRegExp(helper.name)}\\s*\\(`).test(definition.exact)
      || !definition.exact.includes('/api/')
      || !/\bfetch\s*\(/.test(definition.exact)
      || /\bmethod\s*:/.test(definition.exact)
  ) throw new Error('report getHelper does not prove default-GET /api/ construction');

  assertPlainArray(report.getCallSites, 'report GET helper call sites', { nonEmpty: true });
  const bindings = deriveGetHelperLocalBindings(manifest, records, definition, helper.name);
  const actual = scanGetHelperCallSites(manifest, records, bindings);
  const coordinateKey = (entry) => [
    entry.assetSha256,
    entry.blob,
    entry.byteOffset,
    entry.byteLength,
    entry.exact,
  ].join('\u0000');
  const actualByCoordinate = new Map(actual.map((entry) => [coordinateKey(entry), entry]));
  const reported = [];
  const seenReferences = new Set();
  const coveredFamilies = new Set();
  for (const callSite of report.getCallSites) {
    if (seenReferences.has(callSite.reference)) {
      throw new Error(`GET helper call-site reference is duplicated: ${callSite.reference}`);
    }
    seenReferences.add(callSite.reference);
    const reference = referenceFor(references, callSite.reference, 'GET helper call site');
    const actualCall = actualByCoordinate.get(coordinateKey(reference));
    if (!actualCall) throw new Error(`${reference.id} is not a derived GET helper alias call site`);
    if (!familyPaths.has(callSite.family)) {
      throw new Error(`GET helper call site maps unknown family ${callSite.family}`);
    }
    if (!familyPaths.get(callSite.family).some(({ id }) => id === reference.id)) {
      throw new Error(`family ${callSite.family} path evidence omits its GET helper call site`);
    }
    if (!new RegExp(`^${escapeRegExp(actualCall.helperName)}\\s*\\(`).test(reference.exact)) {
      throw new Error(`${reference.id} is not an exact ${actualCall.helperName}(...) call`);
    }
    const pathReferences = familyPaths.get(callSite.family);
    for (const edge of actualCall.bindingPath) {
      const pinned = pathReferences.some((candidate) => (
        candidate.assetSha256 === edge.assetSha256
          && candidate.blob === edge.blob
          && candidate.byteOffset === edge.byteOffset
          && candidate.byteLength === edge.byteLength
          && candidate.exact === edge.exact
      ));
      if (!pinned) {
        throw new Error(
          `family ${callSite.family} path evidence omits ESM ${edge.kind} binding ${edge.exact}`,
        );
      }
    }
    const family = report.families.find(({ id }) => id === callSite.family);
    assertCallMatchesContractFamily(
      reference.exact,
      actualCall.helperName,
      callSite.family,
      family.observed?.fixedUiQuery ?? null,
    );
    reported.push({
      assetSha256: reference.assetSha256,
      blob: reference.blob,
      byteOffset: reference.byteOffset,
      byteLength: reference.byteLength,
      exact: reference.exact,
    });
    coveredFamilies.add(callSite.family);
  }
  const actualComparable = actual.map(({
    assetSha256, blob, byteOffset, byteLength, exact,
  }) => ({
    assetSha256, blob, byteOffset, byteLength, exact,
  }));
  if (canonicalStringify(reported) !== canonicalStringify(actualComparable)) {
    const difference = Array.from(
      { length: Math.max(reported.length, actualComparable.length) },
      (_, index) => index,
    ).find((index) => (
      canonicalStringify(reported[index]) !== canonicalStringify(actualComparable[index])
    ));
    throw new Error(
      'GET helper alias call-site inventory contains an unmapped GET template'
        + ` (reported=${reported.length}, actual=${actualComparable.length}, firstDifference=${difference},`
        + ` reportedEntry=${canonicalStringify(reported[difference])},`
        + ` actualEntry=${canonicalStringify(actualComparable[difference])})`,
    );
  }
  for (const family of familyPaths.keys()) {
    if (!coveredFamilies.has(family)) {
      throw new Error(`GET helper call-site inventory does not cover family ${family}`);
    }
  }
}

function assertApiOccurrenceInventory(
  report,
  actualOccurrences,
  familyPaths,
  exclusionPaths,
) {
  assertPlainArray(report.apiOccurrences, 'report apiOccurrences', { nonEmpty: true });
  const reportedCoordinates = report.apiOccurrences.map((occurrence) => ({
    assetSha256: occurrence.assetSha256,
    blob: occurrence.blob,
    byteOffset: occurrence.byteOffset,
  }));
  if (canonicalStringify(reportedCoordinates) !== canonicalStringify(actualOccurrences)) {
    throw new Error('API occurrence inventory contains an unknown API occurrence or unmapped anchor');
  }
  const seenClassifications = new Set();
  for (const occurrence of report.apiOccurrences) {
    assertPlainArray(occurrence.classifications, 'API occurrence classifications', { nonEmpty: true });
    for (const classification of occurrence.classifications) {
      const [kind, id, extra] = String(classification).split(':');
      if (extra !== undefined || !['family', 'exclusion'].includes(kind)) {
        throw new Error(`invalid API occurrence classification ${classification}`);
      }
      const paths = kind === 'family' ? familyPaths.get(id) : exclusionPaths.get(id);
      if (!paths) throw new Error(`unknown API occurrence classification ${classification}`);
      const covered = paths.some((reference) => (
        reference.assetSha256 === occurrence.assetSha256
          && reference.blob === occurrence.blob
          && occurrence.byteOffset >= reference.byteOffset
          && occurrence.byteOffset < reference.byteOffset + reference.byteLength
      ));
      if (!covered) {
        throw new Error(`${classification} does not map the referenced /api/ occurrence`);
      }
      seenClassifications.add(classification);
    }
  }
  for (const id of familyPaths.keys()) {
    if (!seenClassifications.has(`family:${id}`)) {
      throw new Error(`family ${id} has no classified /api/ occurrence`);
    }
  }
  for (const id of exclusionPaths.keys()) {
    if (!seenClassifications.has(`exclusion:${id}`)) {
      throw new Error(`exclusion ${id} has no classified /api/ occurrence`);
    }
  }
}

async function assertArtifactFileInventory(auditDir) {
  const entries = (await readdir(auditDir, { withFileTypes: true }))
    .map((entry) => {
      if (entry.isDirectory() && !entry.isSymbolicLink()) return `dir:${entry.name}`;
      if (entry.isFile() && !entry.isSymbolicLink()) return `file:${entry.name}`;
      return `special:${entry.name}`;
    })
    .sort();
  const expected = ['dir:blobs', 'file:manifest.json', 'file:report.json'];
  if (canonicalStringify(entries) !== canonicalStringify(expected)) {
    throw new Error('SPA surface audit directory has missing or unmanifested top-level artifacts');
  }
}

export async function verifySpaSurfaceAudit(auditDir) {
  if (typeof auditDir !== 'string' || auditDir.length === 0) {
    throw new TypeError('auditDir must be a non-empty string');
  }
  await assertRealDirectory(auditDir, 'SPA surface audit');
  const manifestPath = join(auditDir, 'manifest.json');
  await assertRealRegularFile(manifestPath, 'manifest.json');
  const { value: manifest } = await readCanonicalJson(
    manifestPath,
    'manifest.json',
  );
  assertManifestIdentity(manifest, auditDir);
  if (
    manifest.report?.path !== 'report.json'
      || !Number.isInteger(manifest.report?.bytes)
      || !SHA256.test(manifest.report?.sha256)
  ) throw new Error('report.json is missing or unreadable because manifest does not pin it');
  const reportPath = join(auditDir, 'report.json');
  await assertRealRegularFile(reportPath, 'report.json');
  const reportRead = await readCanonicalJson(reportPath, 'report.json');
  if (
    reportRead.bytes.byteLength !== manifest.report.bytes
      || sha256Hex(reportRead.bytes) !== manifest.report.sha256
  ) throw new Error('report.json exact bytes or SHA-256 differ from manifest');
  const report = reportRead.value;
  if (
    report.schemaVersion !== SPA_SURFACE_AUDIT_SCHEMA_VERSION
      || report.auditId !== manifest.auditId
      || report.assetRootHash !== manifest.assetRootHash
  ) throw new Error('report identity differs from manifest');
  if (
    report.contractVersion !== CONTRACT.version
      || report.contractSha256 !== expectedContractSha256()
  ) throw new Error('report CONTRACT version or exact SHA-256 is stale');

  const { records, htmlAssets, javascriptAssets } = await verifyAssets(auditDir, manifest);
  const graph = assertGraph(manifest, records);
  if (
    report.assetGraph?.htmlAssets !== htmlAssets
      || report.assetGraph?.javascriptAssets !== javascriptAssets
      || report.assetGraph?.edges !== graph.edges.length
      || report.assetGraph?.allJavascriptReachable !== true
  ) throw new Error('report assetGraph summary differs from exact full graph');
  const references = validateEvidence(report, records);
  const familyPaths = assertFamilyInventory(report, references);
  const exclusionPaths = assertExclusions(report, references);
  if (
    !Array.isArray(report.unmappedGetTemplates) || report.unmappedGetTemplates.length !== 0
      || !Array.isArray(report.unknownApiOccurrences) || report.unknownApiOccurrences.length !== 0
  ) throw new Error('report contains unmapped GET templates or unknown API occurrences');
  assertGetCallSiteInventory(report, manifest, records, references, familyPaths);
  const actualOccurrences = scanApiOccurrences(manifest, records);
  assertApiOccurrenceInventory(report, actualOccurrences, familyPaths, exclusionPaths);
  await assertArtifactFileInventory(auditDir);

  return {
    status: 'complete',
    auditId: manifest.auditId,
    assetRootHash: manifest.assetRootHash,
    assets: manifest.assets.length,
    javascriptAssets,
    apiOccurrences: actualOccurrences.length,
    getFamilies: report.families.length,
    exclusions: report.exclusions.length,
    contractVersion: report.contractVersion,
  };
}

function sourceSummaryPin(manifest, report) {
  return {
    schemaVersion: SPA_SURFACE_AUDIT_SCHEMA_VERSION,
    auditId: manifest.auditId,
    assetRootHash: manifest.assetRootHash,
    report: manifest.report,
    capture: {
      bodyReadMethod: manifest.policy.bodyReadMethod,
      requestCount: manifest.policy.requestCount,
      uniqueResourceCount: manifest.policy.uniqueResourceCount,
      assetCount: manifest.assets.length,
    },
    surface: {
      javascriptAssets: report.assetGraph.javascriptAssets,
      apiOccurrences: report.apiOccurrences.length,
      getCallSites: report.getCallSites.length,
      getFamilies: report.families.length,
      exclusions: report.exclusions.length,
    },
    contract: {
      version: report.contractVersion,
      sha256: report.contractSha256,
    },
  };
}

async function verifySourceSummaryPin(sourceSummariesRoot, auditDir) {
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));
  const report = JSON.parse(await readFile(join(auditDir, 'report.json'), 'utf8'));
  const date = manifest.auditId.slice(0, 10);
  const summaryPath = join(sourceSummariesRoot, `${date}-whoajor-spa-surface-audit.md`);
  await assertRealRegularFile(summaryPath, 'SPA surface source summary');
  const summary = await readFile(summaryPath, 'utf8');
  const markers = [...summary.matchAll(
    /<!-- whoajor-spa-surface-audit-pin\n([^\n]+)\n-->/g,
  )];
  if (markers.length !== 1) {
    throw new Error('SPA surface source summary must contain exactly one canonical summary pin');
  }
  let observed;
  try {
    observed = JSON.parse(markers[0][1]);
  } catch (error) {
    throw new Error(`SPA surface source summary pin is invalid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (
    markers[0][1] !== canonicalStringify(observed)
      || canonicalStringify(observed) !== canonicalStringify(sourceSummaryPin(manifest, report))
  ) throw new Error('SPA surface source summary pin is stale relative to exact manifest/report');

  const rootPins = [...summary.matchAll(/`assetRootHash=([a-f0-9]{64})`/g)];
  const reportPins = [...summary.matchAll(/`reportSha256=([a-f0-9]{64})`/g)];
  if (
    rootPins.length !== 1
      || rootPins[0][1] !== manifest.assetRootHash
      || reportPins.length !== 1
      || reportPins[0][1] !== manifest.report.sha256
  ) throw new Error('SPA surface source summary human-readable hash pins are stale');
}

export async function verifyPublishedSpaSurfaceAudits(whoajorRoot, {
  sourceSummariesRoot = null,
} = {}) {
  if (typeof whoajorRoot !== 'string' || whoajorRoot.length === 0) {
    throw new TypeError('whoajorRoot must be a non-empty string');
  }
  const entries = await readdir(whoajorRoot, { withFileTypes: true });
  const candidates = entries
    .filter(({ name }) => /^\d{4}-\d{2}-\d{2}-spa-surface-audit$/.test(name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (candidates.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error('published SPA surface audit must be a real directory, never a symlink');
  }
  const names = candidates
    .map(({ name }) => name)
    .sort();
  if (names.length === 0) throw new Error('at least one published SPA surface audit is required');
  const audits = [];
  let sourceSummariesVerified = 0;
  for (const name of names) {
    const auditDir = join(whoajorRoot, name);
    audits.push(await verifySpaSurfaceAudit(auditDir));
    if (sourceSummariesRoot !== null) {
      await assertRealDirectory(sourceSummariesRoot, 'SPA surface source-summary root');
      await verifySourceSummaryPin(sourceSummariesRoot, auditDir);
      sourceSummariesVerified += 1;
    }
  }
  return {
    status: 'complete',
    auditCount: audits.length,
    audits,
    ...(sourceSummariesRoot === null ? {} : { sourceSummariesVerified }),
  };
}
