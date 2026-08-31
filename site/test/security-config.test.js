import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import middleware, { config } from '../middleware.js';

const expectedCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
const validHash = `pbkdf2$210000$${'0'.repeat(32)}$${'0'.repeat(64)}`;

test('vercel catch-all headers provide the exact CSP and permissions baseline', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const catchAll = vercel.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(catchAll);
  const headers = Object.fromEntries(catchAll.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers['content-security-policy'], expectedCsp);
  assert.equal(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.doesNotMatch(headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
});

test('middleware matcher opens only login CSS, fonts, images, API and platform internals', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of ['/assets/css/login.css', '/assets/fonts/inter-cyrillic.woff2', '/assets/img/logo.jpg', '/api/state', '/_vercel/insights']) {
    assert.equal(matcher.test(path), false, `${path} must be anonymous`);
  }
  for (const path of ['/assets/css/theme.css', '/assets/js/app.js', '/assets/data/operations.json', '/index.html']) {
    assert.equal(matcher.test(path), true, `${path} must stay behind the gate`);
  }
});

test('login response uses external CSS, has username autocomplete and no inline CSP blockers', async () => {
  const previousUsers = process.env.TEAM_USERS;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.TEAM_USERS = JSON.stringify([{ id: 'tester', nick: 'Тестер', hash: validHash }]);
  process.env.AUTH_SECRET = 'test-only-secret';
  try {
    const response = await middleware(new Request('https://hq.test/'));
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.match(body, /<link rel="stylesheet" href="\/assets\/css\/login\.css">/);
    assert.match(body, /<select[^>]+autocomplete="username"/);
    assert.doesNotMatch(body, /<style\b|\sstyle=|\son[a-z]+=/i);
  } finally {
    if (previousUsers === undefined) delete process.env.TEAM_USERS; else process.env.TEAM_USERS = previousUsers;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  }
});

test('malformed and duplicate TEAM_USERS configuration fails closed with 503', async () => {
  const previousUsers = process.env.TEAM_USERS;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'test-only-secret';
  try {
    for (const configured of [
      [{ id: 'tester', nick: 'One', hash: 'stored' }],
      [{ id: 'tester', nick: 'One', hash: validHash, sessionVersion: '2' }],
      [{ id: 'same', nick: 'One', hash: validHash }, { id: 'same', nick: 'Two', hash: validHash }]
    ]) {
      process.env.TEAM_USERS = JSON.stringify(configured);
      const response = await middleware(new Request('https://hq.test/'));
      assert.equal(response.status, 503);
    }
  } finally {
    if (previousUsers === undefined) delete process.env.TEAM_USERS; else process.env.TEAM_USERS = previousUsers;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  }
});

test('runtime HTML and JS contain no inline style or event-handler attributes', async () => {
  for (const relative of ['../index.html', '../pravila.html', '../assets/js/app.js', '../assets/js/ui.js', '../assets/js/store.js']) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<style\b|\sstyle\s*=|setAttribute\(\s*['"]style|\.style\./i, relative);
  }
});
