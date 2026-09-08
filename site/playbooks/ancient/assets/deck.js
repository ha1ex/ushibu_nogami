(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const progress = document.querySelector('.progress-fill');
  const counter = document.querySelector('.counter');
  const timerOutput = document.querySelector('.timer');
  const timerButton = document.querySelector('[data-action="timer"]');
  const fullscreenButton = document.querySelector('[data-action="fullscreen"]');
  const totalMinutes = slides.reduce((sum, slide) => sum + Number(slide.dataset.minutes || 0), 0);
  let current = 0;
  let elapsed = 0;
  let timerStartedAt = 0;
  let timerFrame = 0;
  let timerRunning = false;
  let touchStartX = null;

  slides.forEach((slide, index) => {
    slide.dataset.index = String(index + 1).padStart(2, '0');
  });

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const overlaps = (a, b, gap = 3) => !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top);

  const segmentsCross = (a, b, c, d) => {
    const turn = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
  };

  const leaderEnd = (anchor, label) => {
    const center = { x: (label.left + label.right) / 2, y: (label.top + label.bottom) / 2 };
    const dx = center.x - anchor.x;
    const dy = center.y - anchor.y;
    const tx = dx > 0 ? (label.left - anchor.x) / dx : (label.right - anchor.x) / dx;
    const ty = dy > 0 ? (label.top - anchor.y) / dy : (label.bottom - anchor.y) / dy;
    const t = Math.max(Number.isFinite(tx) ? tx : 0, Number.isFinite(ty) ? ty : 0);
    return { x: anchor.x + dx * t, y: anchor.y + dy * t };
  };

  function layoutDiagram(frame) {
    if (!frame || !frame.offsetWidth) return;
    const bounds = frame.getBoundingClientRect();
    const notes = [...frame.querySelectorAll('.map-note')];
    const anchors = notes.map((note) => {
      const dot = note.querySelector('.anchor-dot').getBoundingClientRect();
      return { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 };
    });
    const placed = [];
    const segments = [];
    notes.forEach((note, index) => {
      const label = note.querySelector('.map-label');
      const leader = note.querySelector('.leader');
      label.style.removeProperty('left');
      label.style.removeProperty('top');
      const measured = label.getBoundingClientRect();
      const w = measured.width;
      const h = measured.height;
      const anchor = anchors[index];
      const defaultOffsets = [
        [18, -h - 12], [-w - 18, -h - 12], [18, 12], [-w - 18, 12],
        [-w / 2, -h - 22], [-w / 2, 22], [36, -h / 2], [-w - 36, -h / 2],
        [38, -h - 24], [-w - 38, -h - 24], [38, 24], [-w - 38, 24],
        [58, -h - 34], [-w - 58, -h - 34], [58, 34], [-w - 58, 34],
        [78, -h - 44], [-w - 78, -h - 44], [78, 44], [-w - 78, 44],
        [18, -h - 68], [-w - 18, -h - 68], [18, 68], [-w - 18, 68],
        [36, -h - 94], [-w - 36, -h - 94], [36, 94], [-w - 36, 94]
      ];
      const offsets = /Рампа B/.test(label.textContent)
        ? [[-w - 36, -h - 24], [-w - 36, 24], ...defaultOffsets]
        : defaultOffsets;
      let chosen;
      for (const [rawX, rawY] of offsets) {
        label.style.left = `${rawX}px`;
        label.style.top = `${rawY}px`;
        let rect = label.getBoundingClientRect();
        const shiftX = rect.left < bounds.left + 5 ? bounds.left + 5 - rect.left : rect.right > bounds.right - 5 ? bounds.right - 5 - rect.right : 0;
        const shiftY = rect.top < bounds.top + 5 ? bounds.top + 5 - rect.top : rect.bottom > bounds.bottom - 5 ? bounds.bottom - 5 - rect.bottom : 0;
        if (shiftX || shiftY) {
          label.style.left = `${rawX + shiftX}px`;
          label.style.top = `${rawY + shiftY}px`;
          rect = label.getBoundingClientRect();
        }
        const end = leaderEnd(anchor, rect);
        const coversAnchor = anchors.some((point, other) => other !== index && point.x > rect.left - 4 && point.x < rect.right + 4 && point.y > rect.top - 4 && point.y < rect.bottom + 4);
        if (!coversAnchor && placed.every((other) => !overlaps(rect, other)) && segments.every((segment) => !segmentsCross(anchor, end, segment.start, segment.end))) {
          chosen = { rect, end };
          break;
        }
      }
      if (!chosen) {
        label.style.left = '18px';
        label.style.top = `${-h - 12}px`;
        let rect = label.getBoundingClientRect();
        const shiftX = rect.left < bounds.left + 5 ? bounds.left + 5 - rect.left : rect.right > bounds.right - 5 ? bounds.right - 5 - rect.right : 0;
        const shiftY = rect.top < bounds.top + 5 ? bounds.top + 5 - rect.top : rect.bottom > bounds.bottom - 5 ? bounds.bottom - 5 - rect.bottom : 0;
        label.style.left = `${18 + shiftX}px`;
        label.style.top = `${-h - 12 + shiftY}px`;
        rect = label.getBoundingClientRect();
        chosen = { rect, end: leaderEnd(anchor, rect) };
      }
      const dx = chosen.end.x - anchor.x;
      const dy = chosen.end.y - anchor.y;
      leader.style.width = `${Math.hypot(dx, dy)}px`;
      leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      note.style.setProperty('--leader-end-x', chosen.end.x.toFixed(3));
      note.style.setProperty('--leader-end-y', chosen.end.y.toFixed(3));
      placed.push(chosen.rect);
      segments.push({ start: anchor, end: chosen.end });
    });
    const settledBounds = frame.getBoundingClientRect();
    const settledAnchors = notes.map((note) => {
      const dot = note.querySelector('.anchor-dot').getBoundingClientRect();
      return { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 };
    });
    const settledLabels = [];
    notes.forEach((note) => {
      const label = note.querySelector('.map-label');
      const index = notes.indexOf(note);
      const anchor = settledAnchors[index];
      const w = label.offsetWidth;
      const h = label.offsetHeight;
      const defaultOffsets = [
        [18, -h - 12], [-w - 18, -h - 12], [18, 12], [-w - 18, 12],
        [-w / 2, -h - 24], [-w / 2, 24], [38, -h / 2], [-w - 38, -h / 2],
        [58, -h - 34], [-w - 58, -h - 34], [58, 34], [-w - 58, 34],
        [82, -h - 48], [-w - 82, -h - 48], [82, 48], [-w - 82, 48],
        [18, -h - 68], [-w - 18, -h - 68], [18, 68], [-w - 18, 68],
        [36, -h - 94], [-w - 36, -h - 94], [36, 94], [-w - 36, 94]
      ];
      const candidates = /Рампа B/.test(label.textContent)
        ? [[-w - 36, -h - 24], [-w - 36, 24], ...defaultOffsets]
        : defaultOffsets;
      let rect;
      for (const [x, y] of candidates) {
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        const candidate = label.getBoundingClientRect();
        const inside = candidate.left >= settledBounds.left + 5 && candidate.top >= settledBounds.top + 5 && candidate.right <= settledBounds.right - 5 && candidate.bottom <= settledBounds.bottom - 5;
        const coversAnchor = settledAnchors.some((point, other) => other !== index && point.x > candidate.left - 3 && point.x < candidate.right + 3 && point.y > candidate.top - 3 && point.y < candidate.bottom + 3);
        if (inside && !coversAnchor && settledLabels.every((other) => !overlaps(candidate, other))) {
          rect = candidate;
          break;
        }
      }
      if (!rect) {
        rect = label.getBoundingClientRect();
        const currentLeft = Number.parseFloat(label.style.left) || 0;
        const currentTop = Number.parseFloat(label.style.top) || 0;
        const shiftX = rect.left < settledBounds.left + 5 ? settledBounds.left + 5 - rect.left : rect.right > settledBounds.right - 5 ? settledBounds.right - 5 - rect.right : 0;
        const shiftY = rect.top < settledBounds.top + 5 ? settledBounds.top + 5 - rect.top : rect.bottom > settledBounds.bottom - 5 ? settledBounds.bottom - 5 - rect.bottom : 0;
        label.style.left = `${currentLeft + shiftX}px`;
        label.style.top = `${currentTop + shiftY}px`;
        rect = label.getBoundingClientRect();
      }
      settledLabels.push(rect);
      const end = leaderEnd(anchor, rect);
      const dx = end.x - anchor.x;
      const dy = end.y - anchor.y;
      const leader = note.querySelector('.leader');
      leader.style.width = `${Math.hypot(dx, dy)}px`;
      leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      note.style.setProperty('--leader-end-x', (end.x - anchor.x).toFixed(3));
      note.style.setProperty('--leader-end-y', (end.y - anchor.y).toFixed(3));
    });
  }

  function connectLeaders(frame) {
    if (!frame || !frame.offsetWidth) return;
    frame.querySelectorAll('.map-note').forEach((note) => {
      const label = note.querySelector('.map-label').getBoundingClientRect();
      const dot = note.querySelector('.anchor-dot').getBoundingClientRect();
      const anchor = { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 };
      const end = leaderEnd(anchor, label);
      const dx = end.x - anchor.x;
      const dy = end.y - anchor.y;
      const leader = note.querySelector('.leader');
      leader.style.width = `${Math.hypot(dx, dy)}px`;
      leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      note.style.setProperty('--leader-end-x', dx.toFixed(3));
      note.style.setProperty('--leader-end-y', dy.toFixed(3));
    });
  }

  const layoutActiveDiagram = () => {
    const frame = slides[current].querySelector('.map-stage');
    layoutDiagram(frame);
    connectLeaders(frame);
  };

  function plannedRange(index) {
    const before = slides.slice(0, index).reduce((sum, slide) => sum + Number(slide.dataset.minutes || 0), 0);
    const duration = Number(slides[index].dataset.minutes || 0);
    return { before, after: before + duration, duration };
  }

  function renderTiming() {
    slides.forEach((slide, index) => {
      const target = slide.querySelector('.timing');
      if (!target) return;
      const range = plannedRange(index);
      if (range.duration === 0) {
        target.innerHTML = '<strong>После созвона</strong>практика';
        return;
      }
      const noun = range.duration === 1 ? 'минута' : range.duration < 5 ? 'минуты' : 'минут';
      target.innerHTML = `<strong>${range.duration} ${noun}</strong>план ${range.before}:00–${range.after}:00`;
    });
  }

  function showSlide(index, updateHash = true) {
    current = clamp(index, 0, slides.length - 1);
    const nextSlide = slides[current];
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('.slide') && !nextSlide.contains(focused)) focused.blur();
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === current;
      slide.classList.toggle('is-active', active);
      slide.inert = !active;
      slide.setAttribute('aria-hidden', String(!active));
      if (active) slide.scrollTop = 0;
    });
    const accent = getComputedStyle(nextSlide).getPropertyValue('--accent').trim();
    progress.style.width = `${((current + 1) / slides.length) * 100}%`;
    progress.style.background = accent;
    counter.textContent = `${current + 1} / ${slides.length}`;
    document.documentElement.style.setProperty('--accent', accent);
    if (updateHash) history.replaceState(null, '', `#${current + 1}`);
    layoutActiveDiagram();
  }

  function navigate(delta) { showSlide(current + delta); }

  function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }

  function updateTimer() {
    if (!timerRunning) return;
    const currentElapsed = elapsed + performance.now() - timerStartedAt;
    timerOutput.value = formatTime(currentElapsed);
    timerOutput.textContent = formatTime(currentElapsed);
    timerFrame = requestAnimationFrame(updateTimer);
  }

  function toggleTimer() {
    if (timerRunning) {
      elapsed += performance.now() - timerStartedAt;
      timerRunning = false;
      cancelAnimationFrame(timerFrame);
      timerButton.textContent = 'Старт';
    } else {
      timerStartedAt = performance.now();
      timerRunning = true;
      timerButton.textContent = 'Пауза';
      updateTimer();
    }
  }

  function resetTimer() {
    timerRunning = false;
    elapsed = 0;
    cancelAnimationFrame(timerFrame);
    timerOutput.value = '00:00';
    timerOutput.textContent = '00:00';
    timerButton.textContent = 'Старт';
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) {
      // Полноэкранный режим может быть запрещён политикой браузера.
    }
  }

  function toggleAnswers(button) {
    const quizSlide = button.closest('.slide');
    const visible = quizSlide.classList.toggle('answers-visible');
    button.textContent = visible ? 'Скрыть ответы' : 'Показать ответы';
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'prev') navigate(-1);
    if (action === 'next') navigate(1);
    if (action === 'timer') toggleTimer();
    if (action === 'reset') resetTimer();
    if (action === 'fullscreen') toggleFullscreen();
    if (action === 'answers') toggleAnswers(button);
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target.tagName;
    const interactive = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const activatesControl = ['Enter', ' '].includes(event.key);
    if (interactive && activatesControl) return;
    if (['ArrowRight', 'PageDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      navigate(1);
    }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      navigate(-1);
    }
    if (event.key === 'Home') showSlide(0);
    if (event.key === 'End') showSlide(slides.length - 1);
    if (event.code === 'KeyT') toggleTimer();
    if (event.code === 'KeyF') toggleFullscreen();
    if (event.code === 'KeyR') {
      const button = slides[slides.length - 1].querySelector('[data-action="answers"]');
      if (button) toggleAnswers(button);
    }
  });

  document.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    if (Math.abs(delta) > 60) navigate(delta < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  window.addEventListener('hashchange', () => {
    const requested = Number(location.hash.slice(1));
    showSlide(Number.isInteger(requested) && requested > 0 && requested <= slides.length ? requested - 1 : 0, false);
  });

  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = document.fullscreenElement ? 'Окно' : 'Экран';
  });

  window.addEventListener('resize', layoutActiveDiagram);
  window.addEventListener('load', layoutActiveDiagram);
  if (document.fonts) document.fonts.ready.then(layoutActiveDiagram);

  renderTiming();
  const requested = Number(location.hash.slice(1));
  window.ancientDeck = { showSlide, layoutActiveDiagram, connectActiveLeaders: () => connectLeaders(slides[current].querySelector('.map-stage')) };
  showSlide(Number.isInteger(requested) && requested > 0 && requested <= slides.length ? requested - 1 : 0, false);
  document.querySelector('.deck-meta').textContent = `Ancient · L!S · ${totalMinutes} минут + 25 минут практики`;
})();
