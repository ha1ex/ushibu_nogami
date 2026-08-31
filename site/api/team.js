import { json, loadUsers, readCookie, SESSION_COOKIE, verifySession } from '../lib/auth.js';

async function authenticateRequest(request) {
  return verifySession(readCookie(request, SESSION_COOKIE), loadUsers());
}

export function createTeamHandler(dependencies = {}) {
  const authenticate = dependencies.authenticate || authenticateRequest;
  return {
    async fetch(request) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET' } });
      }
      let user;
      try {
        user = await authenticate(request);
      } catch {
        return json({ error: 'unauthorized' }, { status: 401 });
      }
      if (!user) return json({ error: 'unauthorized' }, { status: 401 });
      return json({ error: 'gone' }, { status: 410 });
    }
  };
}

export default createTeamHandler();
