/* ============================================================
   Гейт сайта. Пускает только по сессии конкретного игрока.

   Открыто без входа:
     assets/fonts/, assets/img/ — нужны самой форме входа
     api/                       — функции проверяют сессию сами
   Всё остальное, включая данные тактик, закрыто.
   ============================================================ */

import { next } from '@vercel/functions';
import { verifySession, readCookie, loadUsers, SESSION_COOKIE } from './lib/auth.js';

export const config = {
  matcher: ['/((?!assets/fonts/|assets/img/|api/|_vercel/).*)'],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

function loginPage({ users, nextPath = '/', selected = '', error = false, status = 401 }) {
  const options = users
    .map((u) => `<option value="${escapeHtml(u.id)}"${u.id === selected ? ' selected' : ''}>${escapeHtml(u.nick)}</option>`)
    .join('');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>Штаб CS2 — Ушибу ногами</title>
<link rel="icon" href="/assets/img/logo.jpg">
<style>
@font-face{font-family:'Oswald';font-weight:200 700;font-display:swap;
  src:url('/assets/fonts/oswald-cyrillic.woff2') format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Oswald';font-weight:200 700;font-display:swap;
  src:url('/assets/fonts/oswald-latin.woff2') format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122}
@font-face{font-family:'Inter';font-weight:100 900;font-display:swap;
  src:url('/assets/fonts/inter-cyrillic.woff2') format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Inter';font-weight:100 900;font-display:swap;
  src:url('/assets/fonts/inter-latin.woff2') format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122}
@font-face{font-family:'JetBrains Mono';font-weight:100 800;font-display:swap;
  src:url('/assets/fonts/jbmono-cyrillic.woff2') format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'JetBrains Mono';font-weight:100 800;font-display:swap;
  src:url('/assets/fonts/jbmono-latin.woff2') format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122}

*,*::before,*::after{box-sizing:border-box}
:root{--bg:#07030d;--surface:#100a1b;--line:#2a2039;--line-strong:#3d3153;
  --text:#f4eef9;--dim:#b3a8c4;--mute:#8a7ea4;--accent:#ff2e7e;--violet:#8a4bff;--ink:#14030a}
html,body{height:100%}
body{margin:0;display:grid;place-items:center;padding:24px;color:var(--text);
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  background:
    radial-gradient(1000px 600px at 84% -12%,rgba(255,46,126,.16),transparent 62%),
    radial-gradient(860px 680px at 4% 108%,rgba(138,75,255,.16),transparent 60%),
    repeating-linear-gradient(0deg,transparent 0 39px,rgba(244,238,249,.02) 39px 40px),
    repeating-linear-gradient(90deg,transparent 0 39px,rgba(244,238,249,.02) 39px 40px),
    var(--bg);
  -webkit-font-smoothing:antialiased}
body::after{content:'';position:fixed;inset:0;pointer-events:none;opacity:.2;mix-blend-mode:soft-light;
  background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.55) 0 1px,transparent 1px 3px)}
.gate{position:relative;width:100%;max-width:420px;padding:36px 32px 32px;
  background:var(--surface);border:1px solid var(--line)}
.gate::before,.gate::after{content:'';position:absolute;width:14px;height:14px;pointer-events:none}
.gate::before{top:-1px;left:-1px;border-top:1px solid rgba(255,46,126,.4);border-left:1px solid rgba(255,46,126,.4)}
.gate::after{right:-1px;bottom:-1px;border-right:1px solid rgba(138,75,255,.45);border-bottom:1px solid rgba(138,75,255,.45)}
.brand{display:flex;align-items:center;gap:13px;margin-bottom:30px}
.brand img{width:48px;height:48px;flex:0 0 auto;object-fit:cover;background:#040209;
  transform:scale(1.24);box-shadow:0 0 30px -10px rgba(255,46,126,.42)}
.brand b{display:block;font-family:'Oswald',system-ui,sans-serif;font-size:21px;font-weight:600;
  line-height:1;letter-spacing:-.02em;text-transform:uppercase}
.brand small{display:block;margin-top:5px;color:var(--mute);font-family:'JetBrains Mono',monospace;
  font-size:11px;letter-spacing:.12em;text-transform:uppercase}
h1{margin:0 0 8px;font-family:'Oswald',system-ui,sans-serif;font-size:32px;font-weight:700;
  line-height:1;letter-spacing:-.02em;text-transform:uppercase}
p.hint{margin:0 0 24px;color:var(--dim);font-size:14px;line-height:1.5}
label{display:block;margin:0 0 8px;color:var(--accent);font-family:'JetBrains Mono',monospace;
  font-size:12px;letter-spacing:.12em;text-transform:uppercase}
select,input{width:100%;padding:14px;color:var(--text);background:#040209;border:1px solid var(--line);
  border-radius:0;font-family:'JetBrains Mono',monospace;font-size:16px}
select{appearance:none;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,var(--accent) 50%),linear-gradient(135deg,var(--accent) 50%,transparent 50%);
  background-position:calc(100% - 19px) 22px,calc(100% - 13px) 22px;background-size:6px 6px,6px 6px;background-repeat:no-repeat}
input{letter-spacing:.16em}
select:hover,input:hover{border-color:var(--line-strong)}
select:focus,input:focus{outline:none;border-color:rgba(255,46,126,.4)}
.row+.row{margin-top:16px}
button{width:100%;margin-top:20px;min-height:50px;color:var(--ink);background:var(--accent);
  border:0;cursor:pointer;font-family:'Oswald',system-ui,sans-serif;font-size:17px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;box-shadow:0 0 30px -10px rgba(255,46,126,.42);transition:filter .18s}
button:hover{filter:brightness(1.12)}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.err{margin:0 0 18px;padding:11px 13px;border-left:2px solid var(--accent);
  background:rgba(255,46,126,.13);font-family:'JetBrains Mono',monospace;font-size:12px}
.foot{margin:22px 0 0;color:var(--mute);font-family:'JetBrains Mono',monospace;font-size:11px;
  letter-spacing:.06em;text-transform:uppercase;line-height:1.6}
@media (prefers-reduced-motion:reduce){*{transition-duration:.001ms!important}}
</style>
</head>
<body>
  <main class="gate">
    <div class="brand">
      <img src="/assets/img/logo.jpg" alt="" width="48" height="48">
      <span><b>Ушибу ногами</b><small>CS2 / штаб сезона</small></span>
    </div>
    <h1>Вход в штаб</h1>
    <p class="hint">Выбери себя и введи свой пароль. Прогресс по гранатам и правилам у каждого свой.</p>
    ${error ? '<p class="err">Неверный ник или пароль.</p>' : ''}
    <form method="POST" action="/api/login">
      <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
      <div class="row">
        <label for="u">Кто ты</label>
        <select id="u" name="user" required>${options}</select>
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
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, must-revalidate',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function misconfigured(message) {
  return new Response(message, {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function middleware(request) {
  const users = loadUsers();
  if (!users.length) return misconfigured('Состав не настроен: задайте переменную окружения TEAM_USERS.');
  if (!process.env.AUTH_SECRET) return misconfigured('Не задана переменная окружения AUTH_SECRET.');

  const url = new URL(request.url);

  const userId = await verifySession(readCookie(request, SESSION_COOKIE));
  if (userId && users.some((u) => u.id === userId)) return next();

  // Возврат после неудачного входа: /?login_error=1&user=...&next=...
  const isRetry = url.searchParams.get('login_error') === '1';
  const target = isRetry
    ? safeNextPath(url.searchParams.get('next'))
    : url.pathname + url.search;

  return loginPage({
    users,
    nextPath: target,
    selected: isRetry ? String(url.searchParams.get('user') || '') : '',
    error: isRetry,
  });
}
