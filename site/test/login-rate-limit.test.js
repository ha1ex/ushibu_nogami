import assert from 'node:assert/strict';
import test from 'node:test';

const Rate = await import('../api/_rate-limit.js');
const { createLoginHandler } = await import('../api/login.js');

const user = {
  id: 'tester', nick: 'Тестер', hash: 'stored-password-hash', sessionVersion: 4
};
const now = 1_788_170_000_000;

function memoryAdapter() {
  const documents = new Map();
  let sequence = 0;
  return {
    async read(path) {
      const entry = documents.get(path);
      return entry ? { exists: true, etag: entry.etag, value: structuredClone(entry.value) }
        : { exists: false, etag: null, value: null };
    },
    async create(path, value) {
      if (documents.has(path)) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      documents.set(path, { etag: `etag-${++sequence}`, value: structuredClone(value) });
    },
    async replace(path, etag, value) {
      const entry = documents.get(path);
      if (!entry || entry.etag !== etag) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      documents.set(path, { etag: `etag-${++sequence}`, value: structuredClone(value) });
    },
    isConflict(error) { return error && error.code === 'conflict'; },
    documents
  };
}

test('limiter path is an HMAC digest and never contains the IP', async () => {
  const path = await Rate.limiterPath('203.0.113.42', 'test-secret');
  assert.match(path, /^security\/login-rate-limit\/v1\/[A-Za-z0-9_-]{43}\.json$/);
  assert.doesNotMatch(path, /203|113|42/);
  assert.equal(path, await Rate.limiterPath('203.0.113.42', 'test-secret'));
  assert.notEqual(path, await Rate.limiterPath('203.0.113.43', 'test-secret'));
});

test('ten attempts fit the sliding window and the eleventh returns an exact Retry-After', async () => {
  const adapter = memoryAdapter();
  const path = 'security/login-rate-limit/v1/test.json';
  for (let index = 0; index < 10; index += 1) {
    assert.deepEqual(await Rate.reserveAttempt({ adapter, path, now: now + index * 1000 }), { blocked: false });
  }
  assert.deepEqual(await Rate.reserveAttempt({ adapter, path, now: now + 10_000 }), { blocked: true, retryAfter: 290 });
  assert.deepEqual(await Rate.reserveAttempt({ adapter, path, now: now + 300_000 }), { blocked: false });
});

test('concurrent CAS reservations cannot let an eleventh password guess through', async () => {
  const adapter = memoryAdapter();
  const path = 'security/login-rate-limit/v1/barrier.json';
  let reads = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const originalRead = adapter.read;
  adapter.read = async (...args) => {
    const snapshot = await originalRead(...args);
    reads += 1;
    if (reads <= 11) {
      if (reads === 11) release();
      await barrier;
    }
    return snapshot;
  };
  const results = await Promise.all(Array.from({ length: 11 }, () =>
    Rate.reserveAttempt({ adapter, path, now, maxAttempts: 32 })
  ));
  assert.equal(results.filter((result) => !result.blocked).length, 10);
  assert.equal(results.filter((result) => result.blocked).length, 1);
});

test('successful authentication clears the latest bucket with CAS', async () => {
  const adapter = memoryAdapter();
  const path = 'security/login-rate-limit/v1/reset.json';
  await Rate.reserveAttempt({ adapter, path, now });
  await Rate.reserveAttempt({ adapter, path, now: now + 1000 });
  await Rate.clearAfterSuccess({ adapter, path });
  assert.deepEqual(await Rate.reserveAttempt({ adapter, path, now: now + 2000 }), { blocked: false });
  const current = await adapter.read(path);
  assert.deepEqual(current.value.attempts, [now + 2000]);
});

function loginRequest(password = 'wrong') {
  return new Request('https://hq.test/api/login', {
    method: 'POST',
    headers: { origin: 'https://hq.test', 'content-type': 'application/json', 'x-real-ip': '203.0.113.42' },
    body: JSON.stringify({ user: 'tester', password, next: '/' })
  });
}

function formLoginRequest(password, next) {
  return new Request('https://hq.test/api/login', {
    method: 'POST',
    headers: { origin: 'https://hq.test', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: 'tester', password, next })
  });
}

function loginHandler(overrides = {}) {
  const adapter = overrides.adapter || memoryAdapter();
  return createLoginHandler({
    users: [user],
    adapter,
    getIp: () => '203.0.113.42',
    limiterSecret: 'test-limiter-secret',
    now: () => now,
    verifyPassword: async (password) => password === 'correct',
    signSession: async (id, version) => `token-${id}-v${version}`,
    ...overrides
  });
}

test('login reserves before verification: ten concurrent failures get 401 and the eleventh gets 429', async () => {
  let verifications = 0;
  const handler = loginHandler({ verifyPassword: async () => { verifications += 1; return false; } });
  const responses = await Promise.all(Array.from({ length: 11 }, () => handler.fetch(loginRequest())));
  assert.equal(responses.filter((response) => response.status === 401).length, 10);
  const blocked = responses.filter((response) => response.status === 429);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].headers.get('retry-after'), '300');
  assert.equal(verifications, 10);
});

test('login success clears failures and signs the exact current sessionVersion', async () => {
  const signed = [];
  const handler = loginHandler({ signSession: async (...args) => { signed.push(args); return 'token'; } });
  assert.equal((await handler.fetch(loginRequest('wrong'))).status, 401);
  const success = await handler.fetch(loginRequest('correct'));
  assert.equal(success.status, 200);
  assert.match(success.headers.get('set-cookie'), /^un_session=token;/);
  assert.deepEqual(signed, [['tester', 4]]);
  for (let index = 0; index < 10; index += 1) assert.equal((await handler.fetch(loginRequest('wrong'))).status, 401);
});

test('login redirect cannot become cross-origin after URL parser whitespace normalization', async () => {
  const response = await loginHandler().fetch(formLoginRequest('correct', '/\t/evil.test'));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
});

test('login rejects foreign Origin and fails closed before password verification on IP/storage failure', async () => {
  let verifications = 0;
  const verifyPassword = async () => { verifications += 1; return false; };
  const wrongOrigin = loginHandler({ verifyPassword });
  const forbidden = await wrongOrigin.fetch(new Request('https://hq.test/api/login', {
    method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}'
  }));
  assert.equal(forbidden.status, 403);

  const missingIp = loginHandler({ verifyPassword, getIp: () => undefined });
  assert.equal((await missingIp.fetch(loginRequest())).status, 503);

  const outage = loginHandler({
    verifyPassword,
    adapter: { read: async () => { throw new Error('blob outage'); }, isConflict: () => false }
  });
  const unavailable = await outage.fetch(loginRequest());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'auth_unavailable' });
  assert.equal(verifications, 0);
});

test('valid password issues no cookie when CAS clearing fails', async () => {
  const adapter = memoryAdapter();
  adapter.replace = async () => { throw Object.assign(new Error('conflict'), { code: 'conflict' }); };
  const handler = loginHandler({ adapter });
  const response = await handler.fetch(loginRequest('correct'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.has('set-cookie'), false);
});
