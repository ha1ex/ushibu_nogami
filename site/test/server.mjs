import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
let teamState = { checks: {}, notes: {} };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/state') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      Object.assign(teamState.checks, payload.checks || {});
      Object.assign(teamState.notes, payload.notes || {});
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ me: { id: 'tester', nick: 'Тестер' }, team: teamState, personal: { checks: {} } }));
  }
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep)) {
    res.writeHead(403); return res.end('forbidden');
  }
  try {
    const bytes = await readFile(target);
    const headers = { 'content-type': types[path.extname(target)] || 'application/octet-stream' };
    if (pathname === '/assets/data/whoajor/current.json') headers['cache-control'] = 'no-cache, must-revalidate';
    else if (pathname.startsWith('/assets/data/whoajor/v1-')) headers['cache-control'] = 'private, max-age=31536000, immutable';
    res.writeHead(200, headers); res.end(bytes);
  } catch (_) {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(4173, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
