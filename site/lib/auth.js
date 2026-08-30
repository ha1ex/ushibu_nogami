/* ============================================================
   Аутентификация: пароли, сессии, состав команды.
   Только Web Crypto, без Node- и Blob-зависимостей — этот модуль
   импортирует и edge-middleware, и серверные функции.
   ============================================================ */

/* ---------------- Кодирование ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- Пароли ---------------- */

const PBKDF2_ITERATIONS = 210000;

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const candidate = await hashPassword(password, parts[2]);
  return safeEqual(candidate, stored);
}

/* ---------------- Пользователи ---------------- */

/* Состав лежит в переменной окружения TEAM_USERS:
   [{ "id": "lis", "nick": "L!S", "hash": "pbkdf2$..." }, ...] */
export function loadUsers() {
  try {
    const parsed = JSON.parse(process.env.TEAM_USERS || '[]');
    return Array.isArray(parsed) ? parsed.filter((u) => u && u.id && u.nick && u.hash) : [];
  } catch {
    return [];
  }
}

export function findUser(id) {
  return loadUsers().find((u) => u.id === id) || null;
}

/* ---------------- Сессии ---------------- */

const SESSION_DAYS = 60;
export const SESSION_COOKIE = 'un_session';

async function hmacKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET не задан');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(userId) {
  const payload = { u: userId, e: Date.now() + SESSION_DAYS * 86400000 };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(body)));
    if (!payload || typeof payload.u !== 'string' || typeof payload.e !== 'number') return null;
    if (Date.now() > payload.e) return null;
    return payload.u;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request, name) {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ---------------- Что личное, а что общее ----------------
   Личное: выученные гранаты, освоенные правила, лестница внедрения.
   Всё остальное — командное: заметки, вето, скаутинг, роли,
   счёт матчей и цели тренировок. */
export function isPersonalKey(key) {
  return /^(nade-|rule-|lad-)/.test(String(key));
}


export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}
