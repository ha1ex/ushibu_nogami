/* Web Crypto only: this module is safe to import from Edge Middleware. */
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const SESSION_DAYS = 60;
const PBKDF2_ITERATIONS = 210000;
const PASSWORD_HASH_PATTERN = /^pbkdf2\$210000\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
export const SESSION_COOKIE = 'un_session';

export function b64urlEncode(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padding = value.length % 4 ? '='.repeat(4 - (value.length % 4)) : '';
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) throw new Error('invalid hex');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2' || parts[1] !== String(PBKDF2_ITERATIONS) ||
      !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^[a-f0-9]{64}$/i.test(parts[3])) return false;
  try {
    return safeEqual(await hashPassword(password, parts[2]), stored);
  } catch {
    return false;
  }
}

export function normalizeUsers(value) {
  if (!Array.isArray(value)) throw new Error('invalid TEAM_USERS config');
  const seen = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.id !== 'string' || !entry.id || typeof entry.nick !== 'string' || !entry.nick ||
        typeof entry.hash !== 'string' || !PASSWORD_HASH_PATTERN.test(entry.hash)) {
      throw new Error('invalid TEAM_USERS hash config');
    }
    if (seen.has(entry.id)) throw new Error('duplicate TEAM_USERS config id');
    seen.add(entry.id);
    const sessionVersion = entry.sessionVersion === undefined ? 1 : entry.sessionVersion;
    if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) throw new Error('invalid sessionVersion config');
    return { id: entry.id, nick: entry.nick, hash: entry.hash, sessionVersion };
  });
}

export function loadUsers() {
  try {
    return normalizeUsers(JSON.parse(process.env.TEAM_USERS || '[]'));
  } catch {
    return [];
  }
}

export function findUser(id, users = loadUsers()) {
  return users.find((user) => user.id === id) || null;
}

async function hmacKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET missing');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(userId, sessionVersion, now = Date.now()) {
  if (typeof userId !== 'string' || !userId || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1 || !Number.isSafeInteger(now)) {
    throw new Error('invalid session input');
  }
  const payload = { u: userId, v: sessionVersion, e: now + SESSION_DAYS * 86400000 };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(signature)}`;
}

export async function verifySession(token, users = loadUsers(), now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), b64urlDecode(signature), enc.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body)));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).sort().join(',') !== 'e,u,v' || typeof payload.u !== 'string' ||
        !Number.isSafeInteger(payload.v) || payload.v < 1 || !Number.isSafeInteger(payload.e) || payload.e <= now) return null;
    const user = findUser(payload.u, users);
    if (!user || user.sessionVersion !== payload.v) return null;
    return user;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request, name) {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });
}
