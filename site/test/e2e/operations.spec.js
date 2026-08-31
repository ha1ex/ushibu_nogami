import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { validateOperations } from '../../scripts/validate-content.mjs';

const operationsFixture = JSON.parse(await readFile(new URL('../../assets/data/operations.json', import.meta.url), 'utf8'));

let pageErrors;
test.beforeEach(async ({ page, request }) => {
  await request.post('/__test/reset');
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(async () => {
  expect(pageErrors).toEqual([]);
});

test('home is an operational route with semantic navigation and no Whoajor requests', async ({ page }) => {
  const heavyRequests = [];
  page.on('request', (request) => {
    if (/stats(?:-core)?\.js|assets\/data\/whoajor/.test(request.url())) heavyRequests.push(request.url());
  });
  await page.goto('/#/seichas');
  await expect(page.getByRole('heading', { level: 1, name: 'Сейчас' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы штаба' }).getByRole('link')).toHaveCount(6);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Данные/ })).toHaveAttribute('href', '#/statistika');
  expect(heavyRequests).toEqual([]);
});

test('now shows the nearest match, honest blockers and at most three actions', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-31T12:00:00+03:00'));
  await page.goto('/#/seichas');
  await expect(page.getByText('Поцелуй всадницу', { exact: true })).toBeVisible();
  await expect(page.locator('.ops-match-hero time')).toHaveText('30.09.2026');
  await expect(page.getByRole('heading', { level: 3, name: 'Вето не утверждено' })).toBeVisible();
  await expect(page.getByText(/время матча/i)).toBeVisible();
  await expect(page.getByText(/фактическая пятёрка/i)).toBeVisible();
  await expect(page.locator('[data-card-type="action"]')).toHaveCount(3);
  await expect(page.locator('#operational')).not.toContainText(/reviewed|insight|готовность|evidence|sha-256|\bPICK\b/i);
});

test('now advances to the next scheduled match between match windows', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+03:00'));
  await page.goto('/#/seichas');
  await expect(page.getByText('Рассадник добра', { exact: true })).toBeVisible();
  await expect(page.locator('.ops-match-hero time')).toHaveText('21.10.2026');
  await expect(page.getByText(/ближайший предстоящий матч/i)).toBeVisible();
});

test('now shows the final match with an honest fallback after the season', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00+03:00'));
  await page.goto('/#/seichas');
  await expect(page.getByText('Smoke mid everyday', { exact: true })).toBeVisible();
  await expect(page.locator('.ops-match-hero time')).toHaveText('22.10.2026');
  await expect(page.getByText(/все матчи расписания прошли.*показан последний матч/i)).toBeVisible();
});

test('veto status on list and detail follows the explicitly linked typed card', async ({ page }) => {
  const operations = structuredClone(operationsFixture);
  const match = operations.matches.find((item) => item.id === 'm01');
  match.cards = match.cards.filter((card) => !['unknown-m01-veto', 'action-m01-record-veto'].includes(card.id));
  match.cards.push({
    id: 'decision-m01-veto', type: 'decision', title: 'Вето утверждено',
    body: 'Капитан зафиксировал согласованную ветку вето.', owner: 'Капитан',
    decidedAt: '2026-09-29', rationale: 'Пятёрка подтвердила командное решение.',
    evidenceIds: ['fact-m01-schedule']
  });
  match.vetoCardId = 'decision-m01-veto';
  const validation = validateOperations(operations);
  expect(validation.valid, validation.errors.join('\n')).toBe(true);
  await page.route('**/assets/data/operations.json', (route) => route.fulfill({ json: operations }));

  await page.goto('/#/matchi');
  const row = page.locator('.ops-list-row').filter({ hasText: 'Поцелуй всадницу' });
  await expect(row).toContainText('Вето утверждено');
  await row.getByRole('link', { name: 'Открыть матч' }).click();
  await expect(page.locator('.ops-status-strip')).toHaveText(/Вето утверждено/);
  await expect(page.locator('[data-card-type="decision"]')).toContainText('Вето утверждено');
});

test('match detail exposes actions, notes, checklists and score using stable shared keys', async ({ page }) => {
  const posts = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/state') && request.method() === 'POST') posts.push(request.postDataJSON());
  });
  await page.goto('/#/match/m01');
  await expect(page.getByRole('heading', { level: 1, name: /Поцелуй всадницу/ })).toBeVisible();
  await expect(page.locator('fieldset.ops-score > legend')).toContainText('Фактический счёт');
  await expect(page.locator('.ops-status-strip')).toHaveText(/Вето не утверждено/);
  const action = page.locator('[data-check="action-m01-confirm-time"]');
  await expect(action.locator('xpath=..')).toContainText(/выполнение действия/i);
  await expect(action.locator('xpath=..')).not.toContainText(/осво/i);
  await action.check();
  const note = page.locator('[data-note="match-m01-note"]');
  await note.fill('Подтверждение ждём в чате лиги');
  await page.locator('[data-score="ours"]').fill('13');
  await page.locator('[data-score="theirs"]').fill('9');
  await page.locator('[data-score="played"]').check();
  await expect.poll(() => posts.some((body) => body.operations?.some((operation) =>
    operation.type === 'check.set' && operation.key === 'action-m01-confirm-time' && operation.value === true
  ))).toBeTruthy();
  await expect.poll(() => posts.some((body) => body.operations?.some((operation) =>
    operation.type === 'note.set' && operation.key === 'match-m01-note' && operation.value === 'Подтверждение ждём в чате лиги'
  ))).toBeTruthy();
  await expect.poll(() => posts.some((body) => body.operations?.some((operation) =>
    operation.type === 'score.set' && operation.key === 'match-m01-score' && operation.value.ours === 13 && operation.value.theirs === 9
  ))).toBeTruthy();
  await page.reload();
  await expect(action).toBeChecked();
  await expect(note).toHaveValue('Подтверждение ждём в чате лиги');
  await expect(page.locator('[data-score="ours"]')).toHaveValue('13');
  await expect(page.locator('[data-score="theirs"]')).toHaveValue('9');
});

test('training keeps Inferno outcome unknown and provides an editable factual report', async ({ page }) => {
  await page.goto('/#/trenirovki');
  await expect(page.getByRole('heading', { level: 1, name: 'Тренировки' })).toBeVisible();
  await expect(page.locator('.ops-training__title')).toContainText('Inferno');
  await expect(page.locator('.ops-training__title time')).toHaveText('29.08.2026');
  await expect(page.getByText(/результат.*не подтверждён/i)).toBeVisible();
  await expect(page.locator('#operational')).not.toContainText(/Inferno готова|Inferno освоена/i);
  await expect(page.locator('[data-note="training-inferno-report"]')).toBeEditable();
  await expect(page.locator('[data-check="training-inferno-report-complete"]')).toBeVisible();
});

test('all seven maps have the same unpublished protocol state', async ({ page }) => {
  await page.goto('/#/karty');
  await expect(page.locator('[data-map-id]')).toHaveCount(7);
  await expect(page.getByText('Проверенный протокол не опубликован', { exact: true })).toHaveCount(7);
  await page.getByRole('link', { name: /Inferno/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inferno' })).toBeVisible();
  await expect(page.getByText('Проверенный протокол не опубликован', { exact: true })).toBeVisible();
});

test('four opponent cards and detail remain operational and do not load Whoajor', async ({ page }) => {
  const heavyRequests = [];
  page.on('request', (request) => {
    if (/stats(?:-core)?\.js|assets\/data\/whoajor/.test(request.url())) heavyRequests.push(request.url());
  });
  await page.goto('/#/soperniki');
  await expect(page.locator('[data-opponent-id]')).toHaveCount(4);
  await expect(page.getByText(/сыгранность.*не измерена/i)).toHaveCount(4);
  await page.getByRole('link', { name: /Поцелуй всадницу/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Поцелуй всадницу' })).toBeVisible();
  expect(heavyRequests).toEqual([]);
});

test('legacy operational routes canonicalize immediately', async ({ page }) => {
  for (const [legacy, canonical, heading] of [
    ['obzor', 'seichas', 'Сейчас'], ['taktiki', 'karty', 'Карты'],
    ['reglament', 'trenirovki', 'Тренировки'], ['golosovanie', 'seichas', 'Сейчас']
  ]) {
    await page.goto('/#/' + legacy);
    await expect(page).toHaveURL(new RegExp(`#/${canonical}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await page.goto('/#/statistika/match/m01');
  await expect(page).toHaveURL(/#\/match\/m01$/);
  await page.goto('/#/statistika/sopernik/pocelui');
  await expect(page).toHaveURL(/#\/soperniki\/pocelui$/);
});

test('pravila.html redirects accessibly to the canonical home', async ({ page }) => {
  await page.goto('/pravila.html');
  await expect(page).toHaveURL(/index\.html#\/seichas$/);
});

test('content load failure is announced and retryable', async ({ page }) => {
  let failures = 0;
  await page.route('**/assets/data/operations.json', async (route) => {
    if (failures++ === 0) return route.fulfill({ status: 503, body: 'transient' });
    return route.continue();
  });
  await page.goto('/#/seichas');
  await expect(page.locator('#operational [role="status"]')).toContainText(/ошибка/i);
  await page.getByRole('button', { name: /повторить/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сейчас' })).toBeVisible();
});

for (const width of [320, 375, 640]) {
  test(`operational routes fit ${width}px and keep interactive targets usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const hash of ['#/seichas', '#/match/m01', '#/trenirovki', '#/karty', '#/soperniki']) {
      await page.goto('/' + hash);
      await expect(page.locator('#operational h1')).toBeVisible();
      const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(layout.scroll, hash).toBeLessThanOrEqual(layout.client);
      const tooSmall = await page.locator('#operational a, #operational button, #operational input, #operational textarea, #operational summary, #operational label.check').evaluateAll((nodes) => nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5);
      }).map((node) => {
        const box = node.getBoundingClientRect();
        return { node: node.outerHTML.slice(0, 120), width: box.width, height: box.height };
      }));
      expect(tooSmall, hash).toEqual([]);
    }
  });
}

test('runtime operational markup contains no inline styles', async ({ page }) => {
  for (const hash of ['#/seichas', '#/match/m01', '#/trenirovki', '#/karty', '#/soperniki']) {
    await page.goto('/' + hash);
    await expect(page.locator('#operational [style]')).toHaveCount(0);
  }
});
