/* Состояние текущего игрока плюс общее командное.

   GET  → { me, personal, team }
   POST → принимает плоский патч { checks, notes } и сам решает,
          что личное, а что командное. Клиенту доверять нельзя. */
import { verifySession, readCookie, findUser, isPersonalKey, SESSION_COOKIE, json } from '../lib/auth.js';
import { readDoc, writeDoc, applyPatch } from './_store.js';

export default {
  async fetch(request) {
    const userId = await verifySession(readCookie(request, SESSION_COOKIE));
    const user = userId ? findUser(userId) : null;
    if (!user) return json({ error: 'unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      const [personal, team] = await Promise.all([readDoc('personal', user.id), readDoc('team')]);
      return json({ me: { id: user.id, nick: user.nick }, personal, team });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, { status: 405 });

    let patch;
    try {
      patch = await request.json();
    } catch {
      return json({ error: 'bad_request' }, { status: 400 });
    }

    const checks = patch && typeof patch.checks === 'object' && patch.checks ? patch.checks : {};
    const notes = patch && typeof patch.notes === 'object' && patch.notes ? patch.notes : {};

    // Раскладываем патч по адресатам на сервере
    const personalPatch = { checks: {} };
    const teamPatch = { checks: {}, notes: {} };
    for (const [k, v] of Object.entries(checks)) {
      (isPersonalKey(k) ? personalPatch.checks : teamPatch.checks)[k] = v;
    }
    for (const [k, v] of Object.entries(notes)) teamPatch.notes[k] = v;

    const jobs = [];
    if (Object.keys(personalPatch.checks).length) {
      jobs.push(
        readDoc('personal', user.id)
          .then((doc) => writeDoc('personal', user.id, applyPatch(doc, personalPatch)))
      );
    }
    if (Object.keys(teamPatch.checks).length || Object.keys(teamPatch.notes).length) {
      jobs.push(readDoc('team').then((doc) => writeDoc('team', null, applyPatch(doc, teamPatch))));
    }

    try {
      await Promise.all(jobs);
    } catch (err) {
      return json({ error: 'write_failed', detail: String(err && err.message) }, { status: 502 });
    }

    return json({ ok: true, saved: jobs.length });
  },
};
