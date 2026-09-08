import { test, expect } from '@playwright/test';

const deckUrl = '/playbooks/mirage/index.html';
const tacticalVideoSlides = Array.from({ length: 17 }, (_, index) => index + 6);
const verifiedVideoIds = new Set(['UPbXRUtBHts', 'pk-SwuVmzgA', '0qPrIZz5NfE', 'bG16jASa5o4']);

test('every Mirage tactical slide has a verified timestamped video fragment', async ({ page }) => {
  for (const slideIndex of tacticalVideoSlides) {
    await page.goto(`${deckUrl}?slide=${slideIndex}`);
    const refs = page.locator('.slide .video-ref');
    expect(await refs.count(), `slide ${slideIndex}`).toBeGreaterThanOrEqual(1);
    for (const ref of await refs.all()) {
      await expect(ref).toBeVisible();
      const url = new URL(await ref.getAttribute('href'));
      expect(url.hostname).toBe('www.youtube.com');
      expect(url.pathname).toBe('/watch');
      expect(verifiedVideoIds.has(url.searchParams.get('v'))).toBe(true);
      expect(url.searchParams.get('t')).toMatch(/^\d+s$/);
      await expect(ref).toHaveAttribute('target', '_blank');
      await expect(ref).toHaveAttribute('rel', /noopener/);
      await expect(ref.locator('.video-ref__range')).toHaveText(/^\d{1,2}:\d{2}–\d{1,2}:\d{2}$/);
    }
  }
});

function slideUrl(index) {
  return `${deckUrl}?slide=${index}`;
}

const diagramSlides = [3, 6, 7, 10, 15, 18, 19, 20, 21, 22];
const presentationViewports = [
  { width: 1600, height: 836 },
  { width: 1366, height: 704 },
  { width: 1280, height: 656 }
];

function intersects(a, b, inset = 0) {
  return a.left + inset < b.right - inset && a.right - inset > b.left + inset &&
    a.top + inset < b.bottom - inset && a.bottom - inset > b.top + inset;
}

async function expectDiagramGeometry(page, slideIndex, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(slideUrl(slideIndex));
  await expect(page.locator('.visual-frame img')).toHaveAttribute('src', 'assets/mirage-game-radar.webp');

  const failures = await page.locator('.visual-frame').evaluate((frame) => {
    const issues = [];
    const svg = frame.querySelector('svg');
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
      for (const value of numbers(route.getAttribute('points'))) {
        if (value < 0 || value > 1000) issues.push('route leaves radar');
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

test('Mirage deck is a complete Russian practice session with working navigation', async ({ page }) => {
  await page.goto(deckUrl);

  await expect(page).toHaveTitle(/Mirage.*командная тренировка/i);
  await expect(page.locator('#jump-select option')).toHaveCount(26);
  await expect(page.locator('.slide[data-slide-index="1"]')).toHaveCount(1);
  await expect(page.locator('#progress-text')).toHaveText('01 / 26');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide[data-slide-index="2"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\?slide=2$/);
  await page.locator('#jump-select').selectOption('11');
  await expect(page.locator('.slide[data-slide-index="12"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Следующий слайд' }).click();
  await expect(page.locator('.slide[data-slide-index="13"]')).toHaveCount(1);

  const timer = page.locator('#timer-button');
  await timer.click();
  await expect(timer).toHaveText('Пауза');
  await timer.click();
  await expect(timer).toHaveText('Старт');
});

test('Mirage syllabus covers defaults, two executes, reactions, postplants and homework', async ({ page }) => {
  await page.goto(deckUrl);
  const outline = (await page.locator('#jump-select option').allTextContents()).join('\n');
  for (const topic of [
    'Цель', 'Радар / коллы', 'Роли команды', 'Дефолт T', 'Контроль мида',
    'Выход A', 'A постплент', 'Выход B', 'B постплент', 'Дефолт CT',
    'CT реакция A', 'CT реакция B', 'Ретейк A', 'Ретейк B', 'GO / STOP / SUCCESS',
    'Гранаты 1–5', 'Гранаты 6–10', 'Домашняя работа'
  ]) expect(outline, `missing ${topic}`).toContain(topic);

  await page.goto(slideUrl(5));
  const visibleRoles = page.locator('.role-strip article');
  await expect(visibleRoles).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) await expect(visibleRoles.nth(index)).toBeVisible();
  const roleText = await visibleRoles.allTextContents();
  expect(roleText).toEqual([
    expect.stringMatching(/^L!S.*Первый вход/s),
    expect.stringMatching(/^D4ba.*Капитан и размен.*GO, STOP и SUCCESS/s),
    expect.stringMatching(/^d0lfero.*Бомба и опорник B/s),
    expect.stringMatching(/^middle.*AWP \/ мид/s),
    expect.stringMatching(/^Reconnecting.*Гранаты и второй темп/s)
  ]);
  await expect(visibleRoles.first()).not.toContainText(/капитан/i);

  await page.goto(slideUrl(25));
  await expect(page.locator('.slide')).toContainText('GO · D4ba');
  await expect(page.locator('.slide')).toContainText('SUCCESS · D4ba');
});

test('radar labels and role pins have normalized anchors, leaders and Russian captions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(slideUrl(3));

  const expectedCallouts = [
    'Респаун T', 'Респаун CT', 'Яма A', 'Тетрис', 'Ковры A', 'Сайт A', 'Дефолт A',
    'Сити', 'Джангл', 'Коннектор', 'Окно', 'Верх мида', 'Шорт', 'Ковры B', 'Машина',
    'Скамейка', 'Сайт B', 'Кухня'
  ];
  expect(await page.locator('.map-text').allTextContents()).toEqual(expectedCallouts);
  await expect(page.locator('.map-label')).toHaveCount(expectedCallouts.length);

  const invalid = await page.locator('.map-label').evaluateAll((groups) => groups.filter((group) => {
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
    return x < 0 || x > 1000 || y < 0 || y > 1000 || left < 0 || top < 0 ||
      left + width > 1000 || top + height > 1000 ||
      !(line.getAttribute('d') || '').startsWith(`M ${x} ${y} L `) || !label.textContent.trim();
  }).length);
  expect(invalid).toBe(0);

  for (const index of [10, 15, 18]) {
    await page.goto(slideUrl(index));
    await expect(page.locator('.map-pin')).toHaveCount(5);
    await expect(page.locator('.map-pin__leader')).toHaveCount(5);
    const labels = page.locator('.map-pin__label');
    const boxes = await labels.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }));
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const overlaps = boxes[a].left < boxes[b].right && boxes[a].right > boxes[b].left && boxes[a].top < boxes[b].bottom && boxes[a].bottom > boxes[b].top;
        expect(overlaps, `slide ${index}, labels ${a + 1} and ${b + 1} overlap`).toBe(false);
      }
    }
  }
});

test('Mirage diagrams use the clean radar instead of the English callouts image', async ({ page }) => {
  await page.goto(slideUrl(3));
  await expect(page.locator('.visual-frame img')).toHaveAttribute('src', 'assets/mirage-game-radar.webp');
  await expect(page.locator('img[src*="callouts"], img[src*="mirage-radar-csnades.png"]')).toHaveCount(0);
});

test('mid window and kitchen window keep distinct calibrated semantic anchors', async ({ page }) => {
  await page.goto(slideUrl(3));
  const midWindowGroup = page.locator('.map-label[data-point="mid-window"]');
  await expect(midWindowGroup.locator('.map-text')).toHaveText('Окно');
  const midWindow = midWindowGroup.locator('.map-anchor');
  await expect(midWindow).toHaveAttribute('cx', '374');
  await expect(midWindow).toHaveAttribute('cy', '438');
  const midWindowX = await midWindow.getAttribute('cx');

  await page.goto(slideUrl(15));
  const kitchenWindowGroup = page.locator('.map-label[data-point="b-market-window"]');
  await expect(kitchenWindowGroup.locator('.map-text')).toHaveText('Окно кухни · смок');
  const kitchenWindow = kitchenWindowGroup.locator('.map-anchor');
  await expect(kitchenWindow).toHaveAttribute('cx', '190');
  await expect(kitchenWindow).toHaveAttribute('cy', '363');
  expect(await kitchenWindow.getAttribute('cx')).not.toBe(midWindowX);
});

test('A execute keeps middle in connector as the text and team assignment specify', async ({ page }) => {
  await page.goto(slideUrl(10));
  const middleA = page.locator('.map-pin-group[data-player="middle"]');
  await expect(middleA.locator('.map-pin__label')).toHaveText('middle · коннектор');
  await expect(middleA.locator('.map-pin')).toHaveAttribute('cx', '484');
  await expect(middleA.locator('.map-pin')).toHaveAttribute('cy', '559');
  await expect(page.locator('.slide')).toContainText('middle показывает коннектор');
});

test('every Mirage diagram keeps semantic anchors, routes and edge-terminated leaders at all presentation sizes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.goto(slideUrl(6));
  const bApartments = page.locator('.map-label[data-point="t-b"] .map-anchor');
  await expect(bApartments).toHaveAttribute('cx', '273');
  await expect(bApartments).toHaveAttribute('cy', '72');
  const bRoute = (await page.locator('.map-route').nth(2).getAttribute('points')).trim().split(/\s+/).at(-1);
  expect(bRoute).toBe('273,72');

  for (const viewport of presentationViewports) {
    for (const slideIndex of diagramSlides) await expectDiagramGeometry(page, slideIndex, viewport);
  }
});

test('utility library has ten direct CSNADES cards with owners, method, pass gate and local evidence', async ({ page }) => {
  const records = [];
  for (const index of [23, 24]) {
    await page.goto(slideUrl(index));
    const cards = page.locator('.nade-card');
    await expect(cards).toHaveCount(5);
    for (let cardIndex = 0; cardIndex < 5; cardIndex += 1) {
      const card = cards.nth(cardIndex);
      const images = card.locator('.nade-frame img');
      await expect(images).toHaveCount(2);
      await expect.poll(async () => images.evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0))).toBe(true);
      records.push(await card.evaluate((node) => ({
        href: node.querySelector('.nade-link')?.href,
        text: node.textContent || '',
        sources: Array.from(node.querySelectorAll('.nade-frame img')).map((image) => image.getAttribute('src'))
      })));
    }
  }
  expect(records).toHaveLength(10);
  expect(new Set(records.map((record) => record.href)).size).toBe(10);
  for (const record of records) {
    expect(record.href).toMatch(/^https:\/\/csnades\.gg\/mirage\/(smokes|molotovs|flashbangs|he-grenades)\/[a-z0-9-]+$/);
    expect(record.text).toMatch(/Владелец \/ резерв/);
    expect(record.text).toMatch(/(?:5\/5|3\/3) в live-прогоне/);
    expect(record.sources.every((source) => /^assets\/nades\/n\d{2}-(?:lineup|thumbnail)\.webp$/.test(source))).toBe(true);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  for (const index of [23, 24]) {
    await page.goto(slideUrl(index));
    const utilityLayout = await page.locator('.nade-grid').evaluate((grid) => {
      const px = (card, selector) => parseFloat(getComputedStyle(card.querySelector(selector)).fontSize);
      const cards = Array.from(grid.querySelectorAll('.nade-card'));
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
        cards: cards.map((card) => ({
          title: px(card, 'h3'),
          explanation: px(card, '.nade-card__use'),
          sideLabel: px(card, '.side'),
          frameLabel: px(card, 'figcaption'),
          frameLabelVisible: getComputedStyle(card.querySelector('figcaption')).display !== 'none',
          term: px(card, 'dt'),
          value: px(card, 'dd'),
          link: px(card, '.nade-link')
        }))
      };
    });
    expect(utilityLayout.columns, `slide ${index} should keep five utility cards in one row`).toBe(5);
    expect(utilityLayout.cards).toHaveLength(5);
    for (const card of utilityLayout.cards) {
      expect(card.title).toBeGreaterThanOrEqual(16);
      expect(card.explanation).toBeGreaterThanOrEqual(12);
      expect(card.sideLabel).toBeGreaterThanOrEqual(11);
      expect(card.frameLabel).toBeGreaterThanOrEqual(11);
      expect(card.frameLabelVisible).toBe(true);
      expect(card.term).toBeGreaterThanOrEqual(11);
      expect(card.value).toBeGreaterThanOrEqual(12);
      expect(card.link).toBeGreaterThanOrEqual(12);
    }
  }
});

test('all Mirage slides fit the three presentation viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of presentationViewports) {
    await page.setViewportSize(viewport);
    for (let index = 1; index <= 26; index += 1) {
      await page.goto(slideUrl(index));
      const fit = await page.locator('.slide').evaluate((slide) => {
        const header = document.querySelector('.deck-header').getBoundingClientRect();
        const footer = document.querySelector('.deck-footer').getBoundingClientRect();
        return {
          slideFits: slide.scrollWidth <= slide.clientWidth + 1 && slide.scrollHeight <= slide.clientHeight + 1,
          headerFits: header.left >= -1 && header.right <= innerWidth + 1 && header.top >= -1 && header.bottom <= innerHeight + 1,
          footerFits: footer.left >= -1 && footer.right <= innerWidth + 1 && footer.top >= -1 && footer.bottom <= innerHeight + 1,
          pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight
        };
      });
      expect(fit, `${viewport.width}x${viewport.height}, slide ${index}`).toEqual({ slideFits: true, headerFits: true, footerFits: true, pageFits: true });
    }
  }
});
