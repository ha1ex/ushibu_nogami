/* Сводка по составу: сколько личных отметок у каждого.
   Проценты считает клиент — он знает, сколько всего гранат и правил. */
import { verifySession, readCookie, loadUsers, SESSION_COOKIE, json } from '../lib/auth.js';
import { readDoc } from './_store.js';

export default {
  async fetch(request) {
    const userId = await verifySession(readCookie(request, SESSION_COOKIE));
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const users = loadUsers();
    const docs = await Promise.all(users.map((u) => readDoc('personal', u.id)));

    const roster = users.map((u, i) => {
      const keys = Object.keys(docs[i].checks || {});
      return {
        id: u.id,
        nick: u.nick,
        nades: keys.filter((k) => k.startsWith('nade-')).length,
        rules: keys.filter((k) => k.startsWith('rule-')).length,
        ladder: keys.filter((k) => k.startsWith('lad-')).length,
    };
    });

    return json({ roster });
  },
};
