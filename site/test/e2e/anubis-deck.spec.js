import { test, expect } from '@playwright/test';

const deckUrl = process.env.ANUBIS_DECK_URL || '/playbooks/anubis/index.html';

function slideUrl(index) {
  return `${deckUrl}?slide=${index}`;
}

const diagramSlides = [3, 4, 6, 8, 10, 11, 12, 13, 15, 16, 17, 18, 21];
const presentationViewports = [
  { width: 1600, height: 836 },
  { width: 1366, height: 704 },
  { width: 1280, height: 656 }
];

const calloutAnchors = {
  't-spawn': [440, 932], 'ct-spawn': [399, 207], 'a-main': [809, 426],
  'a-connector': [602, 377], 'a-heaven': [674, 228], water: [681, 494],
  bridge: [469, 596], 'mid-doors': [524, 499], drop: [719, 531],
  'b-main': [244, 570], 'b-connector': [467, 327], ebox: [349, 588],
  'back-b': [359, 499], pillar: [264, 559]
};

function intersects(a, b, inset = 0) {
  return a.left + inset < b.right - inset && a.right - inset > b.left + inset &&
    a.top + inset < b.bottom - inset && a.bottom - inset > b.top + inset;
}

async function expectDiagramGeometry(page, slideIndex, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(slideUrl(slideIndex));
  const failures = await page.locator('.visual-frame').evaluate((frame) => {
    const issues = [];
    const svg = frame.querySelector('svg');
    const viewBox = svg.viewBox.baseVal;
    const numbers = (value) => (value || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const onEdge = (x, y, rect) => {
      const left = Number(rect.getAttribute('x'));
      const top = Number(rect.getAttribute('y'));
      const right = left + Number(rect.getAttribute('width'));
      const bottom = top + Number(rect.getAttribute('height'));
      const onVertical = (Math.abs(x - left) <= 1 || Math.abs(x - right) <= 1) && y >= top - 1 && y <= bottom + 1;
      const onHorizontal = (Math.abs(y - top) <= 1 || Math.abs(y - bottom) <= 1) && x >= left - 1 && x <= right + 1;
      return onVertical || onHorizontal;
    };
    for (const group of svg.querySelectorAll('.map-label, .map-pin-group')) {
      const anchor = group.querySelector('.map-anchor, .map-pin');
      const leader = group.querySelector('.map-line--label, .map-pin__leader');
      const plaque = group.querySelector('.map-plaque, .map-pin__plaque');
      if (!anchor || !leader || !plaque) {
        issues.push(`${group.className.baseVal}: incomplete anchor/leader/plaque`);
        continue;
      }
      const [sx, sy, ex, ey] = numbers(leader.getAttribute('d'));
      const ax = Number(anchor.getAttribute('cx'));
      const ay = Number(anchor.getAttribute('cy'));
      if (sx !== ax || sy !== ay) issues.push(`${group.className.baseVal}: leader does not start at anchor`);
      if (!onEdge(ex, ey, plaque)) issues.push(`${group.className.baseVal}: leader does not stop at plaque edge`);
    }
    for (const route of svg.querySelectorAll('.map-route')) {
      const values = numbers(route.getAttribute('points'));
      for (let index = 0; index < values.length; index += 2) {
        if (values[index] < 0 || values[index] > viewBox.width || values[index + 1] < 0 || values[index + 1] > viewBox.height) issues.push('route leaves visual');
      }
    }
    return issues;
  });
  expect(failures, `${viewport.width}x${viewport.height}, slide ${slideIndex}`).toEqual([]);

  const geometry = await page.locator('.visual-frame').evaluate((frame) => ({
    frame: frame.getBoundingClientRect().toJSON(),
    plaques: Array.from(frame.querySelectorAll('.map-plaque, .map-pin__plaque')).map((node) => node.getBoundingClientRect().toJSON()),
    anchors: Array.from(frame.querySelectorAll('.map-anchor, .map-pin')).map((node) => node.getBoundingClientRect().toJSON())
  }));
  for (const box of [...geometry.plaques, ...geometry.anchors]) {
    expect(box.left, `slide ${slideIndex}: left crop`).toBeGreaterThanOrEqual(geometry.frame.left - 1);
    expect(box.top, `slide ${slideIndex}: top crop`).toBeGreaterThanOrEqual(geometry.frame.top - 1);
    expect(box.right, `slide ${slideIndex}: right crop`).toBeLessThanOrEqual(geometry.frame.right + 1);
    expect(box.bottom, `slide ${slideIndex}: bottom crop`).toBeLessThanOrEqual(geometry.frame.bottom + 1);
  }
  for (let a = 0; a < geometry.plaques.length; a += 1) {
    for (let b = a + 1; b < geometry.plaques.length; b += 1) {
      expect(intersects(geometry.plaques[a], geometry.plaques[b], 1), `slide ${slideIndex}: plaques ${a + 1}/${b + 1}`).toBe(false);
    }
    for (let b = 0; b < geometry.anchors.length; b += 1) {
      expect(intersects(geometry.plaques[a], geometry.anchors[b], 1), `slide ${slideIndex}: plaque ${a + 1}/anchor ${b + 1}`).toBe(false);
    }
  }
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

test('Anubis tactical slides expose a timed YouTube fragment or an explicit exception', async ({ page }) => {
  const expected = {
    6: ['AjvPl3qamwE', 18], 7: ['AjvPl3qamwE', 18], 8: ['AjvPl3qamwE', 223], 9: ['AjvPl3qamwE', 329],
    10: ['AjvPl3qamwE', 309], 11: ['AjvPl3qamwE', 309], 12: ['AjvPl3qamwE', 401],
    13: ['588UtJa98F0', 212], 14: ['588UtJa98F0', 212], 15: ['AjvPl3qamwE', 277],
    16: ['588UtJa98F0', 147], 17: ['588UtJa98F0', 147], 18: ['AjvPl3qamwE', 205],
    19: ['AjvPl3qamwE', 205]
  };

  for (const [index, clip] of Object.entries(expected)) {
    await page.goto(slideUrl(index));
    const strip = page.locator('.slide .video-strip');
    await expect(strip, `slide ${index}`).toHaveCount(1);
    if (!clip) {
      await expect(strip).toHaveAttribute('data-video-kind', 'exception');
      await expect(strip).toContainText('без точного фрагмента');
      await expect(strip.locator('a')).toHaveCount(0);
      continue;
    }
    await expect(strip).toHaveAttribute('data-video-kind', 'clip');
    const href = await strip.locator('a').getAttribute('href');
    expect(new URL(href).hostname).toBe('www.youtube.com');
    expect(new URL(href).searchParams.get('v')).toBe(clip[0]);
    expect(new URL(href).searchParams.get('t')).toBe(`${clip[1]}s`);
    await expect(strip).toContainText(/\d+:\d{2}–\d+:\d{2}/);
  }
});

test('D4ba is the only named captain while the five gameplay duties stay assigned', async ({ page }) => {
  await page.goto(slideUrl(5));
  await expect(page.locator('.slide')).toContainText('D4ba');
  await expect(page.locator('.slide')).toContainText(/D4ba.*капитан/i);

  for (const index of [12, 15]) {
    await page.goto(slideUrl(index));
    const text = await page.locator('.slide').innerText();
    for (const player of ['L!S', 'D4ba', 'd0lfero', 'middle', 'Reconnecting']) expect(text.toLowerCase()).toContain(player.toLowerCase());
    const lisAssignments = await page.getByText(/L!S/i).allTextContents();
    expect(lisAssignments.some((assignment) => /капитан/i.test(assignment))).toBe(false);
  }

  for (const index of [13, 16]) {
    await page.goto(slideUrl(index));
    const labels = await page.locator('.map-pin__label').allTextContents();
    expect(labels).toEqual([
      expect.stringMatching(/^L!S · энтри$/i),
      expect.stringMatching(/^D4ba · капитан \/ размен$/i),
      expect.stringMatching(/^d0lfero · бомба$/i),
      expect.stringMatching(/^Reconnecting · гранаты$/i),
      expect.stringMatching(/^middle · фланг \/ инфо$/i)
    ]);
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
  for (const [id, [x, y]] of Object.entries(calloutAnchors)) {
    const anchor = page.locator(`.map-label[data-point="${id}"] .map-anchor`);
    await expect(anchor, id).toHaveAttribute('cx', String(x));
    await expect(anchor, id).toHaveAttribute('cy', String(y));
  }

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

test('every Anubis diagram keeps labels, named player pins, routes and edge-terminated leaders at all presentation sizes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of presentationViewports) {
    for (const slideIndex of diagramSlides) await expectDiagramGeometry(page, slideIndex, viewport);
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

  for (const viewport of presentationViewports) {
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
