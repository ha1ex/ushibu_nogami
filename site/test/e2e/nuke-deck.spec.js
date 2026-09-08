import { test, expect } from '@playwright/test';

const deckUrl = process.env.NUKE_DECK_URL || '/playbooks/nuke/index.html';

test('Nuke deck exposes 31 slides with keyboard navigation and a working timer', async ({ page }) => {
  await page.goto(deckUrl);

  await expect(page).toHaveTitle(/Nuke|Нюк/i);
  await expect(page.locator('.slide')).toHaveCount(31);
  await expect(page.locator('.slide.is-active')).toHaveCount(1);
  await expect(page.locator('.counter')).toHaveText('1 / 31');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.counter')).toHaveText('2 / 31');
  await expect(page).toHaveURL(/#2$/);

  const timerButton = page.locator('[data-action="timer"]');
  await timerButton.click();
  await expect(timerButton).toHaveText('Пауза');
  await timerButton.click();
  await expect(timerButton).toHaveText('Старт');
});

test('Nuke visual slides load local images with Russian descriptions', async ({ page }) => {
  await page.goto(deckUrl);

  const images = page.locator('.slide img');
  await expect(images).toHaveCount(17);
  await expect.poll(async () => images.evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0))).toBe(true);

  const descriptions = await images.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('alt') || ''));
  expect(descriptions.every((description) => /[А-Яа-яЁё]/.test(description))).toBe(true);
});

test('Nuke role diagram uses the clean radar and precise Russian callouts', async ({ page }) => {
  await page.goto(`${deckUrl}#12`);

  const activeSlide = page.locator('.slide.is-active[data-index="12"]');
  await expect(activeSlide).toHaveCount(1);
  const radar = activeSlide.locator('.visual-frame.radar');
  await expect(radar.locator('img')).toHaveAttribute('src', 'assets/nuke-radar-clean.webp');
  await expect(radar.locator('.radar-callout')).toHaveCount(5);
  await expect(radar.locator('.radar-anchor')).toHaveCount(5);
  await expect(radar.locator('.radar-leader')).toHaveCount(5);

  const labels = await radar.locator('.radar-label').allTextContents();
  expect(labels).toEqual(['1 · A · Будка', '2 · A · Скрип', '3 · Улица', '4 · Рампа', '5 · Девятка']);
  expect(labels.some((label) => /Hut|Squeaky|Outside|Ramp|Heaven|Main|Garage/i.test(label))).toBe(false);

  const invalidAnchors = await radar.locator('.radar-callout').evaluateAll((groups) => groups.filter((group) => {
    const dot = group.querySelector('.radar-anchor');
    const leader = group.querySelector('.radar-leader');
    const x = Number(dot?.getAttribute('cx'));
    const y = Number(dot?.getAttribute('cy'));
    const path = leader?.getAttribute('d') || '';
    return !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1558 || y < 0 || y > 848 || !path.startsWith(`M ${x} ${y} L `);
  }).length);
  expect(invalidAnchors).toBe(0);

  const geometry = await radar.locator('.radar-callout').evaluateAll((groups) => groups.map((group) => {
    const anchor = group.querySelector('.radar-anchor');
    const leader = group.querySelector('.radar-leader');
    const plate = group.querySelector('.radar-plate');
    const path = leader.getAttribute('d').match(/M\s+([\d.]+)\s+([\d.]+)\s+L\s+([\d.]+)\s+([\d.]+)/);
    const x = Number(anchor.getAttribute('cx'));
    const y = Number(anchor.getAttribute('cy'));
    const px = Number(plate.getAttribute('x'));
    const py = Number(plate.getAttribute('y'));
    const pw = Number(plate.getAttribute('width'));
    const ph = Number(plate.getAttribute('height'));
    const endX = Number(path?.[3]);
    const endY = Number(path?.[4]);
    const endpointOnPlate = endX >= px && endX <= px + pw && endY >= py && endY <= py + ph &&
      (endX === px || endX === px + pw || endY === py || endY === py + ph);
    return { x, y, startsAtAnchor: Number(path?.[1]) === x && Number(path?.[2]) === y, endpointOnPlate };
  }));
  expect(geometry).toEqual([
    { x: 808, y: 492, startsAtAnchor: true, endpointOnPlate: true },
    { x: 714, y: 548, startsAtAnchor: true, endpointOnPlate: true },
    { x: 920, y: 690, startsAtAnchor: true, endpointOnPlate: true },
    { x: 855, y: 120, startsAtAnchor: true, endpointOnPlate: true },
    { x: 995, y: 340, startsAtAnchor: true, endpointOnPlate: true }
  ]);
});

test('Nuke names D4ba as the only map leader', async ({ page }) => {
  await page.goto(deckUrl);
  const copy = await page.locator('.slide').allTextContents();
  const leadership = copy.filter((text) => /лидер|капитан/i.test(text));
  expect(leadership.join(' ')).toContain('На тренировке это D4ba');
  expect(leadership.join(' ')).not.toMatch(/На тренировке это L!S|L!S\s*[·—:-].*капитан/i);
});

test('every Nuke tactical block links to a timestamped YouTube fragment', async ({ page }) => {
  await page.goto(deckUrl);
  const tacticalTitles = await page.locator('.slide:has(.video-cue) h2').allTextContents();
  expect(tacticalTitles).toEqual([
    'Дефолт: базовое начало раунда',
    'Стандартная расстановка',
    'Пять зон ответственности',
    'Давление на Рампу',
    'Контакт, задержка и отход',
    'Улица и Секрет',
    'Считаем переход, а не геройствуем',
    'Давление на A',
    'Два входа — две линии',
    'Что делает вся пятёрка',
    'Два игрока всегда держат Лобби',
    'Открываем Рампу',
    'Трое входят одной волной',
    'Открываем A',
    'Два входа в одну секунду',
    'Контроль Улицы одним дымом',
    'Быстрый дым, размен и выбор'
  ]);

  const cues = page.locator('.slide .video-cue');
  await expect(cues).toHaveCount(tacticalTitles.length);
  expect(await cues.evaluateAll((links) => links.every((link) => (
    /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+&t=\d+s$/.test(link.href) &&
    /\d+:\d{2}–\d+:\d{2}/.test(link.textContent || '') &&
    link.target === '_blank' &&
    link.rel === 'noopener noreferrer'
  )))).toBe(true);

  const overviewLinks = page.locator('.slide', { hasText: 'Базовая игра за защиту' }).locator('.source-table a[href*="youtube.com"]');
  await expect(overviewLinks).toHaveCount(4);
  expect(await overviewLinks.evaluateAll((links) => links.every((link) => /[?&]t=\d+s$/.test(link.href)))).toBe(true);
});

test('Nuke utility practice has exactly ten complete CSNADES drills', async ({ page }) => {
  await page.goto(deckUrl);

  const drills = page.locator('[data-nade-drill]');
  await expect(drills).toHaveCount(10);

  const contract = await drills.evaluateAll((rows) => rows.map((row) => ({
    owner: row.getAttribute('data-owner'),
    backup: row.getAttribute('data-backup'),
    method: row.getAttribute('data-method'),
    criterion: row.getAttribute('data-criterion'),
    url: row.querySelector('a.csnades-direct')?.href || '',
    image: row.querySelector('img.csnades-frame')?.getAttribute('src') || '',
    alt: row.querySelector('img.csnades-frame')?.getAttribute('alt') || ''
  })));

  expect(contract.map(({ owner, backup, method, criterion, url, image }) => ({ owner, backup, method, criterion, url, image }))).toEqual([
    { owner: 'd0lfero', backup: 'L!S', method: 'Шагом, прыжок и левая кнопка', criterion: '3/3', url: 'https://csnades.gg/nuke/molotovs/outside-from-outside-ct', image: 'assets/csnades-nuke-outside-molotov.webp' },
    { owner: 'Reconnecting', backup: 'd0lfero', method: 'На бегу, левая кнопка', criterion: '3/3', url: 'https://csnades.gg/nuke/smokes/t-red-from-ct-red', image: 'assets/csnades-nuke-t-red-smoke.webp' },
    { owner: 'L!S', backup: 'middle', method: 'С места, прыжок и левая кнопка', criterion: '5/5', url: 'https://csnades.gg/nuke/smokes/trophy-from-ramp', image: 'assets/csnades-nuke-trophy-smoke.webp' },
    { owner: 'D4ba', backup: 'Reconnecting', method: 'С места, левая кнопка', criterion: '5/5', url: 'https://csnades.gg/nuke/molotovs/hut-from-heaven', image: 'assets/csnades-nuke-hut-molotov.webp' },
    { owner: 'middle', backup: 'D4ba', method: 'С места, левая кнопка', criterion: '5/5', url: 'https://csnades.gg/nuke/molotovs/squeaky-from-heaven', image: 'assets/csnades-nuke-squeaky-molotov.webp' },
    { owner: 'L!S', backup: 'd0lfero', method: 'С места, прыжок и левая кнопка', criterion: '5/5', url: 'https://csnades.gg/nuke/smokes/front-garage-from-t-spawn-b', image: 'assets/csnades-nuke-front-garage-smoke.webp' },
    { owner: 'Reconnecting', backup: 'middle', method: 'На бегу, левая кнопка', criterion: '3/3', url: 'https://csnades.gg/nuke/flashbangs/ramp-from-trophy', image: 'assets/csnades-nuke-ramp-flash.webp' },
    { owner: 'Reconnecting', backup: 'L!S', method: 'С места, прыжок и обе кнопки', criterion: '5/5', url: 'https://csnades.gg/nuke/smokes/a-main-from-t-roof', image: 'assets/csnades-nuke-a-main-smoke.webp' },
    { owner: 'middle', backup: 'D4ba', method: 'На бегу, левая кнопка', criterion: '3/3', url: 'https://csnades.gg/nuke/flashbangs/hut-from-lobby-a', image: 'assets/csnades-nuke-hut-flash.webp' },
    { owner: 'd0lfero', backup: 'L!S', method: 'С места, прыжок и левая кнопка', criterion: '5/5', url: 'https://csnades.gg/nuke/smokes/secret-close-from-t-spawn', image: 'assets/csnades-nuke-secret-smoke.webp' }
  ]);
  expect(contract.every(({ criterion }) => /^(?:5\/5|3\/3)$/.test(criterion || ''))).toBe(true);
  expect(new Set(contract.map(({ url }) => url)).size).toBe(10);
  expect(contract.every(({ image }) => /^assets\/csnades-nuke-[a-z0-9-]+\.webp$/.test(image))).toBe(true);
  expect(contract.every(({ alt }) => /[А-Яа-яЁё]/.test(alt))).toBe(true);

  const frames = drills.locator('img.csnades-frame');
  await expect(frames).toHaveCount(10);
  await expect.poll(async () => frames.evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0))).toBe(true);
});

test('all Nuke slides and controls fit at the three presentation viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const viewport of [{ width: 1600, height: 836 }, { width: 1366, height: 704 }, { width: 1280, height: 656 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (let index = 1; index <= 31; index += 1) {
      await page.goto(`${deckUrl}#${index}`);
      await expect(page.locator('.counter')).toHaveText(`${index} / 31`);
      const fit = await page.locator('.slide.is-active').evaluate((slide) => {
        const controls = document.querySelector('.controls').getBoundingClientRect();
        const body = slide.querySelector('.slide-body');
        const scrollContainers = [...slide.querySelectorAll('.slide-body *')].filter((node) => {
          const style = getComputedStyle(node);
          const visible = node.clientWidth > 0 && node.clientHeight > 0;
          return visible && (style.overflowX !== 'visible' || style.overflowY !== 'visible');
        });
        return {
          slideFits: slide.scrollWidth <= slide.clientWidth + 1 && slide.scrollHeight <= slide.clientHeight + 1,
          bodyFits: body.scrollWidth <= body.clientWidth + 1 && body.scrollHeight <= body.clientHeight + 1,
          contentFits: scrollContainers.every((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1),
          controlsClear: body.getBoundingClientRect().top + body.scrollHeight <= controls.top + 1,
          controlsFit: controls.left >= -1 && controls.right <= innerWidth + 1 && controls.top >= -1 && controls.bottom <= innerHeight + 1,
          pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
          bodyTop: body.getBoundingClientRect().top,
          bodyScrollHeight: body.scrollHeight,
          bodyClientHeight: body.clientHeight,
          controlsTop: controls.top
        };
      });
      expect(fit, `${viewport.width}x${viewport.height}, slide ${index}: ${JSON.stringify(fit)}`).toMatchObject({ slideFits: true, bodyFits: true, contentFits: true, controlsClear: true, controlsFit: true, pageFits: true });
    }
  }
});
