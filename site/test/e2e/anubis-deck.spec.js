import { test, expect } from '@playwright/test';

const deckUrl = process.env.ANUBIS_DECK_URL || '/playbooks/anubis/index.html';

function slideUrl(index) {
  return `${deckUrl}?slide=${index}`;
}

test('Anubis deck exposes 22 slides and keeps keyboard, picker and timer navigation usable', async ({ page }) => {
  await page.goto(deckUrl);

  await expect(page).toHaveTitle(/Anubis/i);
  await expect(page.locator('#jump-select option')).toHaveCount(22);
  await expect(page.locator('.slide[data-slide-index="1"]')).toHaveCount(1);
  await expect(page.locator('#progress-text')).toHaveText('01 / 22');

  const initialProgress = await page.locator('#progress-bar').evaluate((node) => getComputedStyle(node).getPropertyValue('--progress'));
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide[data-slide-index="2"]')).toHaveCount(1);
  await expect(page.locator('#progress-text')).toHaveText('02 / 22');
  await expect(page).toHaveURL(/\?slide=2$/);
  const nextProgress = await page.locator('#progress-bar').evaluate((node) => getComputedStyle(node).getPropertyValue('--progress'));
  expect(parseFloat(nextProgress)).toBeGreaterThan(parseFloat(initialProgress));

  await page.locator('#jump-select').selectOption('12');
  await expect(page.locator('.slide[data-slide-index="13"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\?slide=13$/);

  await page.locator('#next-button').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide[data-slide-index="14"]')).toHaveCount(1);

  const timerButton = page.locator('#timer-button');
  await timerButton.click();
  await expect(timerButton).toHaveText('Пауза');
  await expect(timerButton).toHaveAttribute('aria-pressed', 'true');
  await timerButton.click();
  await expect(timerButton).toHaveText('Старт');
});

test('Anubis lesson covers the required tactical phases with frequent visuals', async ({ page }) => {
  await page.goto(deckUrl);
  const labels = await page.locator('#jump-select option').allTextContents();
  const outline = labels.join('\n');

  for (const topic of [
    'Радар / коллы', 'Дефолт CT', 'Дефолт T', 'T решение', 'Мид / вода',
    'A роли', 'Выход A', 'B роли', 'Выход B', 'CT реакция', 'CT ретейк',
    'Гранаты 1–4', 'Гранаты 5–10', 'Домашняя работа'
  ]) {
    expect(outline, `missing ${topic}`).toContain(topic);
  }

  for (const index of [1, 3, 4, 6, 8, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22]) {
    await page.goto(slideUrl(index));
    await expect(page.locator('.slide')).toHaveAttribute('data-slide-index', String(index));
    await expect(page.locator('.slide h1, .slide h2').first()).toBeVisible();
    if ([3, 4, 6, 8, 10, 11, 13, 15, 16, 17, 18, 20, 21].includes(index)) {
      await expect(page.locator('.slide img').first(), `slide ${index} needs a visual`).toBeVisible();
    }
  }
});

test('tactical maps use exact anchor dots, leader lines and Russian labels', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(slideUrl(3));

  const expectedCallouts = [
    'Респаун T', 'Респаун CT', 'Мейн A', 'Коннектор A', 'Хевен A', 'Вода', 'Мост',
    'Двери мида', 'Спуск · 2026', 'Мейн B', 'Коннектор B', 'Е-бокс', 'Дальний B', 'Колонна'
  ];
  await expect(page.locator('.map-label')).toHaveCount(expectedCallouts.length);
  expect(await page.locator('.map-text').allTextContents()).toEqual(expectedCallouts);

  const invalidLabels = await page.locator('.map-label').evaluateAll((groups) => groups.filter((group) => {
    const dot = group.querySelector('.map-anchor');
    const line = group.querySelector('.map-line--label');
    const plaque = group.querySelector('.map-plaque');
    const label = group.querySelector('.map-text');
    if (!dot || !line || !plaque || !label) return true;
    const x = Number(dot.getAttribute('cx'));
    const y = Number(dot.getAttribute('cy'));
    const left = Number(plaque.getAttribute('x'));
    const top = Number(plaque.getAttribute('y'));
    const width = Number(plaque.getAttribute('width'));
    const height = Number(plaque.getAttribute('height'));
    const path = line.getAttribute('d') || '';
    return !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000 ||
      left < 0 || top < 0 || left + width > 1000 || top + height > 1000 ||
      !path.startsWith(`M ${x} ${y} L `) || Number(dot.getAttribute('r')) < 8 || !label.textContent.trim();
  }).length);
  expect(invalidLabels).toBe(0);

  for (const index of [13, 16]) {
    await page.goto(slideUrl(index));
    await expect(page.locator('.map-pin')).toHaveCount(5);
    await expect(page.locator('.map-pin__leader')).toHaveCount(5);
    const pinLabels = page.locator('.map-pin__label');
    await expect(pinLabels).toHaveCount(5);
    const englishRole = await pinLabels.evaluateAll((nodes) => nodes.some((node) => /Entry|Trader|Bomb|Utility|Flank|info/i.test(node.textContent || '')));
    expect(englishRole).toBe(false);
    const boxes = await pinLabels.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }));
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const overlap = boxes[a].left < boxes[b].right && boxes[a].right > boxes[b].left && boxes[a].top < boxes[b].bottom && boxes[a].bottom > boxes[b].top;
        expect(overlap, `slide ${index}, labels ${a + 1} and ${b + 1} overlap`).toBe(false);
      }
    }
  }
});

test('utility library has ten direct CSNADES cards with local position and aim frames', async ({ page }) => {
  const records = [];

  for (const index of [20, 21]) {
    await page.goto(slideUrl(index));
    const expectedCount = index === 20 ? 4 : 6;
    const cards = page.locator('.nade-card');
    await expect(cards).toHaveCount(expectedCount);

    for (let cardIndex = 0; cardIndex < expectedCount; cardIndex += 1) {
      const card = cards.nth(cardIndex);
      await card.scrollIntoViewIfNeeded();
      const images = card.locator('.nade-frame img');
      await expect(images).toHaveCount(2);
      await expect.poll(async () => images.evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0))).toBe(true);
      records.push(await card.evaluate((node) => ({
        href: node.querySelector('a.nade-link')?.href,
        text: node.textContent || '',
        sources: Array.from(node.querySelectorAll('.nade-frame img')).map((image) => image.getAttribute('src'))
      })));
    }
  }

  expect(records).toHaveLength(10);
  expect(new Set(records.map((record) => record.href)).size).toBe(10);
  expect(records.some((record) => /bridge-from-ct-spawn$/.test(record.href))).toBe(true);
  for (const record of records) {
    expect(record.href).toMatch(/^https:\/\/csnades\.gg\/anubis\/(smokes|molotovs|flashbangs|he-grenades)\/[a-z0-9-]+$/);
    expect(record.text).toMatch(/Владелец \/ резерв/);
    expect(record.text).toMatch(/L!S|D4ba|d0lfero|middle|Reconnecting/);
    expect(record.text).toMatch(/(?:5\/5|3\/3) в live-прогоне/);
    expect(record.sources).toHaveLength(2);
    expect(record.sources.every((source) => /^assets\/nades\/n\d{2}-(?:lineup|thumbnail)\.webp$/.test(source))).toBe(true);
  }
});

test('all Anubis slides and controls fit horizontally at the three presentation viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const viewport of [{ width: 1600, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (let index = 1; index <= 22; index += 1) {
      await page.goto(slideUrl(index));
      const fit = await page.locator('.slide').evaluate((slide) => {
        const header = document.querySelector('.deck-header').getBoundingClientRect();
        const footer = document.querySelector('.deck-footer').getBoundingClientRect();
        return {
          slideFits: slide.scrollWidth <= slide.clientWidth + 1,
          headerFits: header.left >= -1 && header.right <= innerWidth + 1 && header.top >= -1 && header.bottom <= innerHeight + 1,
          footerFits: footer.left >= -1 && footer.right <= innerWidth + 1 && footer.top >= -1 && footer.bottom <= innerHeight + 1,
          pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight
        };
      });
      expect(fit, `${viewport.width}x${viewport.height}, slide ${index}`).toEqual({ slideFits: true, headerFits: true, footerFits: true, pageFits: true });
    }
  }

  await page.goto(slideUrl(22));
  await expect(page.locator('#final-test-title')).toContainText('8 вопросов');
  await expect(page.locator('#final-test-title + .mini-grid > .mini-card')).toHaveCount(8);
});
