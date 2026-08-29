#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT } from './lib/contract.mjs';
import { createHttpClient } from './lib/http-client.mjs';
import {
  createSnapshot, finalizeManifest, loadSnapshot, storeResponse,
} from './lib/raw-store.mjs';
import { discoverPlayers, discoverWeapons } from './lib/discovery.mjs';
import { WHOAJOR_BASE_URL, DEFAULT_DELAY_MS } from './config.mjs';

function actualType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function typeMatches(value, expected) {
  return expected.split('|').includes(actualType(value));
}

function validateRequired(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [field, expected] of Object.entries(required)) {
    if (!typeMatches(value[field], expected)) {
      throw new Error(`${label}.${field} must be ${expected}; got ${actualType(value[field])}`);
    }
  }
}

function validateRows(rows, required, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  rows.forEach((row, index) => validateRequired(row, required, `${label}[${index}]`));
}

function validatePayload(name, payload) {
  const descriptor = CONTRACT.endpoints[name];
  if (!descriptor) throw new Error(`unknown contract endpoint ${name}`);

  if (descriptor.responseKind === 'array') {
    validateRows(payload, descriptor.required, name);
  } else if (descriptor.responseKind === 'object') {
    validateRequired(payload, descriptor.required, name);
  } else if (descriptor.responseKind === 'envelope') {
    validateRequired(payload, descriptor.required, name);
    validateRows(payload[descriptor.itemsField], descriptor.itemRequired, `${name}.${descriptor.itemsField}`);
  }

  if (name === 'meta') validateRows(payload.maps, CONTRACT.entities.metaMap.required, 'meta.maps');
  if (name === 'draftConfig') {
    validateRows(payload.players, CONTRACT.entities.draftPlayer.required, 'draftConfig.players');
  }
  if (name === 'matchDetail') {
    validateRows(payload.rounds, CONTRACT.entities.matchRound.required, 'matchDetail.rounds');
    validateRows(payload.players, CONTRACT.entities.matchPlayer.required, 'matchDetail.players');
    payload.players.forEach((player, playerIndex) => {
      validateRows(
        player.perRound,
        CONTRACT.entities.playerRound.required,
        `matchDetail.players[${playerIndex}].perRound`,
      );
    });
  }
  return payload;
}

function parsePayload(name, body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`${name} response is not valid JSON: ${error.message}`, { cause: error });
  }
  return validatePayload(name, payload);
}

function renderPath(template, values) {
  return Object.entries(values).reduce(
    (path, [key, value]) => path.replace(`{${key}}`, String(value)),
    template,
  );
}

function existingEntry(snapshot, path, query) {
  const queryEntries = Object.entries(query);
  return snapshot.manifest.requests.find((entry) => (
    entry.path === path
      && Object.keys(entry.query).length === queryEntries.length
      && queryEntries.every(([key, value]) => String(entry.query[key]) === String(value))
  ));
}

function matchingEntries(snapshot, path, query) {
  const queryEntries = Object.entries(query);
  return snapshot.manifest.requests.filter((entry) => (
    entry.path === path
      && Object.keys(entry.query).length === queryEntries.length
      && queryEntries.every(([key, value]) => String(entry.query[key]) === String(value))
  ));
}

async function readEntryBody(snapshot, entry) {
  return readFile(join(snapshot.root, entry.blob), 'utf8');
}

async function requestPayload(snapshot, client, name, path, query = {}, { reuse = false } = {}) {
  const stored = reuse ? existingEntry(snapshot, path, query) : null;
  let body;
  if (stored) {
    body = await readEntryBody(snapshot, stored);
  } else {
    const response = await client.get(path, query);
    await storeResponse(snapshot, response);
    body = response.body;
  }
  return parsePayload(name, body);
}

async function boundaryPayload(snapshot, client, name, path, query, label) {
  const response = await client.get(path, query);
  await storeResponse(snapshot, response, { allowConflict: true });
  const changed = new Set(
    matchingEntries(snapshot, path, query).map(({ bodySha256 }) => bodySha256),
  ).size > 1;
  const payload = parsePayload(name, response.body);
  if (changed) return { changed: true, message: `${label} changed during collection` };
  return { changed: false, payload };
}

function setFailure(snapshot, type, message) {
  snapshot.manifest.failure = { type, message };
}

async function finishUnstable(snapshot, message) {
  setFailure(snapshot, 'boundary-drift', message);
  return finalizeManifest(snapshot, 'unstable');
}

function validatePageSize(pageSize) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('pageSize must be a positive integer');
  }
  return pageSize;
}

export async function collectSnapshot({
  outputDir,
  client,
  now = () => new Date(),
  pageSize = 100,
  resume = false,
} = {}) {
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    throw new TypeError('outputDir is required');
  }
  if (!client || typeof client.get !== 'function') throw new TypeError('client.get is required');
  const limit = validatePageSize(pageSize);
  const startedAt = now().toISOString();
  const snapshot = resume
    ? await loadSnapshot(outputDir)
    : await createSnapshot(outputDir, {
      snapshotId: basename(outputDir),
      contractVersion: CONTRACT.version,
      startedAt,
    });
  snapshot.manifest.status = 'staging';
  delete snapshot.manifest.failure;

  try {
    const meta = await requestPayload(
      snapshot, client, 'meta', CONTRACT.endpoints.meta.path, {}, { reuse: resume },
    );
    const tags = await requestPayload(
      snapshot, client, 'tags', CONTRACT.endpoints.tags.path, {}, { reuse: resume },
    );
    const draftConfig = await requestPayload(
      snapshot, client, 'draftConfig', CONTRACT.endpoints.draftConfig.path, {}, { reuse: resume },
    );

    const matchesById = new Map();
    let stableTotal = null;
    let offset = 0;
    while (true) {
      const query = { limit, offset };
      const page = await requestPayload(
        snapshot, client, 'matches', CONTRACT.endpoints.matches.path, query, { reuse: resume },
      );
      if (stableTotal === null) stableTotal = page.total;
      if (page.total !== stableTotal) {
        return finishUnstable(
          snapshot,
          `matches total changed from ${stableTotal} to ${page.total} at offset ${offset}`,
        );
      }

      const before = matchesById.size;
      for (const row of page.matches) matchesById.set(row.id, row);
      if (matchesById.size === stableTotal) break;
      if (matchesById.size > stableTotal) {
        return finishUnstable(snapshot, `unique match count exceeded stable total ${stableTotal}`);
      }
      if (page.matches.length === 0 || matchesById.size === before) {
        return finishUnstable(
          snapshot,
          `match pagination stopped advancing before stable total ${stableTotal}`,
        );
      }
      offset += Math.max(1, limit - 1);
    }

    if (meta.matches !== stableTotal) {
      return finishUnstable(
        snapshot,
        `meta matches ${meta.matches} differs from matches total ${stableTotal}`,
      );
    }

    const matchDetails = [];
    for (const matchId of [...matchesById.keys()].sort()) {
      const path = renderPath(CONTRACT.endpoints.matchDetail.path, { matchId });
      matchDetails.push(await requestPayload(
        snapshot, client, 'matchDetail', path, {}, { reuse: resume },
      ));
    }

    const leaderboard = await requestPayload(
      snapshot, client, 'leaderboard', CONTRACT.endpoints.leaderboard.path, {}, { reuse: resume },
    );
    const players = discoverPlayers({ leaderboard, draftConfig, matchDetails });
    for (const steamid of players) {
      const pathValues = { steamid };
      await requestPayload(snapshot, client, 'playerSummary', renderPath(
        CONTRACT.endpoints.playerSummary.path, pathValues,
      ), {}, { reuse: resume });
      await requestPayload(snapshot, client, 'playerMaps', renderPath(
        CONTRACT.endpoints.playerMaps.path, pathValues,
      ), {}, { reuse: resume });
      await requestPayload(snapshot, client, 'playerWeapons', renderPath(
        CONTRACT.endpoints.playerWeapons.path, pathValues,
      ), {}, { reuse: resume });
      await requestPayload(snapshot, client, 'playerWeaponsByDay', renderPath(
        CONTRACT.endpoints.playerWeaponsByDay.path, pathValues,
      ), CONTRACT.endpoints.playerWeaponsByDay.fixedQuery, { reuse: resume });
      await requestPayload(snapshot, client, 'playerMatches', renderPath(
        CONTRACT.endpoints.playerMatches.path, pathValues,
      ), {}, { reuse: resume });
    }

    const weaponIndex = await requestPayload(
      snapshot, client, 'weapons', CONTRACT.endpoints.weapons.path, {}, { reuse: resume },
    );
    const weapons = discoverWeapons({ weapons: weaponIndex });
    for (const weapon of weapons) {
      const pathValues = { weapon };
      await requestPayload(snapshot, client, 'weaponDetail', renderPath(
        CONTRACT.endpoints.weaponDetail.path, pathValues,
      ), {}, { reuse: resume });
      await requestPayload(snapshot, client, 'weaponDetailByDay', renderPath(
        CONTRACT.endpoints.weaponDetailByDay.path, pathValues,
      ), CONTRACT.endpoints.weaponDetailByDay.fixedQuery, { reuse: resume });
    }
    await requestPayload(
      snapshot, client, 'weaponSplits', CONTRACT.endpoints.weaponSplits.path, {}, { reuse: resume },
    );

    const endMeta = await boundaryPayload(
      snapshot, client, 'meta', CONTRACT.endpoints.meta.path, {}, 'meta',
    );
    if (endMeta.changed) return finishUnstable(snapshot, endMeta.message);
    const endHead = await boundaryPayload(
      snapshot,
      client,
      'matches',
      CONTRACT.endpoints.matches.path,
      { limit, offset: 0 },
      'match head',
    );
    if (endHead.changed) return finishUnstable(snapshot, endHead.message);

    snapshot.manifest.sourceCounts = {
      matches: matchesById.size,
      matchDetails: matchDetails.length,
      players: players.length,
      weapons: weapons.length,
      tags: tags.length,
    };
    snapshot.manifest.discovered = { players, weapons };
    snapshot.manifest.finishedAt = now().toISOString();
    return finalizeManifest(snapshot, 'collected');
  } catch (error) {
    setFailure(snapshot, 'collection-error', error.message);
    await finalizeManifest(snapshot, 'incomplete');
    throw error;
  }
}

function parseInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`);
  return parsed;
}

export function parseCliArgs(args) {
  const options = {
    baseUrl: WHOAJOR_BASE_URL,
    delayMs: DEFAULT_DELAY_MS,
    pageSize: 100,
    resume: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--resume') {
      options.resume = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    index += 1;
    if (option === '--output') options.outputDir = value;
    else if (option === '--base-url') options.baseUrl = value;
    else if (option === '--delay-ms') options.delayMs = parseInteger(value, option);
    else if (option === '--page-size') options.pageSize = parseInteger(value, option);
    else throw new Error(`unknown option ${option}`);
  }
  if (!options.outputDir) throw new Error('--output is required');
  if (options.pageSize < 1) throw new Error('--page-size must be a positive integer');
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const client = createHttpClient({ baseUrl: options.baseUrl, delayMs: options.delayMs });
  const manifest = await collectSnapshot({
    outputDir: options.outputDir,
    client,
    pageSize: options.pageSize,
    resume: options.resume,
  });
  process.stdout.write(`${JSON.stringify({
    status: manifest.status,
    requests: manifest.requests.length,
    rootHash: manifest.rootHash,
  })}\n`);
  if (manifest.status !== 'collected') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
