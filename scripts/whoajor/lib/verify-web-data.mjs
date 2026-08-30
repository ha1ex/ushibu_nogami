import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CANONICAL_ROOT, RECENT_WINDOW, VERSION } from './web-data.mjs';

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSafeValues(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValues(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'source_json') throw new Error(`source_json leaked at ${path}.${key}`);
    if (/steamids$/i.test(key)) {
      if (!Array.isArray(nested) || nested.some((item) => typeof item !== 'string')) {
        throw new Error(`SteamID array is not string-safe at ${path}.${key}`);
      }
    } else if (/steamid$/i.test(key) && nested !== null && typeof nested !== 'string') {
      throw new Error(`SteamID is not a string at ${path}.${key}`);
    }
    assertSafeValues(nested, `${path}.${key}`);
  }
}

function assertUnique(rows, dataset, grain) {
  const seen = new Set();
  for (const row of rows) {
    const key = grain(row);
    if (seen.has(key)) throw new Error(`${dataset} duplicate logical row: ${key}`);
    seen.add(key);
  }
}

export async function verifyWebData({ outputDir, sourceGzip }) {
  const currentBytes = await readFile(join(outputDir, 'current.json'));
  const current = JSON.parse(currentBytes.toString('utf8'));
  if (current.root !== CANONICAL_ROOT || current.version !== VERSION) {
    throw new Error('current pointer root/version mismatch');
  }
  const manifestPath = join(outputDir, current.manifest);
  const manifestBytes = await readFile(manifestPath);
  if (sha256Bytes(manifestBytes) !== current.manifestSha256) {
    throw new Error('manifest SHA mismatch');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.root !== CANONICAL_ROOT || manifest.contractVersion !== '1.1.0') {
    throw new Error('manifest canonical root/contract mismatch');
  }
  if (manifest.window.recentStart !== RECENT_WINDOW.recentStart
    || manifest.window.recentEnd !== RECENT_WINDOW.recentEnd) {
    throw new Error('manifest recent window mismatch');
  }
  if (sourceGzip && await sha256File(sourceGzip) !== manifest.source.gzipSha256) {
    throw new Error('canonical gzip SHA mismatch');
  }
  const expectedHashes = {
    gzipSha256: '917af8cec282dc68fa00ffbcbd2117b0b4587c02da0313ebe8359f7fca8b1234',
    sqliteSha256: '0cc8105931ef2491c29504eb5b0ef115d77090def76bd0adcf1b3ab5fff2d4a1',
    dataFingerprint: '5a0e563128ab92cc2bad823852850c2fd3668155120f216a0116694b4de578a7',
  };
  for (const [field, expected] of Object.entries(expectedHashes)) {
    if (manifest.source[field] !== expected) throw new Error(`canonical ${field} mismatch`);
  }

  const rowsByDataset = new Map();
  let maxGzipBytes = 0;
  const versionDir = join(outputDir, current.version);
  for (const asset of manifest.assets) {
    const safePath = normalize(asset.path);
    if (isAbsolute(asset.path) || safePath.startsWith('..') || !safePath.startsWith('data/')) {
      throw new Error(`unsafe asset path: ${asset.path}`);
    }
    const bytes = await readFile(join(versionDir, safePath));
    if (sha256Bytes(bytes) !== asset.sha256) throw new Error(`asset SHA mismatch: ${asset.path}`);
    if (bytes.length !== asset.bytes) throw new Error(`asset byte count mismatch: ${asset.path}`);
    const gzipBytes = gzipSync(bytes, { mtime: 0 }).length;
    if (gzipBytes !== asset.gzipBytes) throw new Error(`asset gzip count mismatch: ${asset.path}`);
    if (gzipBytes > 500 * 1024) throw new Error(`asset exceeds 500 KiB gzip: ${asset.path}`);
    maxGzipBytes = Math.max(maxGzipBytes, gzipBytes);
    const payload = JSON.parse(bytes.toString('utf8'));
    if (payload.root !== CANONICAL_ROOT || payload.dataset !== asset.dataset) {
      throw new Error(`asset envelope mismatch: ${asset.path}`);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length !== asset.count) {
      throw new Error(`asset row count mismatch: ${asset.path}`);
    }
    assertSafeValues(payload);
    if (!rowsByDataset.has(asset.dataset)) rowsByDataset.set(asset.dataset, []);
    rowsByDataset.get(asset.dataset).push(...payload.rows);
  }
  const requiredCounts = {
    players: manifest.counts.players,
    matches: manifest.counts.matches,
    matchRounds: manifest.counts.rounds,
    maps: manifest.counts.maps,
    weapons: manifest.counts.weapons,
    trendPlayers: manifest.counts.trendPlayers,
    trendMatches: manifest.counts.trendMatches,
    playerRounds: manifest.counts.playerRounds,
    matchPlayerWeapons: manifest.counts.matchPlayerWeapons,
    playerClutches: manifest.counts.playerClutches,
  };
  for (const [dataset, expected] of Object.entries(requiredCounts)) {
    if (rowsByDataset.get(dataset)?.length !== expected) {
      throw new Error(`${dataset} source count mismatch`);
    }
  }
  const grains = {
    matchPlayerWeapons: (row) => `${row.matchId}|${row.steamid}|${row.weapon}`,
    playerWeaponStats: (row) => `${row.steamid}|${row.weapon}`,
    playerWeaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponDailyStats: (row) => `${row.steamid}|${row.weapon}|${row.day}`,
    weaponSplits: (row) => `${row.steamid}|${row.weapon}`,
  };
  for (const [dataset, grain] of Object.entries(grains)) {
    assertUnique(rowsByDataset.get(dataset) ?? [], dataset, grain);
  }
  const rosters = rowsByDataset.get('rosters') ?? [];
  const rosterPlayers = rosters.flatMap(({ players }) => players);
  if (rosters.length !== 5 || rosterPlayers.length !== 30
    || new Set(rosterPlayers.map(({ steamid }) => steamid)).size !== 30
    || rosterPlayers.some(({ mapped }) => mapped !== true)) {
    throw new Error('roster mapping is not 30/30');
  }
  const evidenceIds = new Set((rowsByDataset.get('evidence') ?? []).map(({ id }) => id));
  const recommendations = rowsByDataset.get('recommendations') ?? [];
  if (recommendations.length !== 4) throw new Error('recommendations count mismatch');
  for (const plan of recommendations) {
    if (plan.snapshotRoot !== CANONICAL_ROOT) throw new Error('recommendations root mismatch');
    if (plan.reviewed !== true) throw new Error('recommendations must be reviewed');
    if (plan.dataThrough !== RECENT_WINDOW.recentEnd) throw new Error('recommendations are stale');
    const references = [
      ...plan.threatEvidence, ...plan.weaknessEvidence, ...plan.mapEvidence,
      ...plan.caveats.map(({ evidenceId }) => evidenceId),
    ];
    const missing = references.filter((id) => !evidenceIds.has(id));
    if (missing.length) throw new Error(`recommendations missing evidence: ${missing.join(', ')}`);
  }
  return {
    status: 'ok',
    root: CANONICAL_ROOT,
    assets: manifest.assets.length,
    maxGzipBytes,
    rosterMapping: `${rosterPlayers.length}/30`,
    evidence: evidenceIds.size,
    recommendations: recommendations.length,
  };
}
