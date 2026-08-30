/* ============================================================
   Состояние в Vercel Blob (приватный стор).

   Личное лежит по документу на игрока, командное — в одном общем.
   Из-за этого гонки возможны только по командному документу и
   только при одновременной правке одного и того же поля.
   ============================================================ */

import { put, get } from '@vercel/blob';
import { isPersonalKey } from '../lib/auth.js';



const EMPTY_PERSONAL = { checks: {} };
const EMPTY_TEAM = { checks: {}, notes: {} };

function pathFor(scope, userId) {
  return scope === 'team' ? 'state/team.json' : `state/user-${userId}.json`;
}

export async function readDoc(scope, userId) {
  const fallback = scope === 'team' ? EMPTY_TEAM : EMPTY_PERSONAL;
  try {
    // useCache:false — иначе сразу после записи можно прочитать старую версию.
    const res = await get(pathFor(scope, userId), { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return structuredClone(fallback);
    const text = await new Response(res.stream).text();
    const parsed = JSON.parse(text);
    return {
      checks: parsed && typeof parsed.checks === 'object' && parsed.checks ? parsed.checks : {},
      ...(scope === 'team'
        ? { notes: parsed && typeof parsed.notes === 'object' && parsed.notes ? parsed.notes : {} }
        : {}),
    };
  } catch {
    return structuredClone(fallback);
  }
}

export async function writeDoc(scope, userId, doc) {
  await put(pathFor(scope, userId), JSON.stringify(doc), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
}

/* Аккуратное слияние патча: true/строка — записать, false/null/'' — удалить. */
export function applyPatch(doc, patch) {
  const next = { checks: { ...doc.checks }, ...(doc.notes ? { notes: { ...doc.notes } } : {}) };

  if (patch && typeof patch.checks === 'object' && patch.checks) {
    for (const [k, v] of Object.entries(patch.checks)) {
      if (v === true) next.checks[k] = true;
      else delete next.checks[k];
    }
  }
  if (next.notes && patch && typeof patch.notes === 'object' && patch.notes) {
    for (const [k, v] of Object.entries(patch.notes)) {
      if (typeof v === 'string' && v.length) next.notes[k] = v.slice(0, 20000);
      else delete next.notes[k];
    }
  }
  return next;
}
