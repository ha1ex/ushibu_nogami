import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../lib/http-client.mjs';

test('client запрещает не-API path и не имеет mutation methods', async () => {
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    fetchImpl: async () => null,
  });

  await assert.rejects(client.get('/admin'), /only \/api\//);
  assert.equal(client.post, undefined);
  assert.equal(client.put, undefined);
  assert.equal(client.delete, undefined);
});

test('client повторяет 429 по Retry-After и возвращает exact body', async () => {
  const sleeps = [];
  const responses = [
    new Response('{"error":"slow"}', { status: 429, headers: { 'Retry-After': '1' } }),
    new Response('{"matches":2}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 2,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => responses.shift(),
  });

  const result = await client.get('/api/meta');

  assert.equal(result.body, '{"matches":2}');
  assert.equal(result.status, 200);
  assert.equal(result.url, 'https://stats.whoajor.com/api/meta');
  assert.deepEqual(result.headers, { 'content-type': 'application/json' });
  assert.deepEqual(sleeps, [1000]);
});

test('client повторяет 503 с exponential backoff', async () => {
  const sleeps = [];
  const responses = [
    new Response('{"error":"unavailable"}', { status: 503 }),
    new Response('{"matches":2}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 1,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => responses.shift(),
  });

  await client.get('/api/meta');

  assert.deepEqual(sleeps, [250]);
});

test('client требует JSON content-type и читает successful body ровно один раз', async () => {
  let bodyReads = 0;
  const response = {
    status: 200,
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: async () => {
      bodyReads += 1;
      return '{"matches":2}';
    },
  };
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    fetchImpl: async () => response,
  });

  await assert.rejects(client.get('/api/meta'), /JSON content-type/);
  assert.equal(bodyReads, 0);
});

test('client читает JSON body ровно один раз', async () => {
  let bodyReads = 0;
  const response = {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    text: async () => {
      bodyReads += 1;
      return '{"matches":2}';
    },
  };
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    fetchImpl: async () => response,
  });

  const record = await client.get('/api/meta');

  assert.equal(record.body, '{"matches":2}');
  assert.equal(bodyReads, 1);
});

test('client повторяет network error при чтении JSON body', async () => {
  const sleeps = [];
  let fetchCalls = 0;
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 1,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => {
            throw new Error('body stream interrupted');
          },
        };
      }
      return new Response('{"matches":2}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.get('/api/meta');

  assert.equal(result.body, '{"matches":2}');
  assert.equal(fetchCalls, 2);
  assert.deepEqual(sleeps, [250]);
});

test('client сообщает context после исчерпания retries при чтении body', async () => {
  const sleeps = [];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 1,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => {
        throw new Error('body stream interrupted');
      },
    }),
  });

  await assert.rejects(client.get('/api/meta'), (error) => {
    assert.match(error.message, /https:\/\/stats\.whoajor\.com\/api\/meta/);
    assert.match(error.message, /status 200/);
    assert.match(error.message, /after 2 attempts/);
    assert.equal(error.status, 200);
    assert.equal(error.attempts, 2);
    return true;
  });
  assert.deepEqual(sleeps, [250]);
});

test('client не повторяет 404 и сообщает URL, status и число попыток', async () => {
  let fetchCalls = 0;
  const sleeps = [];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 5,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('{"error":"missing"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await assert.rejects(client.get('/api/meta'), (error) => {
    assert.match(error.message, /https:\/\/stats\.whoajor\.com\/api\/meta/);
    assert.match(error.message, /status 404/);
    assert.match(error.message, /1 attempts/);
    return true;
  });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(sleeps, []);
});

test('client повторяет network error c ограниченным exponential backoff', async () => {
  let fetchCalls = 0;
  const sleeps = [];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 0,
    maxRetries: 5,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('offline');
    },
  });

  await assert.rejects(client.get('/api/meta'), /after 6 attempts/);
  assert.equal(fetchCalls, 6);
  assert.deepEqual(sleeps, [250, 500, 1000, 2000, 4000]);
});

test('client допускает maxRetries только в целочисленном диапазоне от 0 до 5', () => {
  const options = {
    baseUrl: 'https://stats.whoajor.com',
    fetchImpl: async () => null,
  };
  let invalidLimitFetchCalls = 0;

  assert.doesNotThrow(() => createHttpClient({ ...options, maxRetries: 0 }));
  assert.doesNotThrow(() => createHttpClient({ ...options, maxRetries: 5 }));
  assert.throws(() => createHttpClient({ ...options, maxRetries: -1 }), RangeError);
  assert.throws(() => createHttpClient({ ...options, maxRetries: 1.5 }), RangeError);
  assert.throws(() => createHttpClient({
    ...options,
    maxRetries: 6,
    fetchImpl: async () => {
      invalidLimitFetchCalls += 1;
      return null;
    },
  }), RangeError);
  assert.equal(invalidLimitFetchCalls, 0);
});

test('client применяет pacing между последовательными успешными запросами', async () => {
  const sleeps = [];
  const fetchRequests = [];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com',
    delayMs: 25,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async (url, options) => {
      fetchRequests.push({ url: String(url), options });
      return new Response('{"matches":2}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.get('/api/meta');
  await client.get('/api/meta', { limit: 50 });

  assert.deepEqual(sleeps, [25]);
  assert.deepEqual(fetchRequests, [
    {
      url: 'https://stats.whoajor.com/api/meta',
      options: {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'ushibu-nogami-whoajor-import/1.0',
        },
      },
    },
    {
      url: 'https://stats.whoajor.com/api/meta?limit=50',
      options: {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'ushibu-nogami-whoajor-import/1.0',
        },
      },
    },
  ]);
});
