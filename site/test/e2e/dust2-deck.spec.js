import { test, expect } from '@playwright/test';

const deckUrl = '/playbooks/dust2/index.html';

const tacticalVideoSlides = Array.from({ length: 13 }, (_, index) => index + 6);
const verifiedVideoIds = new Set(['Bn5RPHcIelw', '-uBIs8dVOZE', 'l44J_OUEjtc']);

test('every Dust 2 tactical slide has a verified timestamped video fragment', async ({ page }) => {
  for (const slideIndex of tacticalVideoSlides) {
    await page.goto(`${deckUrl}?slide=${slideIndex}`);
    const refs = page.locator('.slide .video-ref');
    expect(await refs.count(), `slide ${slideIndex}`).toBeGreaterThanOrEqual(1);
    for (const ref of await refs.all()) {
      await expect(ref).toBeVisible();
      const href = await ref.getAttribute('href');
      const url = new URL(href);
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
const slideUrl = (index) => `${deckUrl}?slide=${index}`;
const viewports = [
  { width: 1600, height: 836 },
  { width: 1366, height: 704 },
  { width: 1280, height: 656 }
];

async function expectAnchorsOnRadar(groups, dotSelector, context) {
  const failures = await groups.evaluateAll((nodes, selector) => nodes.flatMap((node, index) => {
    const frame = node.closest('.radar-shell');
    const image = frame?.querySelector('img');
    const dot = node.querySelector(selector);
    const svg = node.ownerSVGElement;
    if (!frame || !image || !dot || !svg || !image.complete || !image.naturalWidth) return [`${index + 1}: radar unavailable`];
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const frameBox = frame.getBoundingClientRect();
    const scale = Math.min(frameBox.width / image.naturalWidth, frameBox.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const offsetX = (frameBox.width - renderedWidth) / 2;
    const offsetY = (frameBox.height - renderedHeight) / 2;
    const viewBox = svg.viewBox.baseVal;
    const x = Number(dot.getAttribute('cx'));
    const y = Number(dot.getAttribute('cy'));
    const sourceX = ((x - viewBox.x) / viewBox.width * frameBox.width - offsetX) / scale;
    const sourceY = ((y - viewBox.y) / viewBox.height * frameBox.height - offsetY) / scale;
    if (sourceX < 0 || sourceX >= image.naturalWidth || sourceY < 0 || sourceY >= image.naturalHeight) return [`${index + 1}: outside radar image`];
    const alpha = ctx.getImageData(Math.floor(sourceX), Math.floor(sourceY), 1, 1).data[3];
    return alpha >= 160 ? [] : [`${index + 1}: transparent radar pixel (${alpha})`];
  }), dotSelector);
  expect(failures, context).toEqual([]);
}

async function expectLeadersMeetNearestPlaqueEdge(groups, { dot, line, plaque, context }) {
  const failures = await groups.evaluateAll((nodes, selectors) => nodes.flatMap((node, index) => {
    const anchor = node.querySelector(selectors.dot);
    const connector = node.querySelector(selectors.line);
    const label = node.querySelector(selectors.plaque);
    if (!anchor || !connector || !label) return [`${index + 1}: incomplete callout`];
    const ax = Number(anchor.getAttribute('cx'));
    const ay = Number(anchor.getAttribute('cy'));
    const left = Number(label.getAttribute('x'));
    const top = Number(label.getAttribute('y'));
    const right = left + Number(label.getAttribute('width'));
    const bottom = top + Number(label.getAttribute('height'));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    if (ax >= left && ax <= right && ay >= top && ay <= bottom) return [`${index + 1}: anchor under own plaque`];
    const dx = cx - ax;
    const dy = cy - ay;
    const tx = dx === 0 ? -Infinity : Math.min((left - ax) / dx, (right - ax) / dx);
    const ty = dy === 0 ? -Infinity : Math.min((top - ay) / dy, (bottom - ay) / dy);
    const entry = Math.max(tx, ty);
    const expected = { x: ax + dx * entry, y: ay + dy * entry };
    const actual = connector.tagName.toLowerCase() === 'path'
      ? connector.getPointAtLength(connector.getTotalLength())
      : { x: Number(connector.getAttribute('x2')), y: Number(connector.getAttribute('y2')) };
    return Math.hypot(actual.x - expected.x, actual.y - expected.y) <= .75
      ? []
      : [`${index + 1}: leader misses nearest plaque edge`];
  }), { dot, line, plaque });
  expect(failures, context).toEqual([]);
}

test('Dust 2 deck exposes a complete Russian training lesson and navigates by URL', async ({ page }) => {
  const response = await page.goto(deckUrl);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Dust 2.*командная тренировка/i);
  await expect(page.locator('#jump-select option')).toHaveCount(24);
  await expect(page.locator('#progress-text')).toHaveText('01 / 24');

  const outline = (await page.locator('#jump-select option').allTextContents()).join('\n');
  for (const topic of [
    'Цель тренировки', 'Радар / коллы', 'Роли команды', 'Дефолт T', 'Дефолт CT',
    'Выход A', 'Выход B', 'Ротации CT', 'Ретейк', 'Постплент', 'GO / STOP / SUCCESS',
    'Гранаты 1–5', 'Гранаты 6–10', 'Домашняя работа'
  ]) expect(outline, `missing ${topic}`).toContain(topic);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide[data-slide-index="2"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\?slide=2$/);
  await page.locator('#jump-select').selectOption('11');
  await expect(page.locator('.slide[data-slide-index="12"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Предыдущий слайд' }).click();
  await expect(page.locator('.slide[data-slide-index="11"]')).toHaveCount(1);
  await page.getByRole('button', { name: /Запустить таймер/i }).click();
  await expect(page.locator('#timer-button')).toHaveText('Пауза');
});

test('briefing and server practice durations are explicit and internally consistent', async ({ page }) => {
  await page.goto(deckUrl);
  const timing = await page.evaluate(() => ({
    briefingClaim: Number(document.querySelector('.deck').dataset.briefingMinutes),
    practiceClaim: Number(document.querySelector('.deck').dataset.practiceMinutes),
    briefingSum: window.dust2Deck.slides
      .filter((slide) => slide.phase !== 'server-practice')
      .reduce((sum, slide) => sum + slide.minutes, 0),
    practiceSum: window.dust2Deck.slides
      .filter((slide) => slide.phase === 'server-practice')
      .reduce((sum, slide) => sum + slide.minutes, 0)
  }));
  expect(timing).toEqual({ briefingClaim: 55, practiceClaim: 55, briefingSum: 55, practiceSum: 55 });
  await page.goto(slideUrl(22));
  await expect(page.locator('.timing')).toContainText('55 мин');
  await expect(page.locator('.slide')).toContainText(/После презентации/i);
  await expect(page.locator('.timing')).toContainText('практика');
});

test('Russian radar labels use normalized anchors, leader lines and collision-free plaques', async ({ page }) => {
  await page.goto(slideUrl(3));
  const expectedCallouts = [
    'Респаун T', 'Респаун CT', 'Лонг', 'Двери лонга', 'Яма', 'КТ', 'Зигзаг',
    'Шорт', 'Мид', 'Иксбокс', 'Нижняя тёмка', 'Верхняя тёмка', 'Двери B', 'Окно B', 'Плент A', 'Плент B'
  ];
  expect(await page.locator('.map-text').allTextContents()).toEqual(expectedCallouts);

  const labels = page.locator('.map-label');
  await expect(labels).toHaveCount(expectedCallouts.length);
  await expectAnchorsOnRadar(labels, '.map-anchor', 'Dust 2 callout anchors');
  await expectLeadersMeetNearestPlaqueEdge(labels, {
    dot: '.map-anchor', line: '.map-line--label', plaque: '.map-plaque', context: 'Dust 2 callout leaders'
  });
  const invalid = await labels.evaluateAll((nodes) => nodes.filter((node) => {
    const dot = node.querySelector('.map-anchor');
    const line = node.querySelector('.map-line--label');
    const plaque = node.querySelector('.map-plaque');
    if (!dot || !line || !plaque) return true;
    const x = Number(dot.getAttribute('cx'));
    const y = Number(dot.getAttribute('cy'));
    const px = Number(plaque.getAttribute('x'));
    const py = Number(plaque.getAttribute('y'));
    const width = Number(plaque.getAttribute('width'));
    const height = Number(plaque.getAttribute('height'));
    return x < 0 || x > 1000 || y < 0 || y > 1000 || px < 0 || py < 0 ||
      px + width > 1000 || py + height > 1000 ||
      !(line.getAttribute('d') || '').startsWith(`M ${x} ${y} L `);
  }).length);
  expect(invalid).toBe(0);

  const geometry = await labels.evaluateAll((nodes) => nodes.map((node) => {
    const plaque = node.querySelector('.map-plaque').getBoundingClientRect();
    const anchor = node.querySelector('.map-anchor').getBoundingClientRect();
    return {
      plaque: { left: plaque.left, top: plaque.top, right: plaque.right, bottom: plaque.bottom },
      anchor: { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom }
    };
  }));
  const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
  for (let a = 0; a < geometry.length; a += 1) for (let b = a + 1; b < geometry.length; b += 1) {
    expect(intersects(geometry[a].plaque, geometry[b].plaque, 1), `callout plaques ${a + 1}/${b + 1}`).toBe(false);
    expect(intersects(geometry[a].plaque, geometry[b].anchor, 1), `plaque ${a + 1}/anchor ${b + 1}`).toBe(false);
    expect(intersects(geometry[b].plaque, geometry[a].anchor, 1), `plaque ${b + 1}/anchor ${a + 1}`).toBe(false);
  }
});

test('defaults show five players with exact groups and collision-free Russian role labels', async ({ page }) => {
  for (const index of [6, 14]) {
    await page.goto(slideUrl(index));
    await expect(page.locator('.map-pin')).toHaveCount(5);
    await expect(page.locator('.map-pin__leader')).toHaveCount(5);
    const labels = page.locator('.map-pin__label');
    await expect(labels).toHaveCount(5);
    expect((await labels.allTextContents()).join(' ')).toMatch(/L!S.*D4ba.*d0lfero.*middle.*Reconnecting/s);
    await expectAnchorsOnRadar(page.locator('.role-pin'), '.map-pin', `slide ${index} role anchors`);
    await expectLeadersMeetNearestPlaqueEdge(page.locator('.role-pin'), {
      dot: '.map-pin', line: '.map-pin__leader', plaque: '.map-pin__plaque', context: `slide ${index} role leaders`
    });
    const groups = await page.locator('.role-pin').evaluateAll((nodes) => nodes.map((node) => ({
      player: node.dataset.player,
      group: node.dataset.group,
      label: node.querySelector('.map-pin__label')?.textContent
    })));
    if (index === 6) expect(groups).toEqual([
      { player: 'L!S', group: 'лонг', label: 'L!S · первый лонга' },
      { player: 'D4ba', group: 'лонг', label: 'D4ba · размен лонга' },
      { player: 'd0lfero', group: 'мид', label: 'd0lfero · контроль мида' },
      { player: 'middle', group: 'тёмка', label: 'middle · верхняя тёмка' },
      { player: 'Reconnecting', group: 'тёмка', label: 'Reconnecting · бомба / связь' }
    ]);
    const geometry = await page.locator('.role-pin').evaluateAll((nodes) => nodes.map((node) => {
      const plaque = node.querySelector('.map-pin__plaque').getBoundingClientRect();
      const pin = node.querySelector('.map-pin').getBoundingClientRect();
      return {
        plaque: { left: plaque.left, top: plaque.top, right: plaque.right, bottom: plaque.bottom },
        pin: { left: pin.left, top: pin.top, right: pin.right, bottom: pin.bottom }
      };
    }));
    const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
    for (let a = 0; a < geometry.length; a += 1) for (let b = a + 1; b < geometry.length; b += 1) {
      expect(intersects(geometry[a].plaque, geometry[b].plaque, 1), `slide ${index}, role plaques ${a + 1}/${b + 1}`).toBe(false);
      expect(intersects(geometry[a].plaque, geometry[b].pin, 1), `slide ${index}, plaque ${a + 1}/pin ${b + 1}`).toBe(false);
      expect(intersects(geometry[b].plaque, geometry[a].pin, 1), `slide ${index}, plaque ${b + 1}/pin ${a + 1}`).toBe(false);
    }
  }
});

test('D4ba is the captain while L!S keeps the first-contact duty', async ({ page }) => {
  await page.goto(slideUrl(5));
  const d4ba = page.locator('.card').filter({ has: page.locator('h3', { hasText: /^D4ba$/ }) });
  const lis = page.locator('.card').filter({ has: page.locator('h3', { hasText: /^L!S$/ }) });
  await expect(d4ba).toContainText(/капитан/i);
  await expect(d4ba).toContainText(/размен/i);
  await expect(lis).toContainText(/первый контакт/i);
  await expect(lis).not.toContainText(/капитан/i);
});

test('utility syllabus has ten sourced drills with ownership, method and local evidence', async ({ page }) => {
  const records = [];
  for (const index of [20, 21]) {
    await page.goto(slideUrl(index));
    for (const card of await page.locator('.nade-card').all()) {
      records.push(await card.evaluate((node) => ({
        href: node.querySelector('.nade-link')?.href,
        text: node.textContent || '',
        captions: Array.from(node.querySelectorAll('.nade-frame figcaption')).map((caption) => caption.textContent.trim()),
        sources: Array.from(node.querySelectorAll('.nade-frame img')).map((image) => image.getAttribute('src')),
        loaded: Array.from(node.querySelectorAll('.nade-frame img')).every((image) => image.complete && image.naturalWidth > 0)
      })));
    }
  }
  expect(records).toHaveLength(10);
  expect(new Set(records.map((record) => record.href)).size).toBe(10);
  const movingCross = records.find((record) => record.href.endsWith('/a-cross-from-long-doors-b'));
  expect(movingCross?.text).toMatch(/3\/3 в live-прогоне/);
  for (const record of records) {
    expect(record.href).toMatch(/^https:\/\/csnades\.gg\/dust2\/(smokes|molotovs|flashbangs|he-grenades)\/[a-z0-9-]+$/);
    expect(record.text).toMatch(/Владелец \/ резерв/);
    expect(record.text).toMatch(/Бросок/);
    expect(record.text).toMatch(/(?:5\/5|3\/3) в live-прогоне/);
    expect(record.captions).toEqual(['Кадр видео', 'Точка прицела']);
    expect(record.sources).toHaveLength(2);
    expect(record.sources.every((source) => /^assets\/nades\/n\d{2}-(?:position|aim)\.webp$/.test(source))).toBe(true);
    expect(record.loaded).toBe(true);
  }
  await page.goto(slideUrl(3));
  await expect.poll(() => page.locator('.radar-shell img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.goto(slideUrl(1));
  await expect(page.locator('.radar-shell img')).toHaveCount(1);
});

test('slides, controls and images fit all presentation viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (let index = 1; index <= 24; index += 1) {
      await page.goto(slideUrl(index));
      const fit = await page.locator('.slide').evaluate((slide) => {
        const header = document.querySelector('.deck-header').getBoundingClientRect();
        const footer = document.querySelector('.deck-footer').getBoundingClientRect();
        const contentNodes = [slide.querySelector('.body'), ...slide.querySelectorAll('.body > *')].filter(Boolean);
        const contentFits = contentNodes.every((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1);
        return {
          slideX: slide.scrollWidth <= slide.clientWidth + 1,
          slideY: slide.scrollHeight <= slide.clientHeight + 1,
          contentFits,
          header: header.left >= -1 && header.right <= innerWidth + 1,
          footer: footer.left >= -1 && footer.right <= innerWidth + 1,
          page: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight
        };
      });
      expect(fit, `${viewport.width}x${viewport.height}, slide ${index}`).toEqual({ slideX: true, slideY: true, contentFits: true, header: true, footer: true, page: true });
    }
  }
});
