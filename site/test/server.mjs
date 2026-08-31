import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyMutation,
  createEmptyDocument,
  deriveAllowedKeys,
  validateMutation
} from '../lib/state-core.js';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2'
};
const operations = JSON.parse(await readFile(path.join(root, 'assets/data/operations.json'), 'utf8'));
const allowlist = deriveAllowedKeys(operations);
let document = createEmptyDocument();
let me = { id: 'tester', nick: 'Тестер' };

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function readBody(req, maxBytes = 32768) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.byteLength;
    if (length > maxBytes) throw Object.assign(new Error('large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/__test/reset') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
    document = createEmptyDocument();
    me = { id: 'tester', nick: 'Тестер' };
    try {
      const raw = await readBody(req, 1024);
      if (raw) {
        const requested = JSON.parse(raw);
        if (requested && requested.me && typeof requested.me.id === 'string' && typeof requested.me.nick === 'string') {
          me = { id: requested.me.id, nick: requested.me.nick };
        }
      }
    } catch {}
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        me,
        state: { checks: document.checks, notes: document.notes, scores: document.scores },
        revision: document.revision
      });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
    if (req.headers.origin !== origin) return sendJson(res, 403, { error: 'forbidden_origin' });
    try {
      const mutation = validateMutation(JSON.parse(await readBody(req)), allowlist);
      const applied = applyMutation(document, mutation);
      document = applied.document;
      return sendJson(res, 200, { ok: true, revision: applied.revision });
    } catch (error) {
      return sendJson(res, error.status === 413 ? 413 : 400, {
        error: error.status === 413 ? 'payload_too_large' : 'bad_request'
      });
    }
  }
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const bytes = await readFile(target);
    const headers = { 'content-type': types[path.extname(target)] || 'application/octet-stream' };
    if (pathname === '/assets/data/whoajor/current.json') headers['cache-control'] = 'no-cache, must-revalidate';
    else if (pathname.startsWith('/assets/data/whoajor/v1-')) headers['cache-control'] = 'private, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
