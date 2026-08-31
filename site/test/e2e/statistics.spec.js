import { test, expect } from '@playwright/test';

let pageErrors;
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(async () => expect(pageErrors).toEqual([]));

test('Data overview loads lazily, states methodology and avoids recommendations', async ({ page }) => {
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto('/#/statistika');
  await expect(page.getByRole('heading', { level: 1, name: 'Данные' })).toBeVisible();
  await expect(page.getByText(/снимок.*30\.08\.2026/i)).toBeVisible();
  await expect(page.getByText(/проекция из индивидуальных данных/i)).toBeVisible();
  await expect(page.getByText(/сыгранность.*не измерена/i)).toBeVisible();
  await expect(page.getByRole('link', { name: '7 карт в пуле' })).toBeVisible();
  expect(paths[0]).not.toContain('stats');
  expect(paths).toContain('/assets/js/stats-core.js');
  expect(paths).toContain('/assets/js/stats.js');
  expect(paths).toContain('/assets/data/whoajor/current.json');
  expect(paths.some((path) => path.endsWith('/data/recommendations-000.json'))).toBeFalsy();
});

test('Data overview and team remain neutral and hide technical IDs in a disclosure', async ({ page }) => {
  await page.goto('/#/statistika');
  await expect(page.locator('#statistics')).not.toContainText(/угроз|уязвим|эксплоит|готовност|reviewed|\bPICK\b/i);
  const diagnostic = page.locator('details.stats-diagnostics');
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).not.toHaveAttribute('open', '');
  await expect(diagnostic.locator('.stats-mono').first()).not.toBeVisible();

  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto('/#/statistika/team/pocelui');
  await expect(page.getByRole('heading', { level: 1, name: 'Поцелуй всадницу' })).toBeVisible();
  await expect(page.getByRole('table', { name: /показатели команды/i })).toBeVisible();
  await expect(page.locator('#statistics')).not.toContainText(/угроз|уязвим|эксплоит|риск|reviewed/i);
  expect(paths.some((path) => path.endsWith('/data/recommendations-000.json'))).toBeFalsy();
});

test('team comparison contains only bilateral samples from the seven canonical maps', async ({ page }) => {
  await page.goto('/#/statistika/team/pocelui');
  const rows = await page.getByRole('table', { name: 'Сравнение по картам' }).locator('tbody tr').evaluateAll((nodes) => nodes.map((row) =>
    Array.from(row.cells, (cell) => cell.textContent.trim())
  ));
  expect(rows).toHaveLength(7);
  expect(rows.map((row) => row[0]).sort()).toEqual([
    'Ancient', 'Anubis', 'Cache', 'Dust 2', 'Inferno', 'Mirage', 'Nuke'
  ]);
  for (const row of rows) {
    expect(Number(row[2]), `${row[0]} our sample`).toBeGreaterThan(0);
    expect(Number(row[3]), `${row[0]} opponent sample`).toBeGreaterThan(0);
    expect(row[4], `${row[0]} confidence`).toMatch(/^(низкая|средняя|высокая)$/);
  }
});

test('planned match IDs redirect to operations while source match IDs keep lazy detail', async ({ page }) => {
  await page.goto('/#/statistika/match/m02');
  await expect(page).toHaveURL(/#\/match\/m02$/);
  await expect(page.getByRole('heading', { level: 1, name: /Такахули/ })).toBeVisible();

  const matchId = 'auto-20231116-1908-de_anubis-Whoajor';
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto(`/#/statistika/match/${matchId}`);
  await expect(page.getByRole('heading', { name: /Исходный матч/ })).toBeVisible();
  expect(paths.some((path) => /data\/(matchPlayers|matchRounds|matchPlayerWeapons)-/.test(path))).toBeFalsy();
  await page.getByRole('button', { name: 'Загрузить детали матча' }).click();
  for (const name of ['Игроки матча', 'Раунды матча', 'Оружие матча']) {
    await expect(page.getByRole('table', { name })).toBeVisible();
  }
});

test('catalog populations remain lazy and verified', async ({ page }) => {
  const paths = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await page.goto('/#/statistika');
  expect(paths.some((path) => /data\/(players|matches|maps|weapons|trendPlayers)-/.test(path))).toBeFalsy();
  await page.getByRole('link', { name: /81 игроков/ }).click();
  await expect(page.locator('#stats-player-directory a')).toHaveCount(81);
  await page.getByRole('link', { name: /368 исходных матчей/ }).click();
  await expect(page.locator('#stats-match-directory a')).toHaveCount(368);
});

test('all primary map and weapon rows use exact human-readable labels', async ({ page }) => {
  await page.goto('/#/statistika/weapons');
  await expect(page.locator('#statistics tbody tr')).toHaveCount(39);
  const weaponLabels = await page.locator('#statistics tbody tr td:first-child').allTextContents();
  expect(weaponLabels.sort()).toEqual([
    'AK-47', 'AUG', 'AWP', 'CZ75-Auto', 'Desert Eagle', 'Dual Berettas', 'FAMAS', 'Five-SeveN',
    'G3SG1', 'Galil AR', 'Glock-18', 'M249', 'M4A1-S', 'M4A4', 'MAC-10', 'MAG-7', 'MP5-SD',
    'MP7', 'MP9', 'Negev', 'Nova', 'P2000', 'P250', 'P90', 'R8 Revolver', 'SCAR-20', 'SG 553',
    'SSG 08', 'Sawed-Off', 'Tec-9', 'USP-S', 'XM1014', 'Zeus x27', 'Коктейль Молотова', 'Нож',
    'Огонь', 'Осколочная граната', 'ПП-19 Бизон', 'UMP-45'
  ].sort());
  await page.goto('/#/statistika/maps');
  await expect(page.locator('#statistics tbody tr')).toHaveCount(7);
  const mapLabels = await page.locator('#statistics tbody tr td:first-child').allTextContents();
  expect(mapLabels.sort()).toEqual(['Ancient', 'Anubis', 'Cache', 'Dust 2', 'Inferno', 'Mirage', 'Nuke']);

  await page.goto('/#/statistika/igrok/76561198050158798');
  const playerMapTable = page.getByRole('table', { name: 'Карты игрока' });
  await expect(playerMapTable).toBeVisible();
  const playerMapLabels = await playerMapTable.locator('tbody tr td:first-child').allTextContents();
  expect(playerMapLabels.length).toBeGreaterThan(0);
  for (const label of playerMapLabels) {
    expect(['Ancient', 'Anubis', 'Cache', 'Dust 2', 'Inferno', 'Mirage', 'Nuke']).toContain(label);
  }

  const trendTable = page.getByRole('table', { name: 'Последние матчи тренда' });
  await expect(trendTable).toBeVisible();
  const trendMapLabels = await trendTable.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(trendMapLabels).toHaveLength(20);
  for (const label of trendMapLabels) {
    expect(['Ancient', 'Anubis', 'Cache', 'Dust 2', 'Inferno', 'Mirage', 'Nuke']).toContain(label);
  }
});

test('Data failures stay local, announced and retryable', async ({ page }) => {
  await page.route('**/assets/data/whoajor/current.json', (route) => route.fulfill({ status: 500, body: 'broken' }));
  await page.goto('/#/statistika');
  await expect(page.locator('#statistics [role="status"]')).toContainText(/ошибка/i);
  await expect(page.getByRole('button', { name: /повторить/i })).toBeVisible();
  await page.locator('[data-section="seichas"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сейчас' })).toBeVisible();
});

test('statistics charts use semantic meters and no inline styles', async ({ page }) => {
  await page.goto('/#/statistika/team/pocelui');
  await expect(page.locator('#statistics meter')).not.toHaveCount(0);
  await expect(page.locator('#statistics [style]')).toHaveCount(0);
});

test('Data routes fit mobile without shrinking touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const hash of ['#/statistika', '#/statistika/team/pocelui', '#/statistika/maps', '#/statistika/weapons', '#/statistika/trends', '#/statistika/quality']) {
    await page.goto('/' + hash);
    await expect(page.locator('#statistics h1')).toBeVisible();
    const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(layout.scroll, hash).toBeLessThanOrEqual(layout.client);
    const tooSmall = await page.locator('#statistics a, #statistics button, #statistics input, #statistics summary').evaluateAll((nodes) => nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5);
    }).map((node) => {
      const box = node.getBoundingClientRect();
      return { node: node.outerHTML.slice(0, 120), width: box.width, height: box.height };
    }));
    expect(tooSmall, hash).toEqual([]);
  }
});

test('pointer and versioned assets keep opposite cache policies', async ({ request }) => {
  const pointer = await request.get('/assets/data/whoajor/current.json');
  expect(pointer.headers()['cache-control']).toBe('no-cache, must-revalidate');
  const manifest = await request.get('/assets/data/whoajor/v1-84a051d7989725f2/manifest.json');
  expect(manifest.headers()['cache-control']).toBe('private, max-age=31536000, immutable');
});
