/* Вход: ник из состава + личный пароль. */
import { findUser, verifyPassword, signSession, sessionCookie, json } from '../lib/auth.js';

function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, { status: 405 });

    let userId = '';
    let password = '';
    let nextPath = '/';
    let wantsJson = false;

    const type = request.headers.get('content-type') || '';
    try {
      if (type.includes('application/json')) {
        const body = await request.json();
        userId = String(body.user || '');
        password = String(body.password || '');
        nextPath = safeNextPath(body.next);
        wantsJson = true;
      } else {
        const form = await request.formData();
        userId = String(form.get('user') || '');
        password = String(form.get('password') || '');
        nextPath = safeNextPath(form.get('next'));
      }
    } catch {
      return json({ error: 'bad_request' }, { status: 400 });
    }

    const user = findUser(userId);
    // Даже для несуществующего ника прогоняем проверку, чтобы по времени
    // ответа нельзя было понять, какие ники существуют.
    const ok = await verifyPassword(password, user ? user.hash : 'pbkdf2$210000$00$00');

    if (!user || !ok) {
      if (wantsJson) return json({ error: 'invalid_credentials' }, { status: 401 });
      const back = `/?login_error=1&user=${encodeURIComponent(userId)}&next=${encodeURIComponent(nextPath)}`;
      return new Response(null, { status: 303, headers: { location: back, 'cache-control': 'no-store' } });
    }

    const token = await signSession(user.id);
    const headers = { 'set-cookie': sessionCookie(token), 'cache-control': 'no-store' };

    if (wantsJson) return json({ ok: true, me: { id: user.id, nick: user.nick } }, { headers });
    return new Response(null, { status: 303, headers: { ...headers, location: nextPath } });
  },
};
