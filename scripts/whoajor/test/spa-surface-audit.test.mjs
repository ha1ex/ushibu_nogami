import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile, mkdtemp, readFile, rm, symlink, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  captureSpaSurfaceAssets,
  computeSpaAssetRootHash,
  finalizeSpaSurfaceAudit,
  verifyPublishedSpaSurfaceAudits,
  verifySpaSurfaceAudit,
} from '../lib/spa-surface-audit.mjs';
import { CONTRACT } from '../lib/contract.mjs';
import { serializeContract } from '../sync.mjs';

const ROOT_URL = 'https://stats.whoajor.com/';
const CONTRACT_SHA256 = createHash('sha256').update(serializeContract()).digest('hex');
const GET_HELPER_EXACT = 'async function dt(e){return fetch(`/api/${e}`)}';
const GET_HELPER_EXPORT_EXACT = 'dt as m';
const GET_HELPER_IMPORT_EXACT = 'm as ht';
const TRENDS_CALL_EXACT = 'ht(`trends${vt({top:10})}`)';

const ROUTES = Object.freeze([
  ['meta', '/api/meta', null, 'dt("meta")'],
  ['tags', '/api/tags', null, 'dt("tags")'],
  ['draftConfig', '/api/draft-config', null, 'dt("draft-config")'],
  ['matches', '/api/matches', null, 'dt("matches?limit=100&offset=0")'],
  ['matchDetail', '/api/matches/{matchId}', null,
    'dt(`matches/${encodeURIComponent(matchId)}`)'],
  ['leaderboard', '/api/leaderboard', null, 'dt("leaderboard")'],
  ['playerSummary', '/api/players/{steamid}/summary', null,
    'dt(`players/${steamid}/summary`)'],
  ['playerMaps', '/api/players/{steamid}/maps', null,
    'dt(`players/${steamid}/maps`)'],
  ['playerWeapons', '/api/players/{steamid}/weapons', null,
    'dt(`players/${steamid}/weapons`)'],
  ['playerWeaponsByDay', '/api/players/{steamid}/weapons', { by: 'day' },
    'dt(`players/${steamid}/weapons?by=day`)'],
  ['playerMatches', '/api/players/{steamid}/matches', null,
    'dt(`players/${steamid}/matches`)'],
  ['weapons', '/api/weapons', null, 'dt("weapons")'],
  ['weaponDetail', '/api/weapons/{weapon}', null,
    'dt(`weapons/${encodeURIComponent(weapon)}`)'],
  ['weaponDetailByDay', '/api/weapons/{weapon}', { by: 'day' },
    'dt(`weapons/${encodeURIComponent(weapon)}?by=day`)'],
  ['weaponSplits', '/api/weapon-splits', null, 'dt("weapon-splits")'],
]);

const POST_TAGS = Object.freeze({
  id: 'matchTagsMutation',
  method: 'POST',
  pathTemplate: '/api/matches/{matchId}/tags',
  exact: 'fetch("/api/matches/"+matchId+"/tags",{method:"POST"})',
});

const TRENDS = Object.freeze({
  id: 'trends',
  method: 'GET',
  pathTemplate: '/api/trends',
  observedFixedQuery: { top: 10 },
});

function fixtureAssets({
  extraGet = false,
  extraHelperGet = false,
  extraAliasedHelperGet = false,
  extraReExportedHelperGet = false,
} = {}) {
  const routeCalls = ROUTES.map(([, , , exact]) => exact).join(';\n');
  const unknown = extraGet ? ';\nfetch("/api/private-export")' : '';
  const unknownHelper = extraHelperGet ? ';\ndt("private-export")' : '';
  return new Map([
    [ROOT_URL, {
      contentType: 'text/html; charset=utf-8',
      body: Buffer.from(
        '<!doctype html><html><head>'
          + '<link rel="modulepreload" href="/assets/vendor.js">'
          + '<link rel="stylesheet" href="/assets/app.css">'
          + '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>'
          + '</head><body><script type="module" src="/assets/app.js"></script></body></html>',
      ),
    }],
    ['https://stats.whoajor.com/assets/vendor.js', {
      contentType: 'application/javascript',
      body: Buffer.from(extraReExportedHelperGet
        ? 'export{m as x}from"./app.js";export const vendor="точные байты";'
        : 'export const vendor="точные байты";'),
    }],
    ['https://stats.whoajor.com/assets/app.js', {
      contentType: 'text/javascript; charset=utf-8',
      body: Buffer.from(
        `import "./vendor.js";\nexport const lazy=()=>import("./lazy.js");\n`
          + `${GET_HELPER_EXACT};\n${routeCalls};\n${POST_TAGS.exact}`
          + `${unknown}${unknownHelper};\nexport{dt as m};\n`,
      ),
    }],
    ['https://stats.whoajor.com/assets/lazy.js', {
      contentType: 'application/javascript',
      body: Buffer.from(
        'import{m as ht}from"./app.js";'
          + `${extraReExportedHelperGet ? 'import{x as h2}from"./vendor.js";' : ''}`
          + 'const vt=e=>`?top=${e.top}`;export const lazy=true;'
          + TRENDS_CALL_EXACT
          + `${extraAliasedHelperGet ? ';ht("private")' : ''}`
          + `${extraReExportedHelperGet ? ';h2("private")' : ''}`,
      ),
    }],
  ]);
}

function fakeFetchFor(assets, calls, state) {
  return async (url, options) => {
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    await new Promise((resolve) => setImmediate(resolve));
    state.active -= 1;
    const href = String(url);
    calls.push({ href, options });
    const asset = assets.get(href);
    assert.ok(asset, `unexpected live request ${href}`);
    let reads = 0;
    return {
      status: 200,
      url: href,
      headers: new Headers({ 'content-type': asset.contentType }),
      async arrayBuffer() {
        reads += 1;
        assert.equal(reads, 1, `${href} body must be read exactly once`);
        return asset.body;
      },
    };
  };
}

function evidenceReference(asset, id, exact) {
  const body = asset.body;
  const exactBytes = Buffer.from(exact);
  const byteOffset = body.indexOf(exactBytes);
  assert.notEqual(byteOffset, -1, `fixture evidence ${id} must exist`);
  assert.equal(body.indexOf(exactBytes, byteOffset + 1), -1, `fixture evidence ${id} must be unique`);
  return {
    id,
    assetSha256: asset.sha256,
    blob: asset.blob,
    byteOffset,
    byteLength: exactBytes.byteLength,
    exact,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sourceSummaryPinFor(auditDir, overrides = {}) {
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));
  const report = JSON.parse(await readFile(join(auditDir, 'report.json'), 'utf8'));
  return {
    schemaVersion: 1,
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
    ...overrides,
  };
}

function sourceSummaryText(pin) {
  return `<!-- whoajor-spa-surface-audit-pin\n${stableStringify(pin)}\n-->\n`
    + `FACT: \`assetRootHash=${pin.assetRootHash}\`; `
    + `\`reportSha256=${pin.report.sha256}\`.\n`;
}

async function rewriteReportAndPin(auditDir, report) {
  const reportBytes = Buffer.from(`${stableStringify(report)}\n`);
  await writeFile(join(auditDir, 'report.json'), reportBytes);
  const manifestPath = join(auditDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.report = {
    path: 'report.json',
    bytes: reportBytes.byteLength,
    sha256: createHash('sha256').update(reportBytes).digest('hex'),
  };
  await writeFile(manifestPath, `${stableStringify(manifest)}\n`);
}

function reportFor(manifest, originalAssets) {
  const appAsset = manifest.assets.find(({ url }) => url.endsWith('/assets/app.js'));
  assert.ok(appAsset);
  const app = { ...appAsset, body: originalAssets.get(appAsset.url).body };
  const helperReference = evidenceReference(app, 'get-helper-dt', GET_HELPER_EXACT);
  const references = [helperReference];
  const getCallSites = [];
  const families = ROUTES.map(([id, pathTemplate, fixedQuery, exact]) => {
    const reference = evidenceReference(app, `family-${id}`, exact);
    references.push(reference);
    getCallSites.push({ reference: reference.id, family: id });
    return {
      id,
      method: 'GET',
      pathTemplate,
      fixedQuery,
      evidence: {
        path: [helperReference.id, reference.id],
        method: [{ kind: 'fetch-default-get', reference: helperReference.id }],
      },
    };
  });
  const postReference = evidenceReference(app, 'exclusion-match-tags-post', POST_TAGS.exact);
  references.push(postReference);
  const exclusions = [{
    id: POST_TAGS.id,
    method: POST_TAGS.method,
    pathTemplate: POST_TAGS.pathTemplate,
    disposition: 'excluded-non-get',
    reason: 'Mutation endpoint is outside the approved GET-only import.',
    evidence: {
      path: [postReference.id],
      method: [{ kind: 'explicit-method', reference: postReference.id }],
    },
  }];
  const lazyAsset = manifest.assets.find(({ url }) => url.endsWith('/assets/lazy.js'));
  assert.ok(lazyAsset);
  const lazy = { ...lazyAsset, body: originalAssets.get(lazyAsset.url).body };
  const exportReference = evidenceReference(
    app,
    'get-helper-export-dt-as-m',
    GET_HELPER_EXPORT_EXACT,
  );
  const importReference = evidenceReference(
    lazy,
    'get-helper-import-m-as-ht',
    GET_HELPER_IMPORT_EXACT,
  );
  const trendsReference = evidenceReference(lazy, 'family-trends', TRENDS_CALL_EXACT);
  references.push(exportReference, importReference, trendsReference);
  getCallSites.push({ reference: trendsReference.id, family: TRENDS.id });
  families.push({
    id: TRENDS.id,
    method: TRENDS.method,
    pathTemplate: TRENDS.pathTemplate,
    fixedQuery: null,
    observed: { fixedUiQuery: TRENDS.observedFixedQuery },
    evidence: {
      path: [
        helperReference.id,
        exportReference.id,
        importReference.id,
        trendsReference.id,
      ],
      method: [{ kind: 'fetch-default-get', reference: helperReference.id }],
      query: [trendsReference.id],
    },
  });
  const classified = [
    {
      exact: GET_HELPER_EXACT,
      classifications: families.map(({ id }) => `family:${id}`),
    },
    { exact: POST_TAGS.exact, classifications: [`exclusion:${POST_TAGS.id}`] },
  ];
  const apiOccurrences = classified.map(({ exact, classifications }) => {
    const exactOffset = app.body.indexOf(Buffer.from(exact));
    const apiOffset = Buffer.from(exact).indexOf(Buffer.from('/api/'));
    return {
      assetSha256: app.sha256,
      blob: app.blob,
      byteOffset: exactOffset + apiOffset,
      classifications,
    };
  }).sort((left, right) => left.byteOffset - right.byteOffset);

  return {
    schemaVersion: 1,
    auditId: manifest.auditId,
    assetRootHash: manifest.assetRootHash,
    contractVersion: CONTRACT.version,
    contractSha256: CONTRACT_SHA256,
    assetGraph: {
      htmlAssets: 1,
      javascriptAssets: 3,
      edges: manifest.assetGraph.edges.length,
      allJavascriptReachable: true,
    },
    references,
    apiOccurrences,
    getHelper: { name: 'dt', definition: helperReference.id },
    getCallSites,
    families,
    exclusions,
    unmappedGetTemplates: [],
    unknownApiOccurrences: [],
  };
}

async function buildFixtureAudit(t, options = {}) {
  const container = await mkdtemp(join(tmpdir(), 'whoajor-spa-audit-test-'));
  const auditDir = join(container, '2026-08-30-spa-surface-audit');
  t.after(() => rm(container, { recursive: true, force: true }));
  const assets = fixtureAssets(options);
  const calls = [];
  const sleeps = [];
  const state = { active: 0, maxActive: 0 };
  const manifest = await captureSpaSurfaceAssets({
    outputDir: auditDir,
    rootUrl: ROOT_URL,
    auditId: '2026-08-30-spa-surface-audit',
    delayMs: 7,
    userAgent: 'ushibu-nogami-whoajor-spa-audit/1.0 (+offline-test)',
    fetchImpl: fakeFetchFor(assets, calls, state),
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    now: (() => {
      const values = [
        new Date('2026-08-30T10:00:00.000Z'),
        new Date('2026-08-30T10:00:01.000Z'),
      ];
      return () => values.shift() ?? new Date('2026-08-30T10:00:01.000Z');
    })(),
  });
  if (options.rootRecovery) {
    const rootAsset = manifest.assets[0];
    manifest.policy.requestCount += 1;
    manifest.policy.duplicateRequestCount = 1;
    manifest.policy.delayMs = null;
    manifest.policy.userAgent = null;
    manifest.requestOrder.push(ROOT_URL);
    manifest.requestUserAgents.push('ushibu-nogami-whoajor-spa-audit/1.0 (+header-recovery)');
    manifest.enforcedDelayBeforeMs.push(0);
    manifest.recovery = {
      sequence: manifest.policy.requestCount,
      url: ROOT_URL,
      reason: 'Recovered exact response headers after the initial body-only observation.',
      status: rootAsset.status,
      contentType: rootAsset.contentType,
      bytes: rootAsset.bytes,
      sha256: rootAsset.sha256,
      blob: rootAsset.blob,
      initialAndRecoveryShaMatch: true,
      startedAt: '2026-08-30T10:03:27.236Z',
      finishedAt: '2026-08-30T10:03:27.635Z',
      elapsedMs: 399,
    };
    manifest.assetRootHash = computeSpaAssetRootHash(manifest);
    await writeFile(join(auditDir, 'manifest.json'), `${stableStringify(manifest)}\n`);
  }
  if (!options.noReport) {
    await finalizeSpaSurfaceAudit(auditDir, reportFor(manifest, assets));
  }
  return {
    auditDir, assets, calls, sleeps, state,
  };
}

test('capture читает только root и полный same-origin JavaScript graph последовательными GET', async (t) => {
  const {
    auditDir, assets, calls, sleeps, state,
  } = await buildFixtureAudit(t);

  assert.equal(state.maxActive, 1);
  assert.deepEqual(calls.map(({ href }) => href), [
    ROOT_URL,
    'https://stats.whoajor.com/assets/vendor.js',
    'https://stats.whoajor.com/assets/app.js',
    'https://stats.whoajor.com/assets/lazy.js',
  ]);
  assert.deepEqual(sleeps, [7, 7, 7]);
  for (const { href, options } of calls) {
    assert.equal(options.method, 'GET');
    assert.match(options.headers['user-agent'], /whoajor-spa-audit/);
    assert.doesNotMatch(new URL(href).pathname, /^\/api\//);
  }
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.policy.requestCount, 4);
  assert.equal(manifest.policy.bodyReadMethod, 'Response.arrayBuffer');
  assert.equal(manifest.policy.uniqueResourceCount, 4);
  assert.equal(manifest.policy.duplicateRequestCount, 0);
  assert.equal(manifest.policy.sequential, true);
  assert.equal(manifest.policy.apiRequestCount, 0);
  assert.equal(manifest.policy.postRequestCount, 0);
  assert.equal(manifest.policy.crossOriginRequestCount, 0);
  assert.deepEqual(manifest.requestOrder, calls.map(({ href }) => href));
  assert.deepEqual(manifest.requestUserAgents, calls.map(() => (
    'ushibu-nogami-whoajor-spa-audit/1.0 (+offline-test)'
  )));
  assert.deepEqual(manifest.enforcedDelayBeforeMs, [0, 7, 7, 7]);
  assert.equal(manifest.recovery, null);
  assert.deepEqual(manifest.assetGraph.rootScripts, [
    'https://stats.whoajor.com/assets/app.js',
  ]);
  assert.equal(manifest.excludedReferences.some(({ url, reason }) => (
    url === 'https://static.cloudflareinsights.com/beacon.min.js'
      && /cross-origin.*same-origin scope/i.test(reason)
  )), true);
  assert.deepEqual(manifest.assetGraph.edges, [
    {
      from: ROOT_URL,
      kind: 'html-modulepreload',
      to: 'https://stats.whoajor.com/assets/vendor.js',
    },
    {
      from: ROOT_URL,
      kind: 'html-script',
      to: 'https://stats.whoajor.com/assets/app.js',
    },
    {
      from: 'https://stats.whoajor.com/assets/app.js',
      kind: 'static-import',
      to: 'https://stats.whoajor.com/assets/vendor.js',
    },
    {
      from: 'https://stats.whoajor.com/assets/app.js',
      kind: 'dynamic-import',
      to: 'https://stats.whoajor.com/assets/lazy.js',
    },
    {
      from: 'https://stats.whoajor.com/assets/lazy.js',
      kind: 'static-import',
      to: 'https://stats.whoajor.com/assets/app.js',
    },
  ]);
  const vendor = manifest.assets.find(({ url }) => url.endsWith('/vendor.js'));
  assert.deepEqual(await readFile(join(auditDir, vendor.blob)), assets.get(vendor.url).body);
  assert.equal(vendor.bytes, assets.get(vendor.url).body.byteLength);
});

test('offline verifier независимо сверяет exact blobs, graph, 16 GET families и POST exclusion', async (t) => {
  const { auditDir } = await buildFixtureAudit(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline verifier attempted network access'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await verifySpaSurfaceAudit(auditDir);

  assert.deepEqual(result, {
    status: 'complete',
    auditId: '2026-08-30-spa-surface-audit',
    assetRootHash: result.assetRootHash,
    assets: 4,
    javascriptAssets: 3,
    apiOccurrences: 2,
    getFamilies: 16,
    exclusions: 1,
    contractVersion: '1.1.0',
  });
  assert.match(result.assetRootHash, /^[a-f0-9]{64}$/);
});

test('offline verifier учитывает единственный root header-recovery GET без повторного asset crawl', async (t) => {
  const { auditDir } = await buildFixtureAudit(t, { rootRecovery: true });

  const result = await verifySpaSurfaceAudit(auditDir);
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));

  assert.equal(result.assets, 4);
  assert.equal(manifest.policy.requestCount, 5);
  assert.equal(manifest.policy.uniqueResourceCount, 4);
  assert.equal(manifest.policy.duplicateRequestCount, 1);
  assert.equal(manifest.policy.delayMs, null);
  assert.equal(manifest.policy.userAgent, null);
  assert.deepEqual(manifest.requestOrder.slice(-1), [ROOT_URL]);
  assert.deepEqual(manifest.enforcedDelayBeforeMs, [0, 7, 7, 7, 0]);
  assert.match(manifest.requestUserAgents.at(-1), /header-recovery/);
  assert.equal(manifest.recovery.initialAndRecoveryShaMatch, true);
});

test('offline verifier требует exact byte-read method в capture policy', async (t) => {
  const { auditDir } = await buildFixtureAudit(t);
  const manifestPath = join(auditDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.policy.bodyReadMethod = 'Response.text';
  await writeFile(manifestPath, `${stableStringify(manifest)}\n`);

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /bodyReadMethod|byte-read method/i,
  );
});

test('offline verifier отклоняет audit directory symlink и вложенные artifact symlinks', async (t) => {
  const linkedAudit = await buildFixtureAudit(t);
  const linkedRoot = await mkdtemp(join(tmpdir(), 'whoajor-spa-linked-root-'));
  t.after(() => rm(linkedRoot, { recursive: true, force: true }));
  await symlink(
    linkedAudit.auditDir,
    join(linkedRoot, basename(linkedAudit.auditDir)),
    'dir',
  );
  await assert.rejects(
    verifyPublishedSpaSurfaceAudits(linkedRoot),
    /real directory|symlink/i,
  );

  for (const selectPath of [
    () => 'manifest.json',
    () => 'report.json',
    (manifest) => manifest.assets.find(({ kind }) => kind === 'javascript').blob,
  ]) {
    const fixture = await buildFixtureAudit(t);
    const manifest = JSON.parse(await readFile(join(fixture.auditDir, 'manifest.json'), 'utf8'));
    const relativePath = selectPath(manifest);
    const artifactPath = join(fixture.auditDir, relativePath);
    const externalRoot = await mkdtemp(join(tmpdir(), 'whoajor-spa-external-artifact-'));
    t.after(() => rm(externalRoot, { recursive: true, force: true }));
    const externalPath = join(externalRoot, basename(relativePath));
    await copyFile(artifactPath, externalPath);
    await unlink(artifactPath);
    await symlink(externalPath, artifactPath);

    await assert.rejects(
      verifySpaSurfaceAudit(fixture.auditDir),
      /regular file|symlink/i,
    );
  }
});

test('offline verifier не может пройти на пустом или неполном audit', async (t) => {
  const container = await mkdtemp(join(tmpdir(), 'whoajor-spa-empty-'));
  t.after(() => rm(container, { recursive: true, force: true }));
  await assert.rejects(
    verifySpaSurfaceAudit(container),
    /manifest\.json.*missing|unreadable/i,
  );

  const { auditDir } = await buildFixtureAudit(t, { noReport: true });
  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /report\.json.*missing|unreadable/i,
  );
});

test('offline verifier отклоняет изменённые exact bytes даже при прежнем имени blob', async (t) => {
  const { auditDir } = await buildFixtureAudit(t);
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));
  const app = manifest.assets.find(({ url }) => url.endsWith('/app.js'));
  await writeFile(join(auditDir, app.blob), 'tampered');

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /exact bytes|SHA-256|byte count/i,
  );
});

test('offline verifier отклоняет пропущенный transitive JavaScript chunk', async (t) => {
  const { auditDir } = await buildFixtureAudit(t);
  const manifest = JSON.parse(await readFile(join(auditDir, 'manifest.json'), 'utf8'));
  const lazy = manifest.assets.find(({ url }) => url.endsWith('/lazy.js'));
  const { unlink } = await import('node:fs/promises');
  await unlink(join(auditDir, lazy.blob));

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /lazy\.js.*missing|blob.*missing/i,
  );
});

test('offline verifier блокирует новый unmapped GET даже с заново захешированным asset graph', async (t) => {
  const { auditDir } = await buildFixtureAudit(t, { extraGet: true });

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /API occurrence inventory.*unmapped|unknown API occurrence/i,
  );
});

test('offline verifier блокирует новый helper GET без нового /api/ literal', async (t) => {
  const { auditDir } = await buildFixtureAudit(t, { extraHelperGet: true });

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /GET helper call-site inventory|unmapped GET template/i,
  );
});

test('offline verifier блокирует unmapped GET через ESM export/import alias в другом chunk', async (t) => {
  const { auditDir } = await buildFixtureAudit(t, { extraAliasedHelperGet: true });

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /GET helper alias.*unmapped|unmapped GET template/i,
  );
});

test('offline verifier блокирует unmapped GET через bounded named re-export chain', async (t) => {
  const { auditDir } = await buildFixtureAudit(t, { extraReExportedHelperGet: true });

  await assert.rejects(
    verifySpaSurfaceAudit(auditDir),
    /GET helper alias.*unmapped|unmapped GET template/i,
  );
});

test('offline verifier сверяет static path tokens и fixedQuery с family call-site', async (t) => {
  const fixture = await buildFixtureAudit(t);
  const reportPath = join(fixture.auditDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const metaCall = report.getCallSites.find(({ family }) => family === 'meta');
  const tagsCall = report.getCallSites.find(({ family }) => family === 'tags');
  [metaCall.family, tagsCall.family] = [tagsCall.family, metaCall.family];
  const metaFamily = report.families.find(({ id }) => id === 'meta');
  const tagsFamily = report.families.find(({ id }) => id === 'tags');
  [metaFamily.evidence.path, tagsFamily.evidence.path] = [
    tagsFamily.evidence.path,
    metaFamily.evidence.path,
  ];
  await rewriteReportAndPin(fixture.auditDir, report);

  await assert.rejects(
    verifySpaSurfaceAudit(fixture.auditDir),
    /static path|fixedQuery.*call-site/i,
  );
});

test('offline verifier pins observed SPA trends query top=10 отдельно от collection semantics', async (t) => {
  const fixture = await buildFixtureAudit(t);
  const reportPath = join(fixture.auditDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.families.find(({ id }) => id === 'trends').observed.fixedUiQuery.top = 20;
  await rewriteReportAndPin(fixture.auditDir, report);

  await assert.rejects(
    verifySpaSurfaceAudit(fixture.auditDir),
    /trends.*fixed UI query.*top.*10|observed.*top=10/i,
  );
});

test('offline verifier требует exact ESM alias path, а не ручную family mapping', async (t) => {
  const fixture = await buildFixtureAudit(t);
  const reportPath = join(fixture.auditDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const trends = report.families.find(({ id }) => id === 'trends');
  trends.evidence.path = trends.evidence.path.filter((id) => id !== 'get-helper-export-dt-as-m');
  await rewriteReportAndPin(fixture.auditDir, report);

  await assert.rejects(
    verifySpaSurfaceAudit(fixture.auditDir),
    /trends path evidence omits ESM named-export binding dt as m/i,
  );
});

test('offline verifier требует точные 16 CONTRACT v1.1 families и явный POST tags exclusion', async (t) => {
  const missingFamily = await buildFixtureAudit(t);
  const reportPath = join(missingFamily.auditDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.families = report.families.filter(({ id }) => id !== 'weaponSplits');
  await rewriteReportAndPin(missingFamily.auditDir, report);
  await assert.rejects(
    verifySpaSurfaceAudit(missingFamily.auditDir),
    /16 CONTRACT v1\.1 families|family inventory/i,
  );

  const missingExclusion = await buildFixtureAudit(t);
  const secondReportPath = join(missingExclusion.auditDir, 'report.json');
  const secondReport = JSON.parse(await readFile(secondReportPath, 'utf8'));
  secondReport.exclusions = [];
  await rewriteReportAndPin(missingExclusion.auditDir, secondReport);
  await assert.rejects(
    verifySpaSurfaceAudit(missingExclusion.auditDir),
    /POST.*tags.*exclusion/i,
  );
});

test('published surface gate не проходит без audit и проверяет каждый найденный append-only audit', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'whoajor-spa-published-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(
    verifyPublishedSpaSurfaceAudits(empty),
    /at least one published SPA surface audit/i,
  );

  const first = await buildFixtureAudit(t);
  const result = await verifyPublishedSpaSurfaceAudits(dirname(first.auditDir));
  assert.equal(result.status, 'complete');
  assert.equal(result.auditCount, 1);
  assert.deepEqual(result.audits.map(({ auditId }) => auditId), [
    '2026-08-30-spa-surface-audit',
  ]);
});

test('published surface gate сверяет source-summary pin с exact manifest/report', async (t) => {
  const fixture = await buildFixtureAudit(t);
  const sourceRoot = await mkdtemp(join(tmpdir(), 'whoajor-spa-sources-'));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const summaryPath = join(sourceRoot, '2026-08-30-whoajor-spa-surface-audit.md');
  const correctPin = await sourceSummaryPinFor(fixture.auditDir);
  await writeFile(summaryPath, sourceSummaryText({
    ...correctPin,
    assetRootHash: '0'.repeat(64),
  }));

  await assert.rejects(
    verifyPublishedSpaSurfaceAudits(dirname(fixture.auditDir), {
      sourceSummariesRoot: sourceRoot,
    }),
    /source summary.*stale|summary pin/i,
  );

  await writeFile(summaryPath, sourceSummaryText(correctPin));
  const result = await verifyPublishedSpaSurfaceAudits(dirname(fixture.auditDir), {
    sourceSummariesRoot: sourceRoot,
  });
  assert.equal(result.sourceSummariesVerified, 1);
});
