import { test, expect } from '@playwright/test';

let pageErrors;
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(async () => {
  expect(pageErrors).toEqual([]);
});

test('ordinary overview cold load makes zero statistics requests', async ({ page }) => {
  const statsRequests = [];
  page.on('request', (request) => {
    if (/stats(?:-core)?\.js|assets\/data\/whoajor/.test(request.url())) statsRequests.push(request.url());
  });
  await page.goto('/#/obzor');
  await expect(page.getByRole('heading', { name: /Собрать маппул/ })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(8);
  expect(statsRequests).toEqual([]);
});

test('statistics overview is lazy, verified and links every population', async ({ page }) => {
  const statsRequests = [];
  page.on('request', (request) => {
    if (/stats(?:-core)?\.js|assets\/data\/whoajor/.test(request.url())) statsRequests.push(new URL(request.url()).pathname);
  });
  await page.goto('/#/statistika');
  await expect(page.getByRole('heading', { level: 1, name: 'Статистика' })).toBeVisible();
  await expect(page.getByText('Проекция из индивидуальной статистики')).toBeVisible();
  await expect(page.getByRole('link', { name: /81 игроков/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /368 исходных матчей/ })).toBeVisible();
  expect(statsRequests[0]).toBe('/assets/js/stats-core.js');
  expect(statsRequests).toContain('/assets/js/stats.js');
  expect(statsRequests).toContain('/assets/data/whoajor/current.json');
});

for (const [hash, heading] of [
  ['#/statistika/sopernik/pocelui', 'Поцелуй всадницу'],
  ['#/statistika/igrok/76561198050158798', 'enjoykaz'],
  ['#/statistika/match/m01', 'План матча'],
  ['#/statistika/maps', 'Карты'],
  ['#/statistika/weapons', 'Оружие'],
  ['#/statistika/trends', 'Тренды'],
  ['#/statistika/quality', 'Качество данных']
]) {
  test(`cold direct route ${hash} renders ${heading}`, async ({ page }) => {
    await page.goto('/' + hash);
    await expect(page.getByRole('heading', { name: heading, exact: false }).first()).toBeVisible();
    await expect(page.locator('#statistics [role=status]')).toContainText(/готово|результат|показано/i);
  });
}

test('nearest-match card and match plan show the opponent roster nicknames', async ({ page }) => {
  await page.goto('/#/statistika');
  const nearest = page.locator('.stats-next');
  await expect(nearest.getByRole('link', { name: 'professorkill', exact: true })).toBeVisible();
  await expect(nearest.getByRole('link', { name: 'Сквиртолог Анзол', exact: true })).toBeVisible();
  await expect(nearest.getByText(/Ростер 6 · пятёрка на матч не подтверждена/)).toBeVisible();

  await page.goto('/#/statistika/match/m01');
  const roster = page.locator('.stats-roster--full');
  await expect(roster.getByRole('listitem')).toHaveCount(6);
  await expect(roster.getByRole('link', { name: 'humarki', exact: true })).toBeVisible();
  await expect(roster.locator('li.is-threat')).toHaveCount(3);
  await roster.getByRole('link', { name: 'humarki', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'humarki' })).toBeVisible();
});

test('overview tab lists the first-match opponent roster without any statistics request', async ({ page }) => {
  const statsRequests = [];
  page.on('request', (request) => {
    if (/stats(?:-core)?\.js|assets\/data\/whoajor/.test(request.url())) statsRequests.push(request.url());
  });
  await page.goto('/#/obzor');
  const versus = page.locator('.versus-roster');
  await expect(versus.getByRole('listitem')).toHaveCount(6);
  await expect(versus.getByText('enjoykaz', { exact: true })).toBeVisible();
  expect(statsRequests).toEqual([]);
});

test('failed pointer stays local and ordinary tabs remain usable', async ({ page }) => {
  await page.route('**/assets/data/whoajor/current.json', (route) => route.fulfill({ status: 500, body: 'broken' }));
  await page.goto('/#/statistika');
  await expect(page.getByRole('button', { name: /повторить/i })).toBeVisible();
  await page.getByRole('tab', { name: /Обзор/ }).click();
  await expect(page.getByRole('heading', { name: /Собрать маппул/ })).toBeVisible();
});

test('match collaboration uses exact shared Store keys while evidence stays read-only', async ({ page }) => {
  const posts = [];
  page.on('request', async (request) => {
    if (request.url().endsWith('/api/state') && request.method() === 'POST') posts.push(request.postDataJSON());
  });
  await page.goto('/#/statistika/match/m01');
  const check = page.locator('[data-check="scout-v1-m01-brief-read"]');
  await check.check();
  const note = page.locator('[data-note="scout-v1-m01-brief-read"]');
  await note.fill('Готово к разбору');
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  expect(posts.some((body) => body.checks?.['scout-v1-m01-brief-read'] === true)).toBeTruthy();
  expect(posts.some((body) => body.notes?.['scout-v1-m01-brief-read'] === 'Готово к разбору')).toBeTruthy();
  await expect(page.locator('[data-evidence] input, [data-evidence] textarea, [data-evidence] button')).toHaveCount(0);
});

test('shared note keeps focus after its debounced save', async ({ page }) => {
  await page.goto('/#/statistika/match/m01');
  const note = page.locator('[data-note="scout-v1-m01-brief-read"]');
  await note.focus();
  await note.fill('Фокус не должен теряться');
  await page.waitForTimeout(900);
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('Фокус не должен теряться');
});

test('tab keyboard keeps focus on the selected tab and in-panel drill-down focuses its heading', async ({ page }) => {
  await page.goto('/#/obzor');
  const overviewTab = page.getByRole('tab', { name: /Обзор/ });
  await overviewTab.focus();
  await overviewTab.press('End');
  const statsTab = page.getByRole('tab', { name: /Статистика/ });
  await expect(statsTab).toBeFocused();
  await expect(statsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Статистика' })).toBeVisible();
  await page.getByRole('link', { name: /Поцелуй всадницу · Пик/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /План матча/ })).toBeFocused();
});

test('opponents tab enriches with verified comparison table and per-team stat boxes', async ({ page }) => {
  await page.goto('/#/soperniki');
  const compare = page.getByRole('table', { name: 'Сравнение команд' });
  await expect(compare).toBeVisible();
  await expect(compare.locator('tbody tr')).toHaveCount(5);
  await expect(compare.locator('tbody tr.is-us')).toHaveCount(1);
  const statsbox = page.locator('[data-team-stats="pocelui"]');
  await expect(statsbox).toContainText(/Rating/);
  await expect(statsbox).toContainText(/Сильнейшая карта/);
  await expect(statsbox).toContainText(/Пик/);
  const teamBrief = page.getByRole('link', { name: /открыть профиль Поцелуй всадницу/ });
  await expect(teamBrief).toBeVisible();
  await teamBrief.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Поцелуй всадницу' })).toBeVisible();

  await page.getByRole('tab', { name: /Матчи/ }).click();
  await expect(page.getByRole('link', { name: /Полный план Поцелуй всадницу/ }).first()).toBeVisible();
});

test('every metric column exposes a Russian tooltip explanation', async ({ page }) => {
  await page.goto('/#/soperniki');
  const compareHeads = page.getByRole('table', { name: 'Сравнение команд' }).locator('th.stats-help');
  await expect(compareHeads.first()).toBeVisible();
  expect(await compareHeads.count()).toBeGreaterThanOrEqual(10);
  for (const title of await compareHeads.evaluateAll((nodes) => nodes.map((node) => node.title))) {
    expect(title).toMatch(/[а-яА-ЯёЁ]/);
    expect(title.length).toBeGreaterThanOrEqual(20);
  }
  await page.goto('/#/statistika');
  const leagueButtons = page.getByRole('table', { name: 'Игроки лиги' }).locator('th button[title]');
  expect(await leagueButtons.count()).toBeGreaterThanOrEqual(10);
  await page.goto('/#/statistika/match/m01');
  const matrixHelp = page.getByRole('table', { name: 'Вето-матрица' }).locator('th.stats-help');
  expect(await matrixHelp.count()).toBeGreaterThanOrEqual(5);
});

test('browser back and forward restore statistics drill-downs', async ({ page }) => {
  await page.goto('/#/statistika');
  await page.getByRole('link', { name: /Поцелуй всадницу · Пик/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /План матча/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Статистика' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: /План матча/ })).toBeVisible();
});

test('malformed statistics hash yields local no-data state', async ({ page }) => {
  await page.goto('/#/statistika/igrok/7656119805015879');
  await expect(page.getByRole('heading', { level: 1, name: 'Нет данных' })).toBeVisible();
  await expect(page.locator('#statistics [role=status]')).toHaveText('Нет данных');
  await page.getByRole('tab', { name: /Тренировки/ }).click();
  await expect(page.getByRole('heading', { name: 'Тренировки' })).toBeVisible();
});

for (const [name, pattern] of [
  ['stats script', '**/assets/js/stats.js'],
  ['manifest', '**/assets/data/whoajor/*/manifest.json'],
  ['selected shard', '**/assets/data/whoajor/*/data/maps-000.json']
]) {
  test(`${name} failure remains inside statistics panel`, async ({ page }) => {
    await page.route(pattern, (route) => route.fulfill({ status: 500, body: 'broken' }));
    await page.goto(name === 'selected shard' ? '/#/statistika/maps' : '/#/statistika');
    await expect(page.getByRole('button', { name: /повторить/i })).toBeVisible();
    await expect(page.locator('#statistics [role=status]')).toHaveCount(1);
    await expect(page.locator('#statistics [role=status]')).toContainText(/ошибка|недоступна/i);
    await page.getByRole('tab', { name: /Обзор/ }).click();
    await expect(page.getByRole('heading', { name: /Собрать маппул/ })).toBeVisible();
  });
}

test('all controlled checklist IDs persist as team state and survive reload', async ({ page }) => {
  const posts = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/state') && request.method() === 'POST') posts.push(request.postDataJSON());
  });
  await page.goto('/#/statistika/match/m02');
  const expected = ['brief-read', 'veto-confirmed', 'anti-threat', 'matchday'].map((id) => `scout-v1-m02-${id}`);
  for (const key of expected) await page.locator(`[data-check="${key}"]`).check();
  const note = page.locator('[data-note="scout-v1-m02-matchday"]');
  await note.fill('Проверено всей командой');
  await expect.poll(() => posts.flatMap((body) => Object.keys(body.checks || {})).filter((key) => expected.includes(key)).length).toBeGreaterThanOrEqual(expected.length);
  await expect.poll(() => posts.some((body) => body.notes?.['scout-v1-m02-matchday'] === 'Проверено всей командой')).toBeTruthy();
  await page.reload();
  for (const key of expected) await expect(page.locator(`[data-check="${key}"]`)).toBeChecked();
  await expect(page.locator('[data-note="scout-v1-m02-matchday"]')).toHaveValue('Проверено всей командой');
});

test('overview heatmap covers the pool against every opponent with labelled cells', async ({ page }) => {
  await page.goto('/#/statistika');
  const heat = page.getByRole('table', { name: 'Тепловая карта' });
  await expect(heat.locator('tbody tr')).toHaveCount(7);
  await expect(heat.locator('tbody td[role=img]')).toHaveCount(28);
  await expect(heat.locator('.stats-heat__mark').filter({ hasText: 'ПИК' })).toHaveCount(4);
  await expect(heat.locator('.stats-heat__mark').filter({ hasText: 'БАН' })).toHaveCount(4);
  await expect(heat.locator('tbody td[role=img]').first()).toHaveAttribute('aria-label', /перевес|равные|нет данных/);
  await page.setViewportSize({ width: 1440, height: 900 });
  const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.client);
});

test('overview strip and headings never break words apart', async ({ page }) => {
  await page.goto('/#/statistika');
  await expect(page.locator('.stats-next__opp')).toHaveText('Поцелуй всадницу');
  const broken = await page.evaluate(() => {
    const nodes = document.querySelectorAll('.stats-next__opp, #statistics h1, #statistics h2');
    const offenders = [];
    nodes.forEach((node) => {
      const style = getComputedStyle(node);
      if (style.overflowWrap === 'anywhere' || style.wordBreak === 'break-all') offenders.push(node.textContent.slice(0, 40));
    });
    return offenders;
  });
  expect(broken).toEqual([]);
});

test('player side chart stays labelled and noninteractive', async ({ page }) => {
  await page.goto('/#/statistika/igrok/76561198050158798');
  const figure = page.locator('#statistics figure.stats-chart').first();
  const graphic = figure.locator(':scope[role=img]');
  await expect(graphic).toHaveCount(1);
  await expect(graphic).toHaveAttribute('aria-label', /Rating/);
  await expect(figure.locator('a, button, input, table')).toHaveCount(0);
});

test('pointer and versioned assets expose opposite cache policies in the test deployment', async ({ request }) => {
  const pointer = await request.get('/assets/data/whoajor/current.json');
  expect(pointer.headers()['cache-control']).toBe('no-cache, must-revalidate');
  const current = await (await request.get('/assets/data/whoajor/current.json')).json();
  const manifest = await request.get(`/assets/data/whoajor/${current.manifest}`);
  expect(manifest.headers()['cache-control']).toBe('private, max-age=31536000, immutable');
});

test('all catalog populations become reachable only through their drill-down', async ({ page }) => {
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto('/#/statistika');
  expect(paths.some((path) => /data\/(players|matches|maps|weapons|trendPlayers)-/.test(path))).toBeFalsy();

  await page.getByRole('link', { name: /81 игроков/ }).click();
  await expect(page.locator('#stats-player-directory a')).toHaveCount(81);
  expect(paths.some((path) => path.endsWith('/data/players-000.json'))).toBeTruthy();

  await page.getByRole('link', { name: /368 исходных матчей/ }).click();
  await expect(page.locator('#stats-match-directory a')).toHaveCount(368);
  expect(paths.some((path) => path.endsWith('/data/matches-000.json'))).toBeTruthy();
  await page.locator('#stats-match-directory a').first().click();
  await expect(page.getByRole('heading', { name: /Исходный матч/ })).toBeVisible();
  expect(paths.some((path) => path.includes('/data/matchPlayers-'))).toBeFalsy();
  await page.getByRole('button', { name: /Загрузить детали матча/ }).click();
  await expect.poll(() => paths.some((path) => path.includes('/data/matchPlayers-'))).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Игроки матча' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Rating' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Результат' })).toBeVisible();
});

test('one source match loads one indexed shard per labelled read-only detail table', async ({ page }) => {
  const matchId = 'auto-20231116-1908-de_anubis-Whoajor';
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto(`/#/statistika/match/${matchId}`);
  expect(paths.some((path) => /data\/(matchPlayers|matchRounds|matchPlayerWeapons)-/.test(path))).toBeFalsy();
  await page.getByRole('button', { name: 'Загрузить детали матча' }).click();
  for (const name of ['Игроки матча', 'Раунды матча', 'Оружие матча']) {
    await expect(page.getByRole('table', { name })).toBeVisible();
  }
  for (const dataset of ['matchPlayers', 'matchRounds', 'matchPlayerWeapons']) {
    expect(paths.filter((path) => path.includes(`/data/${dataset}-`)), dataset).toHaveLength(1);
  }
  await expect(page.locator('#stats-source-match-detail input, #stats-source-match-detail textarea')).toHaveCount(0);
});

test('player drill-down loads an indexed clutch shard and exposes a labelled read-only table', async ({ page }) => {
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto('/#/statistika/igrok/76561198003507847');
  const table = page.getByRole('table', { name: 'Клатчи игрока' });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toContainText(/Anubis|auto-/i);
  expect(paths.filter((path) => path.includes('/data/playerClutches-'))).toHaveLength(1);
  await expect(table.locator('input, textarea, button')).toHaveCount(0);
});

test('real player map table uses keyed map rows with actual map, rating and rounds', async ({ page }) => {
  await page.goto('/#/statistika/igrok/76561198050158798');
  const table = page.getByRole('table', { name: 'Карты игрока' });
  const anubis = table.locator('tbody tr').filter({ hasText: 'Anubis' });
  await expect(anubis).toHaveCount(1);
  await expect(anubis).toContainText('1.03');
  await expect(anubis).toContainText('280');
  await expect(table.locator('tbody tr').filter({ hasText: /Recent|AllTime/ })).toHaveCount(0);
});

test('aborted pointer load retries the newest statistics route instead of leaving loading stuck', async ({ page }) => {
  let currentRequests = 0;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  await page.route('**/assets/data/whoajor/current.json', async (route) => {
    currentRequests += 1;
    if (currentRequests === 1) {
      firstStarted();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });
  await page.goto('/#/statistika', { waitUntil: 'domcontentloaded' });
  await started;
  await page.evaluate(() => { window.location.hash = '#/statistika/maps'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Карты' })).toBeVisible();
  await expect(page.locator('#statistics [role=status]')).toContainText(/46|показано/i);
  expect(currentRequests).toBeGreaterThanOrEqual(2);
});

test('aborted shared dataset load is evicted and retried for the newest route', async ({ page }) => {
  let rosterRequests = 0;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  await page.route('**/data/rosters-000.json', async (route) => {
    rosterRequests += 1;
    if (rosterRequests === 1) {
      firstStarted();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });
  await page.goto('/#/statistika', { waitUntil: 'domcontentloaded' });
  await started;
  await page.evaluate(() => { window.location.hash = '#/statistika/sopernik/pocelui'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Поцелуй всадницу' })).toBeVisible();
  await expect(page.locator('#statistics [role=status]')).toContainText(/готово/i);
  expect(rosterRequests).toBeGreaterThanOrEqual(2);
});

test('match plan is answer-first: verdict, full pool matrix and veto tree with checklists', async ({ page }) => {
  await page.goto('/#/statistika/match/m01');
  await expect(page.locator('.stats-verdict__kicker').first()).toHaveText(/Пикаем/i);
  await expect(page.locator('.stats-verdict__card--ban .stats-verdict__kicker')).toHaveText(/Баним/i);
  const verdictBox = await page.locator('.stats-verdict').boundingBox();
  const matrixBox = await page.getByRole('table', { name: 'Вето-матрица' }).boundingBox();
  expect(verdictBox.y).toBeLessThan(matrixBox.y);
  await expect(page.getByRole('table', { name: 'Вето-матрица' }).locator('tbody tr')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Дерево вето' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Чеклист тренировки' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Чеклист матч-дня' })).toBeVisible();
  await expect(page.getByText('Подтвердить пятёрку до вето.')).toBeVisible();
});

test('comfort-vs-numbers conflict banner is visible and links to tactics', async ({ page }) => {
  await page.goto('/#/statistika/match/m01');
  const banner = page.locator('.stats-conflict');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Комфорт против цифр/i);
  await expect(banner).toContainText(/Dust 2/);
  await expect(banner.getByRole('link', { name: /Тактиках/ })).toHaveAttribute('href', '#/taktiki');
});

test('raw evidence ids never appear outside collapsed proof elements', async ({ page }) => {
  await page.goto('/#/statistika/match/m01');
  await expect(page.locator('#statistics')).toContainText(/Пикаем/i);
  const leaked = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById('statistics'), NodeFilter.SHOW_TEXT);
    const offenders = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!/player:7656|map-edge:|team:.+:recent:/.test(node.textContent)) continue;
      if (!node.parentElement.closest('details')) offenders.push(node.textContent.slice(0, 80));
    }
    return offenders;
  });
  expect(leaked).toEqual([]);
});

test('our own team page renders a non-empty seven-map self-scouting table', async ({ page }) => {
  await page.goto('/#/statistika/sopernik/us');
  await expect(page.getByRole('heading', { level: 1, name: 'Ушибу ногами' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Наши 7 карт' }).locator('tbody tr')).toHaveCount(7);
  await expect(page.getByText('Сигнал на тренировку')).toBeVisible();
});

test('source match isolates a failed detail shard, announces it and retries without hiding successful tables', async ({ page }) => {
  const matchId = 'auto-20231116-1908-de_anubis-Whoajor';
  let failures = 0;
  await page.route('**/data/matchRounds-000.json', async (route) => {
    if (failures++ === 0) return route.fulfill({ status: 503, body: 'transient' });
    await route.continue();
  });
  await page.goto(`/#/statistika/match/${matchId}`);
  const load = page.getByRole('button', { name: /детали матча/i });
  await load.click();
  await expect(page.getByRole('table', { name: 'Игроки матча' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Оружие матча' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Раунды матча' })).toHaveCount(0);
  await expect(page.locator('#statistics [role=status]')).toContainText(/ошибка.*раунды/i);
  await expect(load).toBeEnabled();
  await load.click();
  await expect(page.getByRole('table', { name: 'Раунды матча' })).toBeVisible();
  await expect(page.locator('#statistics [role=status]')).toContainText(/детали матча загружены/i);
});

test('map detail transient failure is announced and retryable', async ({ page }) => {
  let failures = 0;
  await page.route('**/data/playerMapStats-000.json', async (route) => {
    if (failures++ === 0) return route.fulfill({ status: 503, body: 'transient' });
    await route.continue();
  });
  await page.goto('/#/statistika/maps');
  const button = page.locator('#statistics tbody .stats-detail-button').first();
  await button.click();
  await expect(page.locator('#statistics [role=status]')).toContainText(/ошибка деталей/i);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button.locator('xpath=following-sibling::*[1]')).not.toContainText(/нет данных|загрузка/i);
});

test('weapon detail transient failure is announced and retryable', async ({ page }) => {
  let failures = 0;
  await page.route('**/data/playerWeaponStats-000.json', async (route) => {
    if (failures++ === 0) return route.fulfill({ status: 503, body: 'transient' });
    await route.continue();
  });
  await page.goto('/#/statistika/weapons');
  const button = page.locator('#statistics tbody .stats-detail-button').first();
  await button.click();
  await expect(page.locator('#statistics [role=status]')).toContainText(/ошибка деталей/i);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button.locator('xpath=following-sibling::*[1]')).not.toContainText(/нет данных|загрузка/i);
});

test('team pool matrix has its own accessible name and community maps stay collapsed', async ({ page }) => {
  await page.goto('/#/statistika/sopernik/pocelui');
  await expect(page.getByRole('table', { name: 'Вето-матрица' })).toBeVisible();
  const other = page.locator('details', { hasText: /Прочие карты вне пула/ }).first();
  await expect(other).toBeVisible();
  await expect(page.getByText('Fy Iceworld')).toBeHidden();
});

for (const [route, count, detailDataset] of [
  ['maps', 46, 'playerMapStats-000.json'],
  ['weapons', 39, 'playerWeaponStats-000.json'],
  ['trends', 20, 'playerMetrics-000.json']
]) {
  test(`${route} exposes all ${count} rows and defers detail data`, async ({ page }) => {
    const paths = [];
    page.on('request', (request) => paths.push(new URL(request.url()).pathname));
    await page.goto(`/#/statistika/${route}`);
    await expect(page.locator('#statistics tbody tr')).toHaveCount(count);
    expect(paths.some((path) => path.endsWith('/data/' + detailDataset))).toBeFalsy();
    await page.locator('#statistics tbody .stats-detail-button').first().click();
    await expect.poll(() => paths.some((path) => path.endsWith('/data/' + detailDataset))).toBeTruthy();
  });
}

test('sortable tables announce results and mobile layout has no document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/#/statistika/maps');
  const sort = page.getByRole('button', { name: /сортировать по матчам/i });
  await sort.click();
  await expect(sort.locator('xpath=..')).toHaveAttribute('aria-sort', /ascending|descending/);
  await expect(page.locator('#statistics [role=status]')).toContainText(/46|показано/i);
  const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width);
  const tooSmall = await page.locator('#statistics a, #statistics button, #statistics input, #statistics label.check').evaluateAll((nodes) => nodes.filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
  }).map((node) => node.outerHTML.slice(0, 120)));
  expect(tooSmall).toEqual([]);
});

test('overview interactive targets remain 44px at 320px and equivalent 200% layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/#/statistika');
  const tooSmall = await page.locator('#statistics a, #statistics button, #statistics input, #statistics textarea, #statistics summary, #statistics label.check').evaluateAll((nodes) => nodes.filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
  }).map((node) => node.outerHTML.slice(0, 120)));
  expect(tooSmall).toEqual([]);
  const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.client);
});

test('every statistics route avoids document overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const hash of [
    '#/statistika/sopernik/pocelui', '#/statistika/igrok/76561198050158798', '#/statistika/match/m01',
    '#/statistika/maps', '#/statistika/weapons', '#/statistika/trends', '#/statistika/quality'
  ]) {
    await page.goto('/' + hash);
    await expect(page.locator('#statistics [role=status]')).toContainText(/готово|показано/i);
    const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(layout.scroll, hash).toBeLessThanOrEqual(layout.client);
  }
});
