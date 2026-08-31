import { b64urlEncode } from '../lib/auth.js';

export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_ATTEMPTS = 10;

export class RateLimitUnavailableError extends Error {
  constructor() {
    super('rate limiter unavailable');
    this.name = 'RateLimitUnavailableError';
  }
}

function exactBucket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'attempts,version' || value.version !== 1 ||
      !Array.isArray(value.attempts) || value.attempts.length > RATE_LIMIT_ATTEMPTS) {
    throw new RateLimitUnavailableError();
  }
  let prior = -1;
  const attempts = value.attempts.map((timestamp) => {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp < prior) throw new RateLimitUnavailableError();
    prior = timestamp;
    return timestamp;
  });
  return { version: 1, attempts };
}

export async function limiterPath(ip, secret) {
  const normalizedIp = typeof ip === 'string' ? ip.trim().toLowerCase() : '';
  if (!normalizedIp || normalizedIp.length > 128 || /[\0\r\n]/.test(normalizedIp) || typeof secret !== 'string' || !secret) {
    throw new RateLimitUnavailableError();
  }
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const digest = await crypto.subtle.sign(
      'HMAC', key, new TextEncoder().encode(`ushibu-login-rate-limit:v1\0${normalizedIp}`)
    );
    return `security/login-rate-limit/v1/${b64urlEncode(digest)}.json`;
  } catch {
    throw new RateLimitUnavailableError();
  }
}

async function readBucket(adapter, path) {
  try {
    const snapshot = await adapter.read(path);
    if (!snapshot || snapshot.exists === false) {
      return { exists: false, etag: null, bucket: { version: 1, attempts: [] } };
    }
    if (snapshot.exists !== true || typeof snapshot.etag !== 'string') throw new Error('invalid snapshot');
    return { exists: true, etag: snapshot.etag, bucket: exactBucket(snapshot.value) };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError();
  }
}

export async function reserveAttempt({ adapter, path, now, maxAttempts = 32 }) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RateLimitUnavailableError();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readBucket(adapter, path);
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const recent = snapshot.bucket.attempts.filter((timestamp) => timestamp > cutoff);
    if (recent.length >= RATE_LIMIT_ATTEMPTS) {
      return {
        blocked: true,
        retryAfter: Math.max(1, Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000))
      };
    }
    const next = { version: 1, attempts: recent.concat([now]) };
    try {
      if (snapshot.exists) await adapter.replace(path, snapshot.etag, next);
      else await adapter.create(path, next);
      return { blocked: false };
    } catch (error) {
      if (adapter.isConflict && adapter.isConflict(error)) continue;
      throw new RateLimitUnavailableError();
    }
  }
  throw new RateLimitUnavailableError();
}

export async function clearAfterSuccess({ adapter, path, maxAttempts = 32 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readBucket(adapter, path);
    if (!snapshot.exists) throw new RateLimitUnavailableError();
    if (snapshot.bucket.attempts.length === 0) return;
    try {
      await adapter.replace(path, snapshot.etag, { version: 1, attempts: [] });
      return;
    } catch (error) {
      if (adapter.isConflict && adapter.isConflict(error)) continue;
      throw new RateLimitUnavailableError();
    }
  }
  throw new RateLimitUnavailableError();
}
