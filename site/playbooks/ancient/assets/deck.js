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

  renderTiming();
  const requested = Number(location.hash.slice(1));
  showSlide(Number.isInteger(requested) && requested > 0 && requested <= slides.length ? requested - 1 : 0, false);
  document.querySelector('.deck-meta').textContent = `Ancient · L!S · ${totalMinutes} минут + 25 минут практики`;
})();
