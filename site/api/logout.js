import { clearCookie, json } from '../lib/auth.js';
import { hasSameOrigin } from '../lib/http.js';

export function createLogoutHandler() {
  return {
    async fetch(request) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST' } });
      }
      if (!hasSameOrigin(request)) return json({ error: 'forbidden_origin' }, { status: 403 });
      return new Response(null, {
        status: 303,
        headers: { location: '/', 'set-cookie': clearCookie(), 'cache-control': 'no-store' }
      });
    }
  };
}

export default createLogoutHandler();
