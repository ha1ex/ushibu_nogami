import operations from '../assets/data/operations.json' with { type: 'json' };
import { readLimitedJson, hasSameOrigin, HttpInputError } from '../lib/http.js';
import {
  deriveAllowedKeys,
  StateValidationError,
  validateMutation
} from '../lib/state-core.js';
import { loadUsers, readCookie, SESSION_COOKIE, verifySession, json } from '../lib/auth.js';
import {
  readTeamSnapshot,
  runStateMutationCas,
  StateConflictError,
  teamStateAdapter
} from './_store.js';

export const stateAllowlist = deriveAllowedKeys(operations);

async function authenticateRequest(request) {
  const users = loadUsers();
  return verifySession(readCookie(request, SESSION_COOKIE), users);
}

export function createStateHandler(dependencies = {}) {
  const authenticate = dependencies.authenticate || authenticateRequest;
  const allowlist = dependencies.allowlist || stateAllowlist;
  const readState = dependencies.readState || (() => readTeamSnapshot({ adapter: teamStateAdapter, allowlist }));
  const mutateState = dependencies.mutateState || ((mutation) =>
    runStateMutationCas({ adapter: teamStateAdapter, allowlist, maxAttempts: 3 }, mutation));

  return {
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, POST' } });
      }
      let user;
      try {
        user = await authenticate(request);
      } catch {
        return json({ error: 'state_unavailable' }, { status: 502 });
      }
      if (!user) return json({ error: 'unauthorized' }, { status: 401 });

      if (request.method === 'GET') {
        try {
          const { document } = await readState();
          return json({
            me: { id: user.id, nick: user.nick },
            state: { checks: document.checks, notes: document.notes, scores: document.scores },
            revision: document.revision
          });
        } catch {
          return json({ error: 'state_unavailable' }, { status: 502 });
        }
      }

      if (!hasSameOrigin(request)) return json({ error: 'forbidden_origin' }, { status: 403 });
      let mutation;
      try {
        mutation = validateMutation(await readLimitedJson(request, 32768), allowlist);
      } catch (error) {
        if (error instanceof HttpInputError && error.code === 'payload_too_large') {
          return json({ error: 'payload_too_large' }, { status: 413 });
        }
        if (error instanceof HttpInputError || error instanceof StateValidationError) {
          return json({ error: 'bad_request' }, { status: 400 });
        }
        return json({ error: 'bad_request' }, { status: 400 });
      }

      try {
        const result = await mutateState(mutation);
        return json({ ok: true, revision: result.revision });
      } catch (error) {
        if (error instanceof StateConflictError) return json({ error: 'conflict' }, { status: 409 });
        return json({ error: 'state_unavailable' }, { status: 502 });
      }
    }
  };
}

export default createStateHandler();
