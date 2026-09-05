import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-05T12:00:00+03:00') });
  await page.route('**/api/state', route => route.fulfill({ json: { me: { id: 'test', nick: 'D4ba' }, team: { checks: {}, notes: {} }, personal: { checks: {} } } }));
});
test('brief connects the next match, personal task and unresolved session', async ({ page }) => {
  await page.goto('/#/obzor');
  const brief = page.locator('.match-brief');
  await expect(brief).toContainText('Cache');
  await expect(brief).toContainText('Первый контакт только под флешку');
  await expect(page.locator('#overview')).toContainText('Mirage · 02.09 — результат не подтверждён');
  await expect(page.locator('#overview')).not.toContainText('Следующая обязательная — Mirage');
  await expect(page.locator('#overview')).not.toContainText('Dust 2 и Inferno готовы');
  await brief.getByRole('button', { name: /Тренировка Nuke/ }).click();
  await expect(page.locator('#session-s03')).toBeInViewport();
});
test('next match rolls forward and season end is explicit', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+03:00'));
  await page.goto('/#/obzor');
  await expect(page.locator('.match-brief')).toContainText('Такахули');
  await page.clock.setFixedTime(new Date('2026-10-23T12:00:00+03:00'));
  await page.reload();
  await expect(page.locator('.match-brief')).toContainText('Матчи по расписанию завершены');
  await expect(page.locator('#overview')).not.toContainText('День игры.');
});
test('match distinguishes observed rates and model estimates and shows clutch denominator', async ({ page }) => {
  await page.goto('/#/statistika/match/m01');
  await expect(page.locator('#statistics')).toContainText('32 из 276 клатчей');
  await expect(page.locator('#statistics')).toContainText('Наблюдаемые WR');
  await expect(page.locator('.stats-verdict')).toContainText('Оценка модели');
});
