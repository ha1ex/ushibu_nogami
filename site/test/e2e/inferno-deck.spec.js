import { test, expect } from '@playwright/test';

const deckPath = '/playbooks/inferno/index.html';
const viewports = [
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 }
];

async function expectNoOverlaps(locator, context) {
  const boxes = await locator.evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }));
  for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
    const overlap = boxes[a].left < boxes[b].right && boxes[a].right > boxes[b].left && boxes[a].top < boxes[b].bottom && boxes[a].bottom > boxes[b].top;
    expect(overlap, `${context}, labels ${a + 1}/${b + 1}`).toBe(false);
  }
}

async function expectNoForeignLabelIntrusions(groups, { dot, line, label, context }) {
  const intrusions = await groups.evaluateAll((nodes, selectors) => {
    const toClientPoint = (element, point) => {
      const matrix = element.getScreenCTM();
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    };
    const connectorPoints = (connector) => {
      if (connector.tagName.toLowerCase() === 'path') {
        const length = connector.getTotalLength();
        return [
          toClientPoint(connector, connector.getPointAtLength(0)),
          toClientPoint(connector, connector.getPointAtLength(length))
        ];
      }
      return [
        toClientPoint(connector, { x: connector.x1.baseVal.value, y: connector.y1.baseVal.value }),
        toClientPoint(connector, { x: connector.x2.baseVal.value, y: connector.y2.baseVal.value })
      ];
    };
    const inside = (point, box) => point.x > box.left + .25 && point.x < box.right - .25 && point.y > box.top + .25 && point.y < box.bottom - .25;
    const labels = nodes.map((node) => node.querySelector(selectors.label).getBoundingClientRect());
    const failures = [];
    nodes.forEach((node, index) => {
      const anchorBox = node.querySelector(selectors.dot).getBoundingClientRect();
      const anchor = { x: anchorBox.left + anchorBox.width / 2, y: anchorBox.top + anchorBox.height / 2 };
      const [start, end] = connectorPoints(node.querySelector(selectors.line));
      labels.forEach((box, labelIndex) => {
        if (labelIndex === index) return;
        if (inside(anchor, box)) failures.push(`anchor ${index + 1} inside label ${labelIndex + 1}`);
        for (let step = 0; step <= 200; step += 1) {
          const ratio = step / 200;
          const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
          if (inside(point, box)) {
            failures.push(`leader ${index + 1} crosses label ${labelIndex + 1}`);
            break;
          }
        }
      });
    });
    return failures;
  }, { dot, line, label });
  expect.soft(intrusions, context).toEqual([]);
}

async function expectNormalizedPins(pins, { dot, line, label, context }) {
  expect(await pins.count(), context).toBeGreaterThan(0);
  for (const pin of await pins.all()) {
    await expect(pin).toHaveAttribute('data-x', /^\d+(?:\.\d+)?$/);
    await expect(pin).toHaveAttribute('data-y', /^\d+(?:\.\d+)?$/);
    const x = Number(await pin.getAttribute('data-x'));
    const y = Number(await pin.getAttribute('data-y'));
    expect(x, context).toBeGreaterThanOrEqual(0);
    expect(x, context).toBeLessThanOrEqual(100);
    expect(y, context).toBeGreaterThanOrEqual(0);
    expect(y, context).toBeLessThanOrEqual(100);
    const anchor = pin.locator(dot);
    await expect(anchor).toHaveCount(1);
    expect(Number(await anchor.getAttribute('cx')), context).toBe(x * 10);
    expect(Number(await anchor.getAttribute('cy')), context).toBe(y * 10);
    const connector = pin.locator(line);
    await expect(connector).toHaveCount(1);
    const connectorGeometry = await connector.evaluate((node) => node.tagName.toLowerCase() === 'path'
      ? { kind: 'path', value: node.getAttribute('d') || '' }
      : {
          kind: 'line',
          x1: Number(node.getAttribute('x1')), y1: Number(node.getAttribute('y1')),
          x2: Number(node.getAttribute('x2')), y2: Number(node.getAttribute('y2'))
        });
    if (connectorGeometry.kind === 'path') {
      expect(connectorGeometry.value, context).toMatch(new RegExp(`^M ${x * 10} ${y * 10} L `));
    } else {
      expect(connectorGeometry.x1, context).toBe(x * 10);
      expect(connectorGeometry.y1, context).toBe(y * 10);
      expect([connectorGeometry.x2, connectorGeometry.y2], context).not.toEqual([x * 10, y * 10]);
    }
    await expect(pin.locator(label)).not.toBeEmpty();
  }
}

test.describe('Inferno team training deck', () => {
  test('is a complete Russian practice deck with working navigation and timer', async ({ page, request }) => {
    expect((await request.get(deckPath)).status()).toBe(200);
    await page.goto(`${deckPath}?slide=1`);

    await expect(page).toHaveTitle(/Inferno.*командная тренировка/i);
    const slides = page.locator('.slide');
    const total = await slides.count();
    expect(total).toBeGreaterThanOrEqual(20);
    expect(total).toBeLessThanOrEqual(30);
    await expect(page.locator('#slide-picker option')).toHaveCount(total);
    await expect(page.locator('[data-current]')).toHaveText('01');

    await page.getByRole('button', { name: 'Следующий слайд' }).click();
    await expect(page).toHaveURL(/\?slide=2$/);
    await expect(slides.nth(1)).toHaveClass(/is-active/);
    await page.keyboard.press('End');
    await expect(page).toHaveURL(new RegExp(`\\?slide=${total}$`));
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/\?slide=1$/);

    await page.locator('#slide-picker').selectOption('9');
    await expect(page).toHaveURL(/\?slide=10$/);
    const progress = Number(await page.locator('.progress-fill').getAttribute('data-progress'));
    expect(progress).toBeGreaterThan(0);

    const timer = page.getByRole('button', { name: /таймер/i });
    await timer.click();
    await page.waitForTimeout(1100);
    await expect(page.locator('[data-timer]')).not.toHaveText('00:00');
    await timer.click();

    await page.goto(`${deckPath}?slide=1.5`);
    await expect(page.locator('.slide.is-active')).toHaveCount(1);
    await expect(page.locator('.slide').first()).toHaveClass(/is-active/);
    await expect(page.locator('[data-current]')).toHaveText('01');
    await expect(page).toHaveURL(/\?slide=1$/);
  });

  test('covers the full Inferno practice syllabus and real L!S roles', async ({ page }) => {
    await page.goto(deckPath);
    const text = await page.locator('body').innerText();
    for (const topic of [
      'Цель тренировки', 'Радар / коллы', 'T-дефолт', 'CT-дефолт',
      'Выход A', 'Выход B', 'Ротации', 'Ретейк A', 'Ретейк B',
      'Постплент A', 'Постплент B', 'GO / STOP / SUCCESS', 'Домашняя работа'
    ]) expect(text, `missing ${topic}`).toContain(topic);
    for (const player of ['L!S', 'D4ba', 'd0lfero', 'middle', 'Reconnecting']) {
      expect(text, `missing ${player}`).toContain(player);
    }
    await expect(page.locator('[data-quiz-question]')).toHaveCount(8);
  });

  test('keeps every callout, role and retake pin anchored and non-overlapping at all presentation sizes', async ({ page }) => {
    test.setTimeout(60_000);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${deckPath}?slide=4`);

      const callouts = page.locator('.slide.is-active .map-label');
      await expect(callouts).toHaveCount(20);
      await expectNormalizedPins(callouts, {
        dot: '.anchor-dot', line: '.leader-line', label: '.label-text',
        context: `${viewport.width}x${viewport.height} callouts`
      });
      await expectNoOverlaps(callouts.locator('.label-bg'), `${viewport.width}x${viewport.height} callouts`);
      await expectNoForeignLabelIntrusions(callouts, {
        dot: '.anchor-dot', line: '.leader-line', label: '.label-bg',
        context: `${viewport.width}x${viewport.height} callout anchor/leader intrusions`
      });

      const roleSlideIndexes = await page.locator('.slide').evaluateAll((nodes) => nodes
        .map((node, index) => node.querySelector('.role-pin') ? index + 1 : null)
        .filter(Boolean));
      for (const index of roleSlideIndexes) {
        await page.goto(`${deckPath}?slide=${index}`);
        const pins = page.locator('.slide.is-active .role-pin');
        await expect(pins).toHaveCount(5);
        await expectNormalizedPins(pins, {
          dot: '.pin-dot', line: '.pin-line', label: '.pin-label',
          context: `${viewport.width}x${viewport.height} slide ${index} roles`
        });
        expect(await pins.locator('.pin-label').allTextContents()).not.toContainEqual(expect.stringMatching(/Entry|Trader|Utility|Lurk|AWP/i));
        await expectNoOverlaps(pins.locator('.pin-bg'), `${viewport.width}x${viewport.height} slide ${index} roles`);
        await expectNoForeignLabelIntrusions(pins, {
          dot: '.pin-dot', line: '.pin-line', label: '.pin-bg',
          context: `${viewport.width}x${viewport.height} slide ${index} role anchor/leader intrusions`
        });
      }

      const retakeSlideIndexes = await page.locator('.slide').evaluateAll((nodes) => nodes
        .map((node, index) => node.querySelector('[data-map^="retake-"]') ? index + 1 : null)
        .filter(Boolean));
      expect(retakeSlideIndexes).toHaveLength(3);
      for (const index of retakeSlideIndexes) {
        await page.goto(`${deckPath}?slide=${index}`);
        const pins = page.locator('.slide.is-active .retake-pin');
        await expect(pins).toHaveCount(5);
        await expectNormalizedPins(pins, {
          dot: '.pin-dot', line: '.pin-line', label: '.pin-label',
          context: `${viewport.width}x${viewport.height} slide ${index} retake`
        });
        await expectNoOverlaps(pins.locator('.pin-bg'), `${viewport.width}x${viewport.height} slide ${index} retake`);
        await expectNoForeignLabelIntrusions(pins, {
          dot: '.pin-dot', line: '.pin-line', label: '.pin-bg',
          context: `${viewport.width}x${viewport.height} slide ${index} retake anchor/leader intrusions`
        });
      }
    }
  });

  test('ships ten specific CSNADES drills with ownership, methods, pass criteria and local frames', async ({ page }) => {
    await page.goto(deckPath);
    const utilitySlideIndexes = await page.locator('.slide').evaluateAll((nodes) => nodes
      .map((node, index) => node.querySelector('[data-lineup]') ? index + 1 : null)
      .filter(Boolean));
    expect(utilitySlideIndexes).toHaveLength(2);
    const urls = [];
    for (const slideIndex of utilitySlideIndexes) {
      await page.goto(`${deckPath}?slide=${slideIndex}`);
      const cards = page.locator('.slide.is-active [data-lineup]');
      await expect(cards).toHaveCount(5);
      for (const card of await cards.all()) {
        await expect(card.locator('[data-owner]')).not.toBeEmpty();
        await expect(card.locator('[data-backup]')).not.toBeEmpty();
        await expect(card.locator('[data-throw]')).not.toBeEmpty();
        await expect(card.locator('[data-pass]')).toContainText(/(?:5\/5|3\/3)/);
        const link = card.locator('a[href^="https://csnades.gg/inferno/"]');
        await expect(link).toHaveCount(1);
        urls.push(await link.getAttribute('href'));
        const frames = card.locator('.nade-frame img');
        await expect(frames).toHaveCount(2);
        expect(await frames.evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0))).toBe(true);
        expect(await frames.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')))).toEqual([
          expect.stringMatching(/^assets\/nades\/n\d{2}-overview\.webp$/),
          expect.stringMatching(/^assets\/nades\/n\d{2}-lineup\.webp$/)
        ]);
        await expect(card.locator('.nade-frame span')).toHaveText(['Обзор броска', 'Ориентир']);
      }
    }
    expect(new Set(urls).size).toBe(10);
  });

  test('keeps both utility image pairs visible, uncropped and separate at every presentation size', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(deckPath);
      const utilitySlideIndexes = await page.locator('.slide').evaluateAll((nodes) => nodes
        .map((node, index) => node.querySelector('[data-lineup]') ? index + 1 : null)
        .filter(Boolean));
      for (const slideIndex of utilitySlideIndexes) {
        await page.goto(`${deckPath}?slide=${slideIndex}`);
        const images = page.locator('.slide.is-active .nade-frame img');
        await expect(images).toHaveCount(10);
        const metrics = await images.evaluateAll((nodes) => nodes.map((node) => {
          const box = node.getBoundingClientRect();
          const frame = node.closest('.nade-frame').getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            loaded: node.complete && node.naturalWidth > 0 && node.naturalHeight > 0,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
            width: box.width,
            height: box.height,
            contained: box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1,
            objectFit: style.objectFit,
            box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
          };
        }));
        for (const [imageIndex, metric] of metrics.entries()) {
          expect(metric.loaded, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} loaded`).toBe(true);
          expect(metric.visible, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} visible`).toBe(true);
          expect(metric.width, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} width`).toBeGreaterThan(0);
          expect(metric.height, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} height`).toBeGreaterThan(0);
          expect(metric.contained, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} contained`).toBe(true);
          expect(metric.objectFit, `${viewport.width}x${viewport.height} slide ${slideIndex} image ${imageIndex + 1} uncropped`).toBe('contain');
        }
        for (let a = 0; a < metrics.length; a += 1) for (let b = a + 1; b < metrics.length; b += 1) {
          const first = metrics[a].box;
          const second = metrics[b].box;
          const overlap = first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
          expect(overlap, `${viewport.width}x${viewport.height} slide ${slideIndex} images ${a + 1}/${b + 1}`).toBe(false);
        }
      }
    }
  });

  for (const viewport of viewports) {
    test(`has no slide overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(deckPath);
      const total = await page.locator('.slide').count();
      for (let slide = 1; slide <= total; slide += 1) {
        await page.evaluate((index) => window.infernoDeck.goTo(index - 1), slide);
        const fit = await page.locator('.slide.is-active').evaluate((node) => ({
          x: node.scrollWidth - node.clientWidth,
          y: node.scrollHeight - node.clientHeight,
          pageX: document.documentElement.scrollWidth - innerWidth,
          pageY: document.documentElement.scrollHeight - innerHeight
        }));
        expect(fit.x, `slide ${slide} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(fit.y, `slide ${slide} vertical overflow`).toBeLessThanOrEqual(1);
        expect(fit.pageX, `page horizontal overflow on slide ${slide}`).toBeLessThanOrEqual(1);
        expect(fit.pageY, `page vertical overflow on slide ${slide}`).toBeLessThanOrEqual(1);
      }
    });
  }
});
