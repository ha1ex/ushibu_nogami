import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let runtimeErrors;
let ancientServer;
let ancientUrl;
const ancientRoot = path.resolve(import.meta.dirname, '../../playbooks/ancient');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

const expectedDiagramAnchors = [
  [['Мейн A', 10, 39], ['Пончик', 27, 50], ['Мид', 49, 52], ['Верх мида', 49, 41], ['Рампа B', 91, 49], ['Кейв', 71, 42], ['Короткая B', 79, 30], ['Респаун КТ', 52, 10]],
  [['Мейн A', 10, 39], ['Пончик', 27, 50], ['Мид', 49, 52], ['Ягуар', 65, 59], ['Рампа B', 91, 49]],
  [['D4ba · A', 23, 24], ['middle · Пончик', 27, 50], ['d0lfero · Верх мида', 49, 41], ['L!S · Кейв', 71, 42], ['Reconnecting · B', 84, 40]],
  [['T дым / контакт', 49, 49], ['назвал число', 49, 41], ['держит Пончик', 27, 50], ['отход Коннектор', 47, 29]],
  [['A якорь', 23, 24], ['Пончик', 27, 50], ['флешка A', 19, 28], ['Линия КТ', 38, 20]],
  [['B якорь', 84, 40], ['Кейв', 71, 42], ['Рампа волна', 91, 49], ['Короткая безопасность', 79, 30]],
  [['D4ba · первый', 49, 58], ['middle · флешка', 44, 64], ['d0lfero · A удержание', 13, 48], ['L!S · размен', 53, 61], ['Reconnect · B удержание', 86, 61]],
  [['Верх мида дым', 49, 41], ['поп-флешка', 49, 51], ['первый · D4ba', 47, 49], ['размен · L!S', 53, 51]],
  [['Пончик', 27, 50], ['Ягуар → Кейв', 65, 59], ['Сброс', 47, 67]],
  [['D4ba · первый', 21, 28], ['L!S · размен', 17, 32], ['d0lfero · Пончик', 27, 50], ['middle · гранаты', 13, 43], ['бомба · вторая волна', 21, 35]],
  [['Дым Линия КТ', 38, 20], ['Храм дым', 25, 15], ['Короткая A дым', 28, 40], ['A поп-флешка', 20, 27]],
  [['D4ba · Колонна', 81, 40], ['L!S · размен', 84, 44], ['middle · флешка', 83, 38], ['d0lfero · Кейв', 71, 42], ['бомба · волна 2', 88, 52]],
  [['Кейв дым', 71, 42], ['Короткая / Аллея', 79, 30], ['Колонна молотов', 81, 40], ['Плент B флешка', 84, 44]],
  [['D4ba · Ягуар', 65, 59], ['L!S · Кейв размен', 71, 42], ['d0lfero · Рампа первый', 89, 49], ['middle · Рампа флешка', 88, 58], ['бомба · Рампа волна 2', 84, 61]],
  [['Верх мида', 49, 41], ['безопасный сброс', 42, 66], ['Мейн A контакт', 13, 48], ['Рампа B контакт', 86, 61]],
  [['Верх мида', 49, 41], ['Линия КТ', 38, 20], ['Пончик', 27, 50], ['Кейв', 71, 42], ['Короткая / Аллея', 79, 30]]
];

test.beforeAll(async () => {
  ancientServer = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(ancientRoot, relative);
    if (!target.startsWith(ancientRoot + path.sep) && target !== path.join(ancientRoot, 'index.html')) {
      response.writeHead(403); response.end('forbidden'); return;
    }
    try {
      const bytes = await readFile(target);
      response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
      response.end(bytes);
    } catch (_) {
      response.writeHead(404); response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    ancientServer.once('error', reject);
    ancientServer.listen(0, '127.0.0.1', resolve);
  });
  ancientUrl = `http://127.0.0.1:${ancientServer.address().port}/`;
});

test.afterAll(async () => {
  await new Promise((resolve) => ancientServer.close(resolve));
});

test.beforeEach(async ({ page }) => {
  runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.goto(ancientUrl);
});

test.afterEach(async () => {
  expect(runtimeErrors).toEqual([]);
});

test('Ancient deck is a complete 40–60 minute visual practice plan', async ({ page }) => {
  await expect(page).toHaveTitle(/Ancient.*командная тренировка/i);
  await expect(page.getByRole('heading', { level: 1, name: /Ancient/i })).toBeVisible();

  const slides = page.locator('.slide');
  const slideCount = await slides.count();
  expect(slideCount).toBeGreaterThanOrEqual(26);
  expect(slideCount).toBeLessThanOrEqual(34);

  const plannedMinutes = await slides.evaluateAll((nodes) =>
    nodes.reduce((total, node) => total + Number(node.dataset.minutes || 0), 0)
  );
  expect(plannedMinutes).toBeGreaterThanOrEqual(40);
  expect(plannedMinutes).toBeLessThanOrEqual(60);
  expect(Number(await page.locator('.deck').getAttribute('data-practice-minutes'))).toBeLessThanOrEqual(30);

  const visualKinds = await slides.evaluateAll((nodes) => nodes.map((slide) => slide.dataset.kind));
  let textRun = 0;
  for (const kind of visualKinds) {
    textRun = kind === 'text' ? textRun + 1 : 0;
    expect(textRun).toBeLessThanOrEqual(2);
  }
  expect(visualKinds.filter((kind) => kind === 'visual').length).toBeGreaterThanOrEqual(8);
});

test('navigation, timer, progress and answer reveal work without shared site scripts', async ({ page }) => {
  const counter = page.locator('.counter');
  await expect(counter).toHaveText(/^1 \/ \d+$/);

  await page.getByRole('button', { name: 'Следующий слайд' }).click();
  await expect(counter).toHaveText(/^2 \/ \d+$/);
  await expect(page.locator('.slide.is-active')).toHaveAttribute('aria-hidden', 'false');

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText(/^3 \/ \d+$/);
  await expect(page).toHaveURL(/#3$/);
  await expect(page.locator('.progress-fill')).not.toHaveCSS('width', '0px');

  await page.getByRole('button', { name: /Запустить.*таймер/i }).click();
  await page.waitForTimeout(1100);
  await expect(page.locator('.timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Сбросить таймер' }).click();
  await expect(page.locator('.timer')).toHaveText('00:00');

  await page.keyboard.press('End');
  const answers = page.getByRole('button', { name: 'Показать ответы' });
  await answers.click();
  await expect(page.locator('.quiz-answer').first()).toBeVisible();
});

test('map overlays use normalized anchored labels and distinct tactical routes', async ({ page }) => {
  const visuals = page.locator('.map-stage');
  expect(await visuals.count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('img[src^="http"]')).toHaveCount(0);
  await expect(page.locator('.map-stage img').first()).toHaveAttribute('src', 'assets/ancient-radar-clean.webp');
  await expect(page.locator('.map-stage img').first()).toHaveCSS('object-fit', 'contain');

  const diagramLabels = (await page.locator('.map-label').allTextContents())
    .map((label) => label.replace(/D4ba|middle|d0lfero|L!S|Reconnecting|Reconnect/g, ''));
  expect(diagramLabels.some((label) => /A Main|Donut|Top Mid|Mid|B Ramp|Cave|B Short|CT Spawn|anchor|flash|Connector|Lane|wave|first|hold|trade|utility|bomb|smoke|molly|Site|Jaguar|RESET|contact|safety|Pillar|Temple|Short|Alley/i.test(label))).toBe(false);

  const notes = page.locator('.map-note');
  expect(await notes.count()).toBeGreaterThanOrEqual(30);
  for (const note of await notes.all()) {
    const x = Number(await note.getAttribute('data-x'));
    const y = Number(await note.getAttribute('data-y'));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(100);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(100);
    await expect(note.locator('.anchor-dot')).toHaveCount(1);
    await expect(note.locator('.leader')).toHaveCount(1);
  }

  for (const route of ['ct', 't', 'utility', 'retreat', 'danger']) {
    await expect(page.locator(`.route--${route}`).first()).toBeAttached();
  }

  const anchors = await visuals.evaluateAll((nodes) => nodes.map((diagram) => [...diagram.querySelectorAll('.map-note')].map((note) => [
    note.querySelector('.map-label').textContent.replace(/^\s*(?:\d+|[ABR])\s*/, '').trim(),
    Number(note.dataset.x),
    Number(note.dataset.y)
  ])));
  expect(anchors).toEqual(expectedDiagramAnchors);
});

test('Ancient assigns every captain decision to D4ba and keeps L!S on the trade', async ({ page }) => {
  const tacticalCopy = await page.locator('.slide').allTextContents();
  const joined = tacticalCopy.join(' ');
  expect(joined).toContain('D4ba запускает волну');
  expect(joined).toContain('D4ba называет новый сбор');
  expect(joined).toContain('Капитан/первый');
  expect(joined).toContain('L!SРазмен');
  expect(joined).not.toMatch(/Только L!S запускает|Решение называет L!S|L!S зовёт|L!S решает|L!S выбирает|L!S\s*Капитан/i);
});

test('every Ancient tactical block links to a timestamped YouTube fragment', async ({ page }) => {
  const tacticalSlides = page.locator('.slide.ct, .slide.t');
  await expect(tacticalSlides).toHaveCount(16);

  for (let index = 0; index < await tacticalSlides.count(); index += 1) {
    const cue = tacticalSlides.nth(index).locator('.video-cue');
    await expect(cue).toHaveCount(1);
    await expect(cue).toHaveAttribute('href', /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+&t=\d+s$/);
    await expect(cue).toHaveText(/\d+:\d{2}–\d+:\d{2}/);
    await expect(cue).toHaveAttribute('target', '_blank');
    await expect(cue).toHaveAttribute('rel', 'noopener noreferrer');
  }

  const topologyCue = page.locator('.slide', { hasText: 'Пять коридоров — три развилки' }).locator('.video-cue');
  await expect(topologyCue).toHaveCount(1);
  await expect(topologyCue).toHaveAttribute('href', /[?&]t=27s$/);
});

test('every Ancient plaque stays separate and every leader terminates on its plaque', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 1600, height: 836 }, { width: 1366, height: 704 }, { width: 1280, height: 656 }]) {
    await page.setViewportSize(viewport);
    for (const diagram of await page.locator('.map-stage').all()) {
      const slideIndex = await diagram.evaluate((node) => node.closest('.slide').dataset.index);
      await page.goto(`${ancientUrl}#${Number(slideIndex)}`);
      await page.evaluate((target) => window.ancientDeck.showSlide(target - 1, false), Number(slideIndex));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.ancientDeck.layoutActiveDiagram();
      });
      await expect(diagram.locator('.map-note').first()).toHaveAttribute('style', /--leader-end-x/);
      const issues = await diagram.evaluate((frame) => {
        window.ancientDeck.layoutActiveDiagram();
        const bounds = frame.getBoundingClientRect();
        const labels = [...frame.querySelectorAll('.map-label')].map((label) => ({ label, rect: label.getBoundingClientRect() }));
        const failures = [];
        for (const { label, rect } of labels) {
          if (rect.left < bounds.left - 1 || rect.top < bounds.top - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1) failures.push(`${label.textContent}: leaves radar`);
        }
        for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) {
          const a = labels[i].rect; const b = labels[j].rect;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) failures.push(`${labels[i].label.textContent}/${labels[j].label.textContent}: collide`);
        }
        for (const note of frame.querySelectorAll('.map-note')) {
          const label = note.querySelector('.map-label').getBoundingClientRect();
          const dot = note.querySelector('.anchor-dot').getBoundingClientRect();
          const dotCenter = { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 };
          const endpoint = { x: dotCenter.x + Number(note.style.getPropertyValue('--leader-end-x')), y: dotCenter.y + Number(note.style.getPropertyValue('--leader-end-y')) };
          const onEdge = endpoint.x >= label.left - 2 && endpoint.x <= label.right + 2 && endpoint.y >= label.top - 2 && endpoint.y <= label.bottom + 2 &&
            (Math.abs(endpoint.x - label.left) <= 2 || Math.abs(endpoint.x - label.right) <= 2 || Math.abs(endpoint.y - label.top) <= 2 || Math.abs(endpoint.y - label.bottom) <= 2);
          if (!onEdge || dotCenter.x < bounds.left || dotCenter.x > bounds.right || dotCenter.y < bounds.top || dotCenter.y > bounds.bottom) failures.push(`${note.textContent}: bad leader/anchor`);
        }
        return failures;
      });
      expect(issues, `${viewport.width}x${viewport.height}, slide ${slideIndex}`).toEqual([]);
    }
  }
});

test('utility syllabus has ten concrete Ancient lineups with owners and pass criteria', async ({ page }) => {
  const cards = page.locator('.nade-card');
  await expect(cards).toHaveCount(10);
  const sourceLedger = await readFile(path.join(ancientRoot, 'sources.md'), 'utf8');
  for (const card of await cards.all()) {
    await expect(card.locator('.nade-owner')).toContainText(/владелец:/i);
    await expect(card.locator('.nade-backup')).toContainText(/запасной:/i);
    await expect(card.locator('.nade-method')).not.toBeEmpty();
    await expect(card.locator('.nade-pass')).toContainText(/(?:5 из 5|3 из 3)/);
    const href = await card.locator('a').getAttribute('href');
    expect(href).toMatch(/^https:\/\/csnades\.gg\/ancient\/(?:smokes|molotovs|flashbangs|he-grenades)\/[a-z0-9-]+$/);

    const frame = card.locator('img.lineup-frame');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', /^assets\/lineup-[a-z0-9-]+\.webp$/);
    await expect(frame).toHaveAttribute('data-source-page', href);
    expect(await frame.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

    const sourcePath = await frame.getAttribute('src');
    expect(sourceLedger).toContain(sourcePath);
    expect(sourceLedger).toContain(href);
  }
});

test('all visible Ancient tactical copy is Russian', async ({ page }) => {
  const tacticalCopy = await page.locator('.slide').evaluateAll((slides) => slides.flatMap((slide) => {
    const copy = [slide.textContent];
    for (const node of slide.querySelectorAll('[alt], [aria-label]')) {
      if (node.hasAttribute('alt')) copy.push(node.getAttribute('alt'));
      if (node.hasAttribute('aria-label')) copy.push(node.getAttribute('aria-label'));
    }
    return copy;
  }).filter(Boolean).join(' '));

  expect(tacticalCopy).not.toMatch(
    /\b(?:CT|default|split|save|Utility|Entry|Lane|Bomb|connector|late|pair|site|flashes?|jump|left-click|precise|T Spawn|Outside A|Side Room|Bottom Mid|Top|Plat|Main|Donut|READY|CLEAR|CONTACT|SMOKE|SEEN|only|lineups?|Backup|retake|rush|execute|flash clock|B Doors|Ruins Box|Alley)\b/i
  );
});

test('every Ancient slide fits the three presentation viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const viewport of [{ width: 1600, height: 836 }, { width: 1366, height: 704 }, { width: 1280, height: 656 }]) {
    await page.setViewportSize(viewport);
    const slideCount = await page.locator('.slide').count();

    for (let index = 1; index <= slideCount; index += 1) {
      await page.goto(`${ancientUrl}#${index}`);
      const fit = await page.locator('.slide.is-active').evaluate((slide) => {
        const content = slide.querySelector('.slide-body');
        const controls = document.querySelector('.controls').getBoundingClientRect();
        return {
          slideFits: slide.scrollWidth <= slide.clientWidth + 1 && slide.scrollHeight <= slide.clientHeight + 1,
          contentFits: content.scrollWidth <= content.clientWidth + 1 && content.scrollHeight <= content.clientHeight + 1,
          controlsFit: controls.left >= -1 && controls.right <= innerWidth + 1 && controls.top >= -1 && controls.bottom <= innerHeight + 1,
          pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight
        };
      });
      expect(fit, `${viewport.width}x${viewport.height}, slide ${index}`).toEqual({ slideFits: true, contentFits: true, controlsFit: true, pageFits: true });
    }
  }

  const imagesLoaded = await page.locator('img').evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0));
  expect(imagesLoaded).toBe(true);
});
