import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/state', route => route.fulfill({
    json: { me: { id: 'test', nick: 'D4ba' }, team: { checks: {}, notes: {} }, personal: { checks: {} } }
  }));
});

test('проведённые карты отмечены зелёным в тактиках', async ({ page }) => {
  await page.goto('/#/taktiki');

  for (const mapId of ['dust2', 'inferno', 'nuke']) {
    const marker = page.locator(`[data-map="${mapId}"] .playbook__order`);
    await expect(marker).toHaveClass(/playbook__order--done/);
    await expect(marker).toHaveCSS('background-color', 'rgb(43, 232, 176)');
  }
});

test('сводка проведённых карт перечисляет Nuke без повторяющегося союза', async ({ page }) => {
  await page.goto('/#/obzor');

  await expect(page.locator('#overview')).toContainText('Практиковали: Dust 2, Inferno и Nuke');
});

test('проведённая сессия Nuke не требует подтверждения результата', async ({ page }) => {
  await page.goto('/#/trenirovki');

  const nukeSession = page.locator('#session-s03');
  await expect(nukeSession).toContainText('проведена');
  await expect(nukeSession).not.toContainText('результат не подтверждён');
});
