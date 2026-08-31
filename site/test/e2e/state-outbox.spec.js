import { expect, test } from '@playwright/test';

const OUTBOX_KEY = 'ushibu.cs2.outbox.v4';
const OUTBOX_OWNER_KEY = 'ushibu.cs2.outbox.v4.owner';

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
});

test('failed fetch leaves immutable outbox across reload and manual retry is accessible', async ({ page }) => {
  let failed = false;
  await page.route('**/api/state', async (route) => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      return route.abort('connectionfailed');
    }
    return route.continue();
  });
  await page.goto('/#/match/m01');
  await page.locator('[data-check="action-m01-confirm-time"]').check();
  await expect(page.locator('#syncbar')).toContainText(/нет связи|ошибка/i);
  await expect(page.getByRole('button', { name: 'Повторить синхронизацию' })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, OUTBOX_KEY)).toBe(1);

  await page.unroute('**/api/state');
  await page.reload();
  await expect(page.locator('[data-check="action-m01-confirm-time"]')).toBeChecked();
  await page.getByRole('button', { name: 'Повторить синхронизацию' }).click();
  await expect(page.locator('#syncbar')).toContainText(/всё сохранено/i);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, OUTBOX_KEY)).toBe(0);
});

test('one JSON ack removes exactly the sent head and preserves the next mutation', async ({ page }) => {
  let posts = 0;
  let secondRoute;
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    if (posts === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"revision":1}' });
    secondRoute = route;
  });
  await page.goto('/#/match/m01');
  await page.locator('[data-check="action-m01-confirm-time"]').check();
  await page.locator('[data-note="match-m01-note"]').fill('second mutation');
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, OUTBOX_KEY)).toBe(2);
  await expect.poll(() => posts).toBe(1);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, OUTBOX_KEY)).toBe(1);
  const pending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), OUTBOX_KEY);
  expect(pending[0].operations).toEqual([
    { type: 'note.set', key: 'match-m01-note', value: 'second mutation' }
  ]);
  if (secondRoute) await secondRoute.abort();
});

test('pagehide beacon sends a copy and never clears the pending head', async ({ page }) => {
  await page.goto('/#/match/m01');
  await page.locator('[data-check="action-m01-confirm-time"]').check();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const pending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), OUTBOX_KEY);
  expect(pending).toHaveLength(1);
  expect(pending[0].operations[0].key).toBe('action-m01-confirm-time');
  await expect.poll(async () => {
    const response = await page.request.get('/api/state');
    return (await response.json()).state.checks['action-m01-confirm-time'];
  }).toBe(true);
});

test('typed check, note, training report and structured score survive server reload', async ({ page }) => {
  await page.goto('/#/match/m01');
  await page.locator('[data-check="action-m01-confirm-time"]').check();
  await page.locator('[data-note="match-m01-note"]').fill('Подтверждено капитаном');
  await page.locator('[data-score="ours"]').fill('13');
  await page.locator('[data-score="theirs"]').fill('9');
  await page.locator('[data-score="played"]').check();
  await expect(page.locator('#syncbar')).toContainText(/всё сохранено/i);

  await page.goto('/#/trenirovki');
  await page.locator('[data-note="training-inferno-report"]').fill('Пятеро прошли выход на B');
  await page.locator('[data-check="training-inferno-report-complete"]').check();
  await expect(page.locator('#syncbar')).toContainText(/всё сохранено/i);

  await page.reload();
  await expect(page.locator('[data-note="training-inferno-report"]')).toHaveValue('Пятеро прошли выход на B');
  await expect(page.locator('[data-check="training-inferno-report-complete"]')).toBeChecked();
  await page.goto('/#/match/m01');
  await expect(page.locator('[data-check="action-m01-confirm-time"]')).toBeChecked();
  await expect(page.locator('[data-note="match-m01-note"]')).toHaveValue('Подтверждено капитаном');
  await expect(page.locator('[data-score="ours"]')).toHaveValue('13');
  await expect(page.locator('[data-score="theirs"]')).toHaveValue('9');
  await expect(page.locator('[data-score="played"]')).toBeChecked();
});

test('pending local mutations replay over a newer GET base in FIFO order', async ({ page }) => {
  await page.addInitScript(({ key, ownerKey }) => {
    localStorage.setItem(key, JSON.stringify([
      { mutationId: 'A234567890123456', operations: [{ type: 'note.set', key: 'match-m01-note', value: 'offline first' }] },
      { mutationId: 'B234567890123456', operations: [{ type: 'note.set', key: 'match-m01-note', value: 'offline latest' }] }
    ]));
    localStorage.setItem(ownerKey, 'tester');
  }, { key: OUTBOX_KEY, ownerKey: OUTBOX_OWNER_KEY });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ me: { id: 'tester', nick: 'Тестер' }, state: { checks: {}, notes: { 'match-m01-note': 'server base' }, scores: {} }, revision: 5 })
    });
    return route.abort('connectionfailed');
  });
  await page.goto('/#/match/m01');
  await expect(page.locator('[data-note="match-m01-note"]')).toHaveValue('offline latest');
  await expect(page.getByRole('button', { name: 'Повторить синхронизацию' })).toBeVisible();
});

test('outbox is replayed only for its confirmed session user and survives a same-user login', async ({ page }) => {
  await page.goto('/assets/img/logo.jpg');
  await page.evaluate(({ key, ownerKey }) => {
    localStorage.setItem(key, JSON.stringify([
      { mutationId: 'A234567890123456', operations: [{ type: 'note.set', key: 'match-m01-note', value: 'belongs to alice' }] }
    ]));
    localStorage.setItem(ownerKey, 'alice');
  }, { key: OUTBOX_KEY, ownerKey: OUTBOX_OWNER_KEY });
  var posts = 0;
  await page.route('**/api/state', async (route) => {
    if (route.request().method() === 'POST') { posts += 1; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await page.goto('/#/match/m01');
  await page.waitForTimeout(900);
  expect(posts).toBe(0);
  await expect(page.locator('[data-note="match-m01-note"]')).not.toHaveValue('belongs to alice');
  expect(await page.evaluate(() => localStorage.getItem('ushibu.cs2.outbox.v4.user.alice'))).toContain('belongs to alice');

  await page.request.post('/__test/reset', { data: { me: { id: 'alice', nick: 'Alice' } } });
  await page.reload();
  await expect(page.locator('[data-note="match-m01-note"]')).toHaveValue('belongs to alice');
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, OUTBOX_KEY)).toBe(1);
});
