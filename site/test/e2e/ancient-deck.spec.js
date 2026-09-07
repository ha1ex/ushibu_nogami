import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let runtimeErrors;
let ancientServer;
let ancientUrl;
const ancientRoot = path.resolve(import.meta.dirname, '../../playbooks/ancient');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

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
