import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import middleware, { config } from '../middleware.js';
import { signSession } from '../lib/auth.js';

const validHash = `pbkdf2$210000$${'0'.repeat(32)}$${'0'.repeat(64)}`;

test('anonymous Whoajor JSON request remains inside the password gate', async () => {
  const previousUsers = process.env.TEAM_USERS;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.TEAM_USERS = JSON.stringify([{ id: 'tester', nick: 'Тестер', hash: validHash }]);
  process.env.AUTH_SECRET = 'test-only-secret';
  try {
    const path = '/assets/data/whoajor/current.json';
    assert.match(path, new RegExp(config.matcher[0]));
    const response = await middleware(new Request('https://hq.test' + path));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const body = await response.text();
    assert.match(body, /Вход в штаб/);
    assert.doesNotMatch(body, /manifestSha256/);
  } finally {
    if (previousUsers === undefined) delete process.env.TEAM_USERS; else process.env.TEAM_USERS = previousUsers;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  }
});

test('browser fixtures and result artifacts are excluded from the production upload', async () => {
  const ignored = await readFile(new URL('../.vercelignore', import.meta.url), 'utf8');
  assert.match(ignored, /^test\/$/m);
  assert.match(ignored, /^test-results\/$/m);
  assert.match(ignored, /^playwright\.config\.js$/m);
});

test('middleware accepts a signed cookie only when its sessionVersion matches the current user', async () => {
  const previousUsers = process.env.TEAM_USERS;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.TEAM_USERS = JSON.stringify([{ id: 'tester', nick: 'Тестер', hash: validHash, sessionVersion: 7 }]);
  process.env.AUTH_SECRET = 'test-only-secret';
  try {
    const token = await signSession('tester', 7);
    const response = await middleware(new Request('https://hq.test/', { headers: { cookie: `un_session=${token}` } }));
    assert.equal(response.headers.get('x-middleware-next'), '1');
  } finally {
    if (previousUsers === undefined) delete process.env.TEAM_USERS; else process.env.TEAM_USERS = previousUsers;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  }
});
