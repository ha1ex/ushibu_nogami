import {
  mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalStringify, sha256Hex } from './canonical-json.mjs';
import { CONTRACT } from './contract.mjs';
import { createHttpClient } from './http-client.mjs';
import { loadSnapshot } from './raw-store.mjs';
import { DEFAULT_DELAY_MS, WHOAJOR_BASE_URL } from '../config.mjs';

export const DEFAULT_MINIMUM_SAMPLE_SIZE = 30;
export const ENDPOINT_FAMILIES = Object.freeze(Object.keys(CONTRACT.endpoints));
export const SAMPLING_SELECTION_ALGORITHM = Object.freeze({
  mandatoryCoverage: 'all CONTRACT endpoint families + first/last match pages + oldest/newest/lexicographic-first/lexicographic-last match detail + map + non-empty relationship',
  score: 'sha256(snapshotId + identity)',
  target: 'max(30, ceil((matches + players + weapons) * 0.01))',
});

let temporaryReportSequence = 0;

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function exactQuery(query, expected) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return false;
  const actualEntries = Object.entries(query).sort(([left], [right]) => compareStrings(left, right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => compareStrings(left, right));
  return actualEntries.length === expectedEntries.length
    && actualEntries.every(([key, value], index) => (
      key === expectedEntries[index][0] && String(value) === String(expectedEntries[index][1])
    ));
}

function compileTemplate(template) {
  const names = [];
  const expression = template.split(/(\{[^}]+\})/g).map((part) => {
    const placeholder = part.match(/^\{([^}]+)\}$/);
    if (placeholder) {
      names.push(placeholder[1]);
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { names, pattern: new RegExp(`^${expression}$`) };
}

const FAMILY_MATCHERS = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACT.endpoints).map(([family, descriptor]) => [
    family,
    compileTemplate(descriptor.path),
  ]),
));

function matchingPath(family, path) {
  if (typeof path !== 'string') return null;
  const matcher = FAMILY_MATCHERS[family];
  const match = matcher.pattern.exec(path);
  if (!match) return null;
  const parameters = Object.fromEntries(
    matcher.names.map((name, index) => [name, match[index + 1]]),
  );
  if (parameters.steamid && !/^\d{17}$/.test(parameters.steamid)) return null;
  return parameters;
}

export function classifyEndpointFamily(path, query = {}) {
  for (const family of ENDPOINT_FAMILIES) {
    const descriptor = CONTRACT.endpoints[family];
    if (!matchingPath(family, path)) continue;

    if (family === 'matches') {
      if (!exactQuery(query, { limit: query.limit, offset: query.offset })) continue;
      const limit = String(query.limit);
      const offset = String(query.offset);
      if (!/^[1-9]\d*$/.test(limit) || !/^(?:0|[1-9]\d*)$/.test(offset)) continue;
      if (Object.keys(query).length !== 2) continue;
      return family;
    }

    if (family === 'trends') {
      if (!exactQuery(query, { top: query.top })) continue;
      if (!/^[1-9]\d*$/.test(String(query.top))) continue;
      if (Object.keys(query).length !== 1) continue;
      return family;
    }

    if (!exactQuery(query, descriptor.fixedQuery ?? {})) continue;
    return family;
  }
  return null;
}

function selectionIssue(code, message, details = {}) {
  return { code, message, ...details };
}

function validateMinimumSampleSize(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('minimumSampleSize must be a positive integer');
  }
  return value;
}

function sourceEntityCount(manifest, issues) {
  const fields = ['matches', 'players', 'weapons'];
  const values = fields.map((field) => manifest.sourceCounts?.[field]);
  if (!values.every((value) => Number.isInteger(value) && value >= 0)) {
    issues.push(selectionIssue(
      'INVALID_SOURCE_COUNTS',
      'manifest sourceCounts must contain non-negative integer matches, players, and weapons',
    ));
    return 0;
  }
  return values.reduce((total, value) => total + value, 0);
}

function candidatePriority(entry) {
  if (entry.boundaryRole === 'start') return 0;
  if (entry.boundaryRole === null) return 1;
  return 2;
}

function buildCandidates(snapshot, snapshotId, issues) {
  const byIdentity = new Map();
  for (const entry of snapshot.manifest.requests) {
    if (entry.boundaryRole === 'end') continue;
    const family = classifyEndpointFamily(entry.path, entry.query);
    if (!family) {
      issues.push(selectionIssue(
        'UNCLASSIFIED_REQUEST',
        `request is outside the exact CONTRACT endpoint families: ${entry.key}`,
        { identity: entry.key },
      ));
      continue;
    }
    const candidate = {
      identity: entry.key,
      family,
      score: sha256Hex(`${snapshotId}${entry.key}`),
      path: entry.path,
      query: { ...entry.query },
      boundaryRole: entry.boundaryRole,
      expectedCanonicalSha256: entry.canonicalSha256,
      blob: entry.blob,
    };
    const existing = byIdentity.get(candidate.identity);
    if (!existing || candidatePriority(entry) < candidatePriority(existing)) {
      byIdentity.set(candidate.identity, candidate);
    }
  }
  return [...byIdentity.values()].sort((left, right) => (
    compareStrings(left.score, right.score) || compareStrings(left.identity, right.identity)
  ));
}

function lowestScored(candidates) {
  return [...candidates].sort((left, right) => (
    compareStrings(left.score, right.score) || compareStrings(left.identity, right.identity)
  ))[0] ?? null;
}

function matchDetailId(candidate) {
  return candidate.path.slice('/api/matches/'.length);
}

async function detailBoundaries(snapshot, details, issues) {
  const dated = [];
  for (const candidate of details) {
    let payload;
    try {
      payload = JSON.parse(await readFile(join(snapshot.root, candidate.blob), 'utf8'));
    } catch (error) {
      issues.push(selectionIssue(
        'INVALID_MATCH_DETAIL_BODY',
        `cannot read match detail needed for sampling: ${candidate.identity}`,
        { identity: candidate.identity, detail: error.message },
      ));
      continue;
    }
    const timestamp = Date.parse(payload.startedAt);
    if (!Number.isFinite(timestamp)) {
      issues.push(selectionIssue(
        'INVALID_MATCH_DETAIL_DATE',
        `match detail has no valid startedAt: ${candidate.identity}`,
        { identity: candidate.identity },
      ));
      continue;
    }
    dated.push({ candidate, timestamp });
  }

  const temporal = [...dated].sort((left, right) => (
    left.timestamp - right.timestamp
      || compareStrings(matchDetailId(left.candidate), matchDetailId(right.candidate))
  ));
  const lexical = [...details].sort((left, right) => (
    compareStrings(matchDetailId(left), matchDetailId(right))
  ));
  return {
    oldest: temporal[0]?.candidate ?? null,
    newest: temporal.at(-1)?.candidate ?? null,
    lexicographicFirst: lexical[0] ?? null,
    lexicographicLast: lexical.at(-1) ?? null,
  };
}

function hasMapEvidence(family, payload) {
  if (family === 'meta') {
    return Array.isArray(payload?.maps)
      && payload.maps.some((row) => typeof row?.map === 'string' && row.map.length > 0);
  }
  if (family === 'matches') {
    return Array.isArray(payload?.matches)
      && payload.matches.some((row) => typeof row?.map === 'string' && row.map.length > 0);
  }
  if (family === 'matchDetail') return typeof payload?.map === 'string' && payload.map.length > 0;
  if (['playerMaps', 'playerMatches'].includes(family)) {
    return Array.isArray(payload)
      && payload.some((row) => typeof row?.map === 'string' && row.map.length > 0);
  }
  return false;
}

function hasNonEmptyRelationshipEvidence(family, payload) {
  if (family !== 'matchDetail') return false;
  return Array.isArray(payload?.players)
    && payload.players.length > 0
    && Array.isArray(payload?.rounds)
    && payload.rounds.length > 0
    && payload.players.some((player) => (
      (Array.isArray(player?.perRound) && player.perRound.length > 0)
        || (Array.isArray(player?.weapons) && player.weapons.length > 0)
    ));
}

async function dataEvidenceCandidates(snapshot, candidates, issues) {
  const maps = [];
  const relationships = [];
  for (const candidate of candidates) {
    let payload;
    try {
      payload = JSON.parse(await readFile(join(snapshot.root, candidate.blob), 'utf8'));
    } catch (error) {
      issues.push(selectionIssue(
        'INVALID_EVIDENCE_BODY',
        `cannot read candidate needed for data-evidence sampling: ${candidate.identity}`,
        { identity: candidate.identity, detail: error.message },
      ));
      continue;
    }
    if (hasMapEvidence(candidate.family, payload)) maps.push(candidate);
    if (hasNonEmptyRelationshipEvidence(candidate.family, payload)) relationships.push(candidate);
  }
  return {
    map: lowestScored(maps),
    nonEmptyRelationship: lowestScored(relationships),
  };
}

export async function selectSampleEntries(snapshot, {
  minimumSampleSize = DEFAULT_MINIMUM_SAMPLE_SIZE,
} = {}) {
  validateMinimumSampleSize(minimumSampleSize);
  if (!snapshot?.manifest || !Array.isArray(snapshot.manifest.requests)) {
    throw new TypeError('a loaded snapshot with manifest requests is required');
  }

  const issues = [];
  const snapshotId = snapshot.manifest.snapshotId;
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    issues.push(selectionIssue('INVALID_SNAPSHOT_ID', 'manifest snapshotId must be a non-empty string'));
  }
  const entityCount = sourceEntityCount(snapshot.manifest, issues);
  const sampleTarget = Math.max(minimumSampleSize, Math.ceil(entityCount * 0.01));
  const candidates = buildCandidates(snapshot, String(snapshotId ?? ''), issues);
  const mandatoryReasons = new Map();
  const requireCandidate = (candidate, reason, missingCode, missingMessage) => {
    if (!candidate) {
      issues.push(selectionIssue(missingCode, missingMessage));
      return null;
    }
    const reasons = mandatoryReasons.get(candidate.identity) ?? new Set();
    reasons.add(reason);
    mandatoryReasons.set(candidate.identity, reasons);
    return candidate.identity;
  };

  const endpointFamilies = {};
  for (const family of ENDPOINT_FAMILIES) {
    const candidate = lowestScored(candidates.filter((item) => item.family === family));
    endpointFamilies[family] = requireCandidate(
      candidate,
      `endpoint-family:${family}`,
      'MISSING_ENDPOINT_FAMILY',
      `snapshot has no candidate for CONTRACT endpoint family ${family}`,
    );
  }

  const matchPages = candidates.filter(({ family }) => family === 'matches').sort((left, right) => (
    Number(left.query.offset) - Number(right.query.offset)
      || compareStrings(left.identity, right.identity)
  ));
  const matchIndexPages = {
    first: requireCandidate(
      matchPages[0] ?? null,
      'match-index:first',
      'MISSING_MATCH_INDEX_PAGE',
      'snapshot has no first match index page',
    ),
    last: requireCandidate(
      matchPages.at(-1) ?? null,
      'match-index:last',
      'MISSING_MATCH_INDEX_PAGE',
      'snapshot has no last match index page',
    ),
  };

  const details = candidates.filter(({ family }) => family === 'matchDetail');
  const detailCandidates = await detailBoundaries(snapshot, details, issues);
  const matchDetails = {};
  for (const [boundary, candidate] of Object.entries(detailCandidates)) {
    matchDetails[boundary] = requireCandidate(
      candidate,
      `match-detail:${boundary}`,
      'MISSING_MATCH_DETAIL_BOUNDARY',
      `snapshot has no ${boundary} match detail`,
    );
  }

  const evidenceCandidates = await dataEvidenceCandidates(snapshot, candidates, issues);
  const dataEvidence = {
    map: requireCandidate(
      evidenceCandidates.map,
      'data-evidence:map',
      'MISSING_MAP_EVIDENCE',
      'snapshot has no non-empty map-bearing candidate',
    ),
    nonEmptyRelationship: requireCandidate(
      evidenceCandidates.nonEmptyRelationship,
      'data-evidence:non-empty-relationship',
      'MISSING_RELATIONSHIP_EVIDENCE',
      'snapshot has no match detail with non-empty player/round relationship evidence',
    ),
  };

  if (candidates.length < sampleTarget) {
    issues.push(selectionIssue(
      'INSUFFICIENT_CANDIDATES',
      `snapshot has ${candidates.length} unique candidates, below sample target ${sampleTarget}`,
      { candidateCount: candidates.length, sampleTarget },
    ));
  }

  const selectedIdentities = new Set(mandatoryReasons.keys());
  for (const candidate of candidates) {
    if (selectedIdentities.size >= sampleTarget) break;
    selectedIdentities.add(candidate.identity);
  }
  const selected = candidates.filter(({ identity }) => selectedIdentities.has(identity)).map((candidate) => ({
    ...candidate,
    mandatoryReasons: [...(mandatoryReasons.get(candidate.identity) ?? [])].sort(compareStrings),
  }));

  return {
    entityCount,
    sampleTarget,
    candidateCount: candidates.length,
    selected,
    issues,
    coverage: {
      requiredEndpointFamilies: [...ENDPOINT_FAMILIES],
      endpointFamilies,
      missingEndpointFamilies: ENDPOINT_FAMILIES.filter((family) => !endpointFamilies[family]),
      dataEvidence,
      matchIndexPages,
      matchDetails,
    },
  };
}

export async function assertSamplingReport(snapshot, report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('sampling report must be an object');
  }
  const selection = await selectSampleEntries(snapshot);
  if (selection.issues.length > 0) {
    throw new Error(`sampling selection is incomplete: ${canonicalStringify(selection.issues)}`);
  }
  const checked = new Date(report.checkedAt);
  if (
    typeof report.checkedAt !== 'string'
      || Number.isNaN(checked.getTime())
      || checked.toISOString() !== report.checkedAt
  ) throw new Error('sampling report checkedAt must be an exact ISO timestamp');

  const expectedChecks = selection.selected.map((item) => ({
    identity: item.identity,
    family: item.family,
    path: item.path,
    query: item.query,
    score: item.score,
    selectionReasons: item.mandatoryReasons,
    expectedCanonicalSha256: item.expectedCanonicalSha256,
    actualCanonicalSha256: item.expectedCanonicalSha256,
    status: 'match',
    reason: null,
  }));
  const expected = {
    version: 1,
    snapshotId: snapshot.manifest.snapshotId,
    contractVersion: snapshot.manifest.contractVersion,
    rootHash: snapshot.manifest.rootHash,
    snapshotStatus: snapshot.manifest.status,
    status: 'complete',
    entityCount: selection.entityCount,
    sampleTarget: selection.sampleTarget,
    candidateCount: selection.candidateCount,
    selectedCount: selection.selected.length,
    selectionAlgorithm: SAMPLING_SELECTION_ALGORITHM,
    coverage: selection.coverage,
    reasons: [],
    checks: expectedChecks,
  };
  const { checkedAt: _checkedAt, ...actual } = report;
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error('sampling report differs from fresh offline deterministic selection or hashes');
  }
  if (report.selectedCount < report.sampleTarget) {
    throw new Error('sampling report selectedCount is below sampleTarget');
  }
  return selection;
}

async function writeReportAtomically(snapshotDir, report) {
  const destination = join(snapshotDir, 'sampling-report.json');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${temporaryReportSequence += 1}`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function checkedAt(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date');
  }
  return value.toISOString();
}

function mismatchReason(code, message, item, details = {}) {
  return selectionIssue(code, message, { identity: item.identity, ...details });
}

export async function verifySample({
  snapshotDir,
  client = null,
  baseUrl = WHOAJOR_BASE_URL,
  delayMs = DEFAULT_DELAY_MS,
  now = () => new Date(),
  minimumSampleSize = DEFAULT_MINIMUM_SAMPLE_SIZE,
} = {}) {
  if (typeof snapshotDir !== 'string' || snapshotDir.length === 0) {
    throw new TypeError('snapshotDir is required');
  }
  const snapshot = await loadSnapshot(snapshotDir);
  const selection = await selectSampleEntries(snapshot, { minimumSampleSize });
  const reasons = [...selection.issues];
  const allowedStatus = ['collected', 'complete'].includes(snapshot.manifest.status);
  if (!allowedStatus) {
    reasons.push(selectionIssue(
      'SNAPSHOT_STATUS_NOT_READY',
      `snapshot status must be collected or complete, got ${snapshot.manifest.status}`,
      { snapshotStatus: snapshot.manifest.status },
    ));
  }

  const httpClient = client ?? createHttpClient({ baseUrl, delayMs });
  if (!httpClient || typeof httpClient.get !== 'function') {
    throw new TypeError('client.get is required');
  }

  const checks = [];
  if (allowedStatus) {
    for (const item of selection.selected) {
      const check = {
        identity: item.identity,
        family: item.family,
        path: item.path,
        query: item.query,
        score: item.score,
        selectionReasons: item.mandatoryReasons,
        expectedCanonicalSha256: item.expectedCanonicalSha256,
        actualCanonicalSha256: null,
        status: 'mismatch',
        reason: null,
      };
      try {
        const response = await httpClient.get(item.path, item.query);
        const body = Buffer.isBuffer(response?.body)
          ? response.body.toString('utf8')
          : response?.body;
        if (typeof body !== 'string') throw new TypeError('client response body must be a string or Buffer');
        const payload = JSON.parse(body);
        check.actualCanonicalSha256 = sha256Hex(canonicalStringify(payload));
        if (check.actualCanonicalSha256 === check.expectedCanonicalSha256) {
          check.status = 'match';
        } else {
          check.reason = 'canonical JSON SHA-256 differs from the stored snapshot';
          reasons.push(mismatchReason(
            'CANONICAL_HASH_MISMATCH',
            check.reason,
            item,
            {
              expectedCanonicalSha256: check.expectedCanonicalSha256,
              actualCanonicalSha256: check.actualCanonicalSha256,
            },
          ));
        }
      } catch (error) {
        check.reason = error instanceof SyntaxError
          ? `live response is not valid JSON: ${error.message}`
          : `live request failed: ${error.message}`;
        reasons.push(mismatchReason(
          error instanceof SyntaxError ? 'LIVE_JSON_INVALID' : 'LIVE_REQUEST_FAILED',
          check.reason,
          item,
        ));
      }
      checks.push(check);
    }
  }

  const report = {
    version: 1,
    snapshotId: snapshot.manifest.snapshotId,
    contractVersion: snapshot.manifest.contractVersion,
    rootHash: snapshot.manifest.rootHash,
    snapshotStatus: snapshot.manifest.status,
    checkedAt: checkedAt(now),
    status: reasons.length === 0 ? 'complete' : 'unstable',
    entityCount: selection.entityCount,
    sampleTarget: selection.sampleTarget,
    candidateCount: selection.candidateCount,
    selectedCount: selection.selected.length,
    selectionAlgorithm: SAMPLING_SELECTION_ALGORITHM,
    coverage: selection.coverage,
    reasons,
    checks,
  };
  await writeReportAtomically(snapshotDir, report);
  return report;
}
