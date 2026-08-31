export const STATE_VERSION = 4;
export const HISTORY_LIMIT = 256;
export const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export class StateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateValidationError';
  }
}

function invalid(message) {
  throw new StateValidationError(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function dictionary() {
  return Object.create(null);
}

function copyDictionary(source, copyValue = (value) => value) {
  const target = dictionary();
  for (const key of Object.keys(source || {})) target[key] = copyValue(source[key]);
  return target;
}

function noteLength(value) {
  return Array.from(value).length;
}

function validScoreNumber(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 99);
}

function validateScore(value) {
  if (!hasExactKeys(value, ['ours', 'theirs', 'played']) ||
      !validScoreNumber(value.ours) || !validScoreNumber(value.theirs) || typeof value.played !== 'boolean') {
    invalid('invalid score value');
  }
  return { ours: value.ours, theirs: value.theirs, played: value.played };
}

export function deriveAllowedKeys(operations) {
  if (!isPlainObject(operations)) invalid('invalid operations source');
  const checks = new Set();
  const notes = new Set();
  const scores = new Set();
  for (const collectionName of ['matches', 'training', 'maps', 'opponents']) {
    const collection = operations[collectionName];
    if (!Array.isArray(collection)) invalid('invalid operations collection');
    for (const entity of collection) {
      for (const card of Array.isArray(entity.cards) ? entity.cards : []) {
        if (card && card.type === 'action' && typeof card.id === 'string') checks.add(card.id);
      }
    }
  }
  for (const match of operations.matches) {
    notes.add(`match-${match.id}-note`);
    scores.add(`match-${match.id}-score`);
  }
  for (const opponent of operations.opponents) notes.add(`opponent-${opponent.id}-note`);
  for (const map of operations.maps) notes.add(`map-${map.id}-note`);
  for (const training of operations.training) {
    checks.add(`training-${training.mapId}-report-complete`);
    notes.add(`training-${training.mapId}-report`);
  }
  return { checks, notes, scores };
}

export function validateMutation(value, allowlist) {
  if (!hasExactKeys(value, ['mutationId', 'operations'])) invalid('invalid mutation shape');
  if (typeof value.mutationId !== 'string' || !MUTATION_ID_PATTERN.test(value.mutationId)) {
    invalid('invalid mutationId');
  }
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 50) {
    invalid('invalid operations length');
  }
  const operations = value.operations.map((operation) => {
    if (!hasExactKeys(operation, ['type', 'key', 'value'])) invalid('invalid operation shape');
    if (typeof operation.key !== 'string' || operation.key.length > 128) invalid('invalid operation key (max 128)');
    if (operation.type === 'check.set') {
      if (!allowlist.checks.has(operation.key)) invalid('unknown check key');
      if (typeof operation.value !== 'boolean') invalid('check value must be boolean');
      return { type: operation.type, key: operation.key, value: operation.value };
    }
    if (operation.type === 'note.set') {
      if (!allowlist.notes.has(operation.key)) invalid('unknown note key');
      if (typeof operation.value !== 'string' || noteLength(operation.value) > 2000) invalid('invalid note value (max 2000)');
      return { type: operation.type, key: operation.key, value: operation.value };
    }
    if (operation.type === 'score.set') {
      if (!allowlist.scores.has(operation.key)) invalid('unknown score key');
      return { type: operation.type, key: operation.key, value: validateScore(operation.value) };
    }
    invalid('unknown operation type');
  });
  return { mutationId: value.mutationId, operations };
}

export function createEmptyDocument() {
  return {
    version: STATE_VERSION,
    revision: 0,
    checks: dictionary(),
    notes: dictionary(),
    scores: dictionary(),
    history: []
  };
}

function parseLegacyScore(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d?):(0|[1-9]\d?)$/.exec(value);
  if (!match) return null;
  const ours = Number(match[1]);
  const theirs = Number(match[2]);
  if (ours > 99 || theirs > 99) return null;
  return { ours, theirs, played: true };
}

export function convertV3(value, allowlist) {
  const allowedRoot = value && value.version === 3 ? ['version', 'checks', 'notes'] : ['checks', 'notes'];
  if (!hasExactKeys(value, allowedRoot) || !isPlainObject(value.checks) || !isPlainObject(value.notes)) {
    invalid('invalid v3 state document');
  }
  const document = createEmptyDocument();
  const report = { kept: { checks: [], notes: [], scores: [] }, dropped: [] };
  for (const key of Object.keys(value.checks).sort()) {
    const current = value.checks[key];
    if (!allowlist.checks.has(key)) report.dropped.push({ scope: 'checks', key, reason: 'unknown_key' });
    else if (current === true) {
      document.checks[key] = true;
      report.kept.checks.push(key);
    } else if (current !== false) report.dropped.push({ scope: 'checks', key, reason: 'incompatible_check' });
  }
  for (const key of Object.keys(value.notes).sort()) {
    const current = value.notes[key];
    if (allowlist.scores.has(key)) {
      const score = parseLegacyScore(current);
      if (score) {
        document.scores[key] = score;
        report.kept.scores.push(key);
      } else if (current !== '') report.dropped.push({ scope: 'notes', key, reason: 'incompatible_score' });
    } else if (!allowlist.notes.has(key)) {
      report.dropped.push({ scope: 'notes', key, reason: 'unknown_key' });
    } else if (typeof current === 'string' && current !== '' && noteLength(current) <= 2000) {
      document.notes[key] = current;
      report.kept.notes.push(key);
    } else if (current !== '') report.dropped.push({ scope: 'notes', key, reason: 'incompatible_note' });
  }
  report.dropped.sort((a, b) => `${a.scope}\0${a.key}\0${a.reason}`.localeCompare(`${b.scope}\0${b.key}\0${b.reason}`));
  return { document, report, migrated: true };
}

function parseV4(value, allowlist) {
  if (!hasExactKeys(value, ['version', 'revision', 'checks', 'notes', 'scores', 'history']) || value.version !== STATE_VERSION) {
    invalid('invalid v4 state document shape');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) invalid('invalid state revision');
  if (!isPlainObject(value.checks) || !isPlainObject(value.notes) || !isPlainObject(value.scores)) invalid('invalid state dictionaries');
  if (!Array.isArray(value.history) || value.history.length > HISTORY_LIMIT) invalid('invalid state history');
  const document = createEmptyDocument();
  document.revision = value.revision;
  for (const key of Object.keys(value.checks)) {
    if (!allowlist.checks.has(key) || value.checks[key] !== true) invalid('invalid check state key or value');
    document.checks[key] = true;
  }
  for (const key of Object.keys(value.notes)) {
    const note = value.notes[key];
    if (!allowlist.notes.has(key) || typeof note !== 'string' || note === '' || noteLength(note) > 2000) invalid('invalid note state key or value');
    document.notes[key] = note;
  }
  for (const key of Object.keys(value.scores)) {
    if (!allowlist.scores.has(key)) invalid('invalid score state key');
    document.scores[key] = validateScore(value.scores[key]);
  }
  const seen = new Set();
  if (value.history.length !== Math.min(value.revision, HISTORY_LIMIT)) invalid('invalid state history cardinality');
  if ((value.revision === 0) !== (value.history.length === 0)) invalid('invalid state history continuity');
  const firstRetainedRevision = value.revision - value.history.length + 1;
  document.history = value.history.map((entry, index) => {
    const expectedRevision = firstRetainedRevision + index;
    if (!hasExactKeys(entry, ['mutationId', 'revision']) || typeof entry.mutationId !== 'string' ||
        !MUTATION_ID_PATTERN.test(entry.mutationId) || seen.has(entry.mutationId) ||
        !Number.isSafeInteger(entry.revision) || entry.revision !== expectedRevision) invalid('invalid state history entry');
    seen.add(entry.mutationId);
    return { mutationId: entry.mutationId, revision: entry.revision };
  });
  return { document, report: null, migrated: false };
}

export function parseStoredDocument(value, allowlist) {
  if (isPlainObject(value) && (value.version === undefined || value.version === 3)) return convertV3(value, allowlist);
  return parseV4(value, allowlist);
}

export function applyMutation(document, mutation) {
  const existing = document.history.find((entry) => entry.mutationId === mutation.mutationId);
  if (existing) return { document, revision: existing.revision, duplicate: true };
  const next = {
    version: STATE_VERSION,
    revision: document.revision + 1,
    checks: copyDictionary(document.checks),
    notes: copyDictionary(document.notes),
    scores: copyDictionary(document.scores, (score) => ({ ...score })),
    history: document.history.map((entry) => ({ ...entry }))
  };
  for (const operation of mutation.operations) {
    if (operation.type === 'check.set') {
      if (operation.value) next.checks[operation.key] = true;
      else delete next.checks[operation.key];
    } else if (operation.type === 'note.set') {
      if (operation.value) next.notes[operation.key] = operation.value;
      else delete next.notes[operation.key];
    } else if (operation.type === 'score.set') {
      next.scores[operation.key] = { ...operation.value };
    }
  }
  next.history.push({ mutationId: mutation.mutationId, revision: next.revision });
  if (next.history.length > HISTORY_LIMIT) next.history = next.history.slice(-HISTORY_LIMIT);
  return { document: next, revision: next.revision, duplicate: false };
}
