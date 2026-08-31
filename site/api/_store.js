import { applyMutation, createEmptyDocument, parseStoredDocument } from '../lib/state-core.js';
import { blobJsonAdapter } from './_blob-json.js';

export const STATE_PATH = 'state/team.json';

export class StateUnavailableError extends Error {
  constructor() {
    super('team state unavailable');
    this.name = 'StateUnavailableError';
  }
}

export class StateConflictError extends Error {
  constructor() {
    super('team state conflict');
    this.name = 'StateConflictError';
  }
}

export const teamStateAdapter = {
  read: () => blobJsonAdapter.read(STATE_PATH),
  create: (value) => blobJsonAdapter.create(STATE_PATH, value),
  replace: (etag, value) => blobJsonAdapter.replace(STATE_PATH, etag, value),
  isConflict: (error) => blobJsonAdapter.isConflict(error)
};

export async function readTeamSnapshot({ adapter = teamStateAdapter, allowlist }) {
  try {
    const snapshot = await adapter.read();
    if (!snapshot || snapshot.exists === false) {
      return { exists: false, etag: null, document: createEmptyDocument(), migrated: false, report: null };
    }
    if (snapshot.exists !== true || typeof snapshot.etag !== 'string') throw new Error('invalid adapter snapshot');
    const parsed = parseStoredDocument(snapshot.value, allowlist);
    return { exists: true, etag: snapshot.etag, ...parsed };
  } catch {
    throw new StateUnavailableError();
  }
}

export async function runStateMutationCas({ adapter = teamStateAdapter, allowlist, maxAttempts = 3 }, mutation) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readTeamSnapshot({ adapter, allowlist });
    const applied = applyMutation(snapshot.document, mutation);
    if (applied.duplicate) return { revision: applied.revision, duplicate: true };
    try {
      if (snapshot.exists) await adapter.replace(snapshot.etag, applied.document);
      else await adapter.create(applied.document);
      return { revision: applied.revision, duplicate: false };
    } catch (error) {
      if (adapter.isConflict && adapter.isConflict(error)) continue;
      throw new StateUnavailableError();
    }
  }
  throw new StateConflictError();
}
