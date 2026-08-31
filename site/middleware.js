import { next } from '@vercel/functions';
import { loadUsers, readCookie, SESSION_COOKIE, verifySession } from './lib/auth.js';
import { safeLocalPath } from './lib/http.js';

export const config = {
  matcher: ['/((?!assets/css/login\\.css$|assets/fonts/|assets/img/|api/|_vercel/).*)']
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
}

function loginPage({ users, nextPath = '/', selected = '', error = false }) {
  const options = users.map((user) => (
    `<option value="${escapeHtml(user.id)}"${user.id === selected ? ' selected' : ''}>${escapeHtml(user.nick)}</option>`
  )).join('');
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>Штаб CS2 — Ушибу ногами</title>
<link rel="icon" href="/assets/img/logo.jpg">
<link rel="stylesheet" href="/assets/css/login.css">
</head>
<body>
  <main class="gate">
    <div class="brand">
      <img src="/assets/img/logo.jpg" alt="" width="48" height="48">
      <span><b>Ушибу ногами</b><small>CS2 / штаб сезона</small></span>
    </div>
    <h1>Вход в штаб</h1>
    <p class="hint">Выбери себя и введи личный пароль.</p>
    ${error ? '<p class="err">Неверный ник или пароль.</p>' : ''}
    <form method="POST" action="/api/login">
      <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
      <div class="row">
        <label for="u">Кто ты</label>
        <select id="u" name="user" autocomplete="username" required>${options}</select>
      </div>
      <div class="row">
        <label for="p">Пароль</label>
        <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
      </div>
      <button type="submit">Войти</button>
    </form>
    <p class="foot">Пароль личный. Потерял — напиши капитану.</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, must-revalidate',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

function misconfigured() {
  return new Response('Штаб временно недоступен.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default async function middleware(request) {
  const users = loadUsers();
  if (!users.length || !process.env.AUTH_SECRET) return misconfigured();
  const user = await verifySession(readCookie(request, SESSION_COOKIE), users);
  if (user) return next();

  const url = new URL(request.url);
  const retry = url.searchParams.get('login_error') === '1';
  return loginPage({
    users,
    nextPath: retry ? safeLocalPath(url.searchParams.get('next')) : safeLocalPath(url.pathname + url.search),
    selected: retry ? String(url.searchParams.get('user') || '') : '',
    error: retry
  });
}
