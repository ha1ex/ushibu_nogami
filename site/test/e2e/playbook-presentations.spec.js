import { test, expect } from '@playwright/test';

const presentations = [
  { id: 'dust2', name: 'Dust 2', path: 'playbooks/dust2/index.html' },
  { id: 'inferno', name: 'Inferno', path: 'playbooks/inferno/index.html' },
  { id: 'mirage', name: 'Mirage', path: 'playbooks/mirage/index.html' },
  { id: 'nuke', name: 'Nuke', path: 'playbooks/nuke/index.html' },
  { id: 'anubis', name: 'Anubis', path: 'playbooks/anubis/index.html' },
  { id: 'ancient', name: 'Ancient', path: 'playbooks/ancient/index.html' },
  { id: 'cache', name: 'Cache', path: 'playbooks/cache/index.html' }
];

async function openPresentation(page, id, name) {
  const card = page.locator('.playbook[data-map="' + id + '"]');
  if ((await card.getAttribute('open')) === null) await card.locator('summary').click();
  const trigger = card.getByRole('button', { name: 'Открыть презентацию ' + name });
  await trigger.click();
  const viewer = page.getByRole('dialog', { name: 'Презентация · ' + name });
  await expect(viewer).toBeVisible();
  return { trigger, viewer, frame: viewer.locator('iframe') };
}

test('each map opens its own presentation in the shared viewer', async ({ page, request }) => {
  await page.goto('/#/taktiki');

  for (const presentation of presentations) {
    const response = await request.get('/' + presentation.path);
    expect(response.status(), presentation.name + ' presentation should be served').toBe(200);

    const { trigger, viewer, frame } = await openPresentation(page, presentation.id, presentation.name);
    await expect(frame).toHaveAttribute('src', presentation.path);
    await expect(frame).toHaveAttribute('title', 'Презентация по карте ' + presentation.name);

    await expect.poll(async () => frame.evaluate((element) => ({
      path: element.contentWindow.location.pathname.replace(/^\//, ''),
      readyState: element.contentDocument.readyState
    }))).toEqual({ path: presentation.path, readyState: 'complete' });

    const viewport = await frame.evaluate((element) => ({
      frameWidth: element.clientWidth,
      frameHeight: element.clientHeight,
      contentWidth: element.contentWindow.innerWidth,
      contentHeight: element.contentWindow.innerHeight
    }));
    expect(viewport.contentWidth).toBe(viewport.frameWidth);
    expect(viewport.contentHeight).toBe(viewport.frameHeight);
    expect(viewport.contentWidth).toBeGreaterThan(0);
    expect(viewport.contentHeight).toBeGreaterThan(0);

    await viewer.getByRole('button', { name: 'Закрыть презентацию' }).click();
    await expect(viewer).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test('Escape closes the presentation and restores focus to its map button', async ({ page }) => {
  await page.goto('/#/taktiki');

  const { trigger, viewer } = await openPresentation(page, 'anubis', 'Anubis');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('viewer makes every outside body sibling inert and traps keyboard focus', async ({ page }) => {
  await page.goto('/#/taktiki');

  const { viewer, frame } = await openPresentation(page, 'dust2', 'Dust 2');
  await expect(page.locator('.skip-link')).toHaveJSProperty('inert', true);
  await expect(page.locator('.shell')).toHaveJSProperty('inert', true);

  const externalLink = viewer.getByRole('link', { name: 'Открыть отдельно' });
  await externalLink.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(frame).toBeFocused();

  await frame.evaluate((element) => {
    const focusable = Array.from(element.contentDocument.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((node) => !node.hidden && node.getClientRects().length > 0);
    focusable[focusable.length - 1].focus();
  });
  await page.keyboard.press('Tab');
  await expect(externalLink).toBeFocused();

  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press(step % 4 === 3 ? 'Shift+Tab' : 'Tab');
    const focusStayedInside = await viewer.evaluate((dialog, iframe) => {
      return dialog.contains(document.activeElement) || document.activeElement === iframe;
    }, await frame.elementHandle());
    expect(focusStayedInside, 'focus escaped the modal viewer on step ' + (step + 1)).toBe(true);
  }
});

test('closing restores pre-existing inert state on every outside sibling', async ({ page }) => {
  await page.goto('/#/taktiki');
  await page.locator('.shell').evaluate((shell) => { shell.inert = true; });

  const card = page.locator('.playbook[data-map="mirage"]');
  await card.locator('summary').evaluate((summary) => summary.click());
  const trigger = card.getByRole('button', { name: 'Открыть презентацию Mirage' });
  await trigger.evaluate((button) => button.click());
  const viewer = page.getByRole('dialog', { name: 'Презентация · Mirage' });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Закрыть презентацию' }).click();

  await expect(page.locator('.shell')).toHaveJSProperty('inert', true);
  await expect(page.locator('.skip-link')).toHaveJSProperty('inert', false);
});

test('Escape from focused iframe content closes viewer without duplicate handlers', async ({ page }) => {
  await page.goto('/#/taktiki');

  for (let opening = 0; opening < 2; opening += 1) {
    const { trigger, viewer, frame } = await openPresentation(page, 'anubis', 'Anubis');
    await expect.poll(async () => frame.evaluate((element) => element.contentDocument.readyState)).toBe('complete');
    const frameButton = page.frameLocator('.deck-viewer__frame').getByRole('button').first();
    await frameButton.focus();
    await expect(frameButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
