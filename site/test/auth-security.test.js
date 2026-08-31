import assert from 'node:assert/strict';
import test from 'node:test';

const Auth = await import('../lib/auth.js');
const Http = await import('../lib/http.js');
const logoutHandler = (await import('../api/logout.js')).default;
const { createTeamHandler } = await import('../api/team.js');

const previousSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = 'unit-test-session-secret';
test.after(() => {
  if (previousSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousSecret;
});

const users = [
  { id: 'tester', nick: 'Тестер', hash: 'pbkdf2$210000$00000000000000000000000000000000$' + '0'.repeat(64), sessionVersion: 2 }
];
const validHash = users[0].hash;

test('user normalization defaults sessionVersion to 1 and rejects invalid or duplicate users', () => {
  assert.equal(Auth.normalizeUsers([{ id: 'one', nick: 'One', hash: validHash }])[0].sessionVersion, 1);
  for (const value of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Auth.normalizeUsers([{ id: 'one', nick: 'One', hash: validHash, sessionVersion: value }]), /sessionVersion|config/i);
  }
  assert.throws(() => Auth.normalizeUsers([
    { id: 'same', nick: 'One', hash: validHash }, { id: 'same', nick: 'Two', hash: validHash }
  ]), /duplicate|config/i);
  for (const hash of [
    'hash',
    `pbkdf2$1$${'0'.repeat(32)}$${'0'.repeat(64)}`,
    `pbkdf2$210000$${'0'.repeat(30)}$${'0'.repeat(64)}`,
    `pbkdf2$210000$${'0'.repeat(32)}$${'z'.repeat(64)}`
  ]) assert.throws(() => Auth.normalizeUsers([{ id: 'one', nick: 'One', hash }]), /hash|config/i);
});

test('session token requires exact u/v/e payload and current user version', async () => {
  const now = 1_788_170_000_000;
  const token = await Auth.signSession('tester', 2, now);
  assert.deepEqual(await Auth.verifySession(token, users, now + 1), users[0]);
  assert.equal(await Auth.verifySession(token, [{ ...users[0], sessionVersion: 3 }], now + 1), null);
  assert.equal(await Auth.verifySession(token, [], now + 1), null);
  assert.equal(await Auth.verifySession(token, users, now + 60 * 86400000 + 1), null);

  const oldToken = await signedPayload({ u: 'tester', e: now + 1000 });
  const extraToken = await signedPayload({ u: 'tester', v: 2, e: now + 1000, role: 'admin' });
  assert.equal(await Auth.verifySession(oldToken, users, now), null);
  assert.equal(await Auth.verifySession(extraToken, users, now), null);
});

test('session cookie remains secure for sixty days', async () => {
  const cookie = Auth.sessionCookie('token');
  assert.match(cookie, /^un_session=token;/);
  assert.match(cookie, /Max-Age=5184000/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('strict Origin helper accepts only an exact request URL origin', () => {
  assert.equal(Http.hasSameOrigin(new Request('https://hq.test/api/state', { headers: { origin: 'https://hq.test' } })), true);
  for (const origin of [undefined, 'https://evil.test', 'https://hq.test.evil', 'https://hq.test:443']) {
    const headers = origin ? { origin } : {};
    assert.equal(Http.hasSameOrigin(new Request('https://hq.test/api/state', { headers })), false);
  }
});

test('streaming reader enforces decoded body byte limit without Content-Length', async () => {
  const exact = '{}'.padEnd(32768, ' ');
  assert.deepEqual(await Http.readLimitedJson(new Request('https://hq.test', { method: 'POST', body: exact }), 32768), {});
  await assert.rejects(
    () => Http.readLimitedJson(new Request('https://hq.test', { method: 'POST', body: exact + ' ' }), 32768),
    (error) => error && error.code === 'payload_too_large'
  );
  const invalidUtf8 = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from([0xc3, 0x28])); controller.close(); } });
  await assert.rejects(
    () => Http.readLimitedJson(new Request('https://hq.test', { method: 'POST', body: invalidUtf8, duplex: 'half' }), 32768),
    (error) => error && error.code === 'bad_request'
  );
});

test('logout is POST-only and does not clear a cookie without same Origin', async () => {
  const get = await logoutHandler.fetch(new Request('https://hq.test/api/logout'));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal(get.headers.has('set-cookie'), false);

  const missing = await logoutHandler.fetch(new Request('https://hq.test/api/logout', { method: 'POST' }));
  assert.equal(missing.status, 403);
  assert.equal(missing.headers.has('set-cookie'), false);

  const success = await logoutHandler.fetch(new Request('https://hq.test/api/logout', {
    method: 'POST', headers: { origin: 'https://hq.test' }
  }));
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/');
  assert.match(success.headers.get('set-cookie'), /Max-Age=0/);
});

test('legacy team endpoint authenticates then returns 410 without readiness data', async () => {
  const handler = createTeamHandler({ authenticate: async () => users[0] });
  const gone = await handler.fetch(new Request('https://hq.test/api/team'));
  assert.equal(gone.status, 410);
  assert.deepEqual(await gone.json(), { error: 'gone' });
  const method = await handler.fetch(new Request('https://hq.test/api/team', { method: 'POST' }));
  assert.equal(method.status, 405);
  const unauthorized = createTeamHandler({ authenticate: async () => null });
  assert.equal((await unauthorized.fetch(new Request('https://hq.test/api/team'))).status, 401);
});

async function signedPayload(payload) {
  const body = Auth.b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(process.env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${Auth.b64urlEncode(signature)}`;
}
