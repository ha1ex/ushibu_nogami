import { ipAddress } from '@vercel/functions';
import {
  findUser,
  json,
  loadUsers,
  sessionCookie,
  signSession,
  verifyPassword
} from '../lib/auth.js';
import { hasSameOrigin, readLimitedJson, readLimitedUtf8, safeLocalPath } from '../lib/http.js';
import { blobJsonAdapter } from './_blob-json.js';
import { clearAfterSuccess, limiterPath, reserveAttempt } from './_rate-limit.js';

const DUMMY_HASH = `pbkdf2$210000$${'0'.repeat(32)}$${'0'.repeat(64)}`;

async function parseCredentials(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await readLimitedJson(request, 8192);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad request');
    return {
      userId: typeof body.user === 'string' ? body.user : '',
      password: typeof body.password === 'string' ? body.password : '',
      nextPath: safeLocalPath(body.next),
      wantsJson: true
    };
  }
  const form = new URLSearchParams(await readLimitedUtf8(request, 8192));
  return {
    userId: form.get('user') || '',
    password: form.get('password') || '',
    nextPath: safeLocalPath(form.get('next')),
    wantsJson: false
  };
}

export function createLoginHandler(dependencies = {}) {
  const userSource = dependencies.users === undefined ? loadUsers : dependencies.users;
  const adapter = dependencies.adapter || blobJsonAdapter;
  const getIp = dependencies.getIp || ipAddress;
  const getSecret = () => dependencies.limiterSecret || process.env.LOGIN_RATE_LIMIT_SECRET || process.env.AUTH_SECRET;
  const clock = dependencies.now || Date.now;
  const passwordVerifier = dependencies.verifyPassword || verifyPassword;
  const sessionSigner = dependencies.signSession || signSession;

  return {
    async fetch(request) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST' } });
      }
      if (!hasSameOrigin(request)) return json({ error: 'forbidden_origin' }, { status: 403 });

      let credentials;
      try {
        credentials = await parseCredentials(request);
      } catch {
        return json({ error: 'bad_request' }, { status: 400 });
      }

      const users = typeof userSource === 'function' ? userSource() : userSource;
      const secret = getSecret();
      const ip = getIp(request);
      if (!Array.isArray(users) || users.length === 0 || !secret || !ip) {
        return json({ error: 'auth_unavailable' }, { status: 503 });
      }

      let path;
      let reservation;
      try {
        path = await limiterPath(ip, secret);
        reservation = await reserveAttempt({ adapter, path, now: clock() });
      } catch {
        return json({ error: 'auth_unavailable' }, { status: 503 });
      }
      if (reservation.blocked) {
        return json({ error: 'rate_limited' }, {
          status: 429,
          headers: { 'retry-after': String(reservation.retryAfter) }
        });
      }

      const user = findUser(credentials.userId, users);
      let passwordOk = false;
      try {
        passwordOk = await passwordVerifier(credentials.password, user ? user.hash : DUMMY_HASH);
      } catch {
        passwordOk = false;
      }
      if (!user || !passwordOk) {
        if (credentials.wantsJson) return json({ error: 'invalid_credentials' }, { status: 401 });
        const location = `/?login_error=1&user=${encodeURIComponent(credentials.userId)}&next=${encodeURIComponent(credentials.nextPath)}`;
        return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
      }

      let token;
      try {
        await clearAfterSuccess({ adapter, path });
        token = await sessionSigner(user.id, user.sessionVersion);
      } catch {
        return json({ error: 'auth_unavailable' }, { status: 503 });
      }
      const headers = { 'set-cookie': sessionCookie(token), 'cache-control': 'no-store' };
      if (credentials.wantsJson) return json({ ok: true, me: { id: user.id, nick: user.nick } }, { headers });
      return new Response(null, { status: 303, headers: { ...headers, location: credentials.nextPath } });
    }
  };
}

export default createLoginHandler();
