import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const deckPath = '/playbooks/cache/index.html';
const cacheRoot = path.resolve(import.meta.dirname, '../../playbooks/cache');

test.describe('Cache team training deck', () => {
  test('loads the current Cache briefing as a navigable fullscreen deck', async ({ page, request }) => {
    const response = await request.get(deckPath);
    expect(response.status()).toBe(200);

    await page.goto(deckPath);
    await expect(page).toHaveTitle(/Cache.*командная тренировка/i);
    await expect(page.locator('[data-map-build]')).toContainText('03.08.2026');
    await expect(page.getByText(/Active Duty/i).first()).toBeVisible();

    const slides = page.locator('.slide');
    expect(await slides.count()).toBeGreaterThanOrEqual(22);
    expect(await slides.count()).toBeLessThanOrEqual(30);
    await expect(slides.first()).toHaveClass(/is-active/);
    await expect(page.locator('[data-current]')).toHaveText('01');

    await page.keyboard.press('ArrowRight');
    await expect(slides.nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('[data-current]')).toHaveText('02');
    await page.keyboard.press('Home');
    await expect(slides.first()).toHaveClass(/is-active/);
    await page.getByRole('button', { name: 'Следующий слайд' }).click();
    await page.keyboard.press('ArrowLeft');
    await expect(slides.first()).toHaveClass(/is-active/);
    await page.keyboard.press('End');
    await expect(slides.last()).toHaveClass(/is-active/);

    await expect(page.getByRole('button', { name: /таймер/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /полноэкран/i })).toBeVisible();
    await expect(page.locator('.progress-fill')).toHaveAttribute('style', /width:/);
  });

  test('teaches the requested playbook and exposes ten current lineup drills', async ({ page }) => {
    await page.goto(deckPath);

    for (const topic of [
      'T-дефолт', 'Контроль Мида', 'Мейн A + Скрип', 'Мейн B + Венты',
      'Быстрый B', 'КТ-дефолт', 'GO / STOP', 'Домашка', 'Финальный тест'
    ]) {
      await expect(page.getByText(topic, { exact: false }).first()).toBeAttached();
    }

    for (const callout of [
      'Мейн A', 'Скрип', 'Погрузчик', 'Квад', 'Хайвей', 'Мид', 'Гараж',
      'Буст', 'Белый ящик', 'Венты', 'Мейн B', 'Шашки', 'Хевен', 'Санрум'
    ]) {
      await expect(page.locator(`[data-callout="${callout}"]`).first(), callout).toBeAttached();
    }

    const utilityCards = page.locator('[data-lineup]');
    await expect(utilityCards).toHaveCount(10);
    const sourceLedger = await readFile(path.join(cacheRoot, 'sources.md'), 'utf8');
    for (let index = 0; index < 10; index += 1) {
      const card = utilityCards.nth(index);
      const link = card.locator('a[href^="https://csnades.gg/cache/"]');
      await expect(link).toHaveCount(1);
      await expect(card.locator('[data-owner]')).not.toBeEmpty();
      await expect(card.locator('[data-backup]')).not.toBeEmpty();
      await expect(card.locator('[data-throw]')).not.toBeEmpty();
      await expect(card.locator('[data-pass]')).toContainText(/(?:5\/5|3\/3)/);

      const href = await link.getAttribute('href');
      const frame = card.locator('img.lineup-frame');
      await expect(frame).toHaveCount(1);
      await expect(frame).toHaveAttribute('src', /^assets\/lineup-[a-z0-9-]+\.webp$/);
      await expect(frame).toHaveAttribute('data-source-page', href);
      expect(await frame.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

      const sourcePath = await frame.getAttribute('src');
      expect(sourceLedger).toContain(sourcePath);
      expect(sourceLedger).toContain(href);
    }

    await expect(utilityCards.first().locator('[data-pass]')).toHaveText('3/3');

    await expect(page.locator('[data-quiz-question]')).toHaveCount(8);
  });

  test('uses the agreed Russian callouts and tactical language on diagrams', async ({ page }) => {
    await page.goto(deckPath);

    const mainRadarCallouts = await page
      .locator('[data-tactical-diagram="callouts"] .marker-label')
      .allTextContents();
    expect(mainRadarCallouts.map((label) => label.replace(/^\d+\s*/, '').trim())).toEqual([
      'Мейн A', 'Скрип', 'Погрузчик', 'Квад', 'Хайвей', 'Мид', 'Гараж',
      'Буст', 'Белый ящик', 'Венты', 'Мейн B', 'Шашки', 'Хевен', 'Санрум'
    ]);

    const tacticalCopy = await page
      .locator('.marker-label, .visual-notes, .slide-head, [alt], [aria-label]')
      .evaluateAll((nodes) => nodes.flatMap((node) => {
        const copy = [];
        if (node.matches('.marker-label, .visual-notes, .slide-head')) copy.push(node.textContent);
        if (node.hasAttribute('alt')) copy.push(node.getAttribute('alt'));
        if (node.hasAttribute('aria-label')) copy.push(node.getAttribute('aria-label'));
        return copy;
      }).filter(Boolean).join(' '));
    expect(tacticalCopy).not.toMatch(
      /\b(?:CT|Z|A Main|B Main|Squeaky|Forklift|Quad|Highway|Mid|Garage|Boost|White Box|Vents?|Checkers|Heaven|Sun ?Room|Sandbags?|Headshot|Connector|site|spawn|entry|trade|lurk|IGL|utility|util|backup|bomb|smokes?|flash(?:es)?|moll(?:y|ies)|anchor|flex|pair|contact|fallback|delay|hold|group|safe route|ours|lost|open)\b/i
    );
  });

  test('keeps tactical markers normalized, numbered and connected to labels', async ({ page }) => {
    await page.goto(deckPath);

    const diagrams = page.locator('[data-tactical-diagram]');
    expect(await diagrams.count()).toBeGreaterThanOrEqual(8);
    const markers = page.locator('.map-marker');
    expect(await markers.count()).toBeGreaterThanOrEqual(30);

    for (let index = 0; index < await markers.count(); index += 1) {
      const marker = markers.nth(index);
      const x = Number(await marker.getAttribute('data-x'));
      const y = Number(await marker.getAttribute('data-y'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
      await expect(marker.locator('.anchor-dot')).toHaveCount(1);
      await expect(marker.locator('.leader-line')).toHaveCount(1);
      await expect(marker.locator('.marker-label')).toHaveCount(1);
    }
  });

  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 }
  ]) {
    test(`keeps every tactical plaque separated inside its radar at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(deckPath);
      const diagrams = page.locator('[data-tactical-diagram]');
      const failures = [];

      for (let index = 0; index < await diagrams.count(); index += 1) {
        const diagram = diagrams.nth(index);
        const slideIndex = await diagram.evaluate((node) => Number(node.closest('.slide').dataset.index) - 1);
        await page.evaluate((target) => window.cacheDeck.goTo(target), slideIndex);
        failures.push(...await diagram.evaluate((frame, gap) => {
          const bounds = frame.getBoundingClientRect();
          const slide = frame.closest('.slide').dataset.index;
          const diagramName = frame.dataset.tacticalDiagram;
          const labels = [...frame.querySelectorAll('.marker-label')].map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              name: node.textContent.replace(/^\d+\s*/, '').trim(),
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom
            };
          });
          const issues = [];

          for (const label of labels) {
            if (label.left < bounds.left || label.top < bounds.top || label.right > bounds.right || label.bottom > bounds.bottom) {
              issues.push(`slide ${slide} ${diagramName}: "${label.name}" leaves radar bounds`);
            }
          }

          for (let first = 0; first < labels.length; first += 1) {
            for (let second = first + 1; second < labels.length; second += 1) {
              const a = labels[first];
              const b = labels[second];
              const separated = a.right + gap <= b.left || b.right + gap <= a.left ||
                a.bottom + gap <= b.top || b.bottom + gap <= a.top;
              if (!separated) {
                issues.push(`slide ${slide} ${diagramName}: "${a.name}" collides with "${b.name}"`);
              }
            }
          }

          return issues;
        }, 3));
      }

      expect(failures).toEqual([]);
    });

    test(`has no slide overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(deckPath);
      const total = await page.locator('.slide').count();

      for (let index = 0; index < total; index += 1) {
        await page.evaluate((slideIndex) => window.cacheDeck.goTo(slideIndex), index);
        const active = page.locator('.slide.is-active');
        const overflow = await active.evaluate((node) => ({
          x: node.scrollWidth - node.clientWidth,
          y: node.scrollHeight - node.clientHeight
        }));
        expect(overflow.x, `slide ${index + 1} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(overflow.y, `slide ${index + 1} vertical overflow`).toBeLessThanOrEqual(1);
      }
    });
  }
});
