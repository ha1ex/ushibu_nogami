/* ============================================================
   Общий тулкит для обеих страниц: DOM-хелперы, даты,
   привязка чекбоксов и заметок с автосейвом, тема, печать, бэкап.
   ============================================================ */

window.UI = (function () {
  'use strict';

  /* ---------------- DOM ---------------- */

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    append(node, kids);
    return node;
  }

  function append(node, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach(function (k) { append(node, k); }); return; }
    node.appendChild(typeof kids === 'string' || typeof kids === 'number'
      ? document.createTextNode(String(kids))
      : kids);
  }

  function frag(kids) {
    var f = document.createDocumentFragment();
    append(f, kids);
    return f;
  }

  function mount(selector, node) {
    var host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return null;
    host.textContent = '';
    append(host, node);
    return host;
  }

  /* ---------------- Даты ---------------- */

  var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  // 'YYYY-MM-DD' → локальная дата (без сдвига часового пояса, как у new Date(iso))
  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtShort(iso) {
    var d = parseDate(iso);
    return d ? pad(d.getDate()) + '.' + pad(d.getMonth() + 1) : '';
  }

  function fmtFull(iso) {
    var d = parseDate(iso);
    return d ? pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() : '';
  }

  function weekday(iso) {
    var d = parseDate(iso);
    return d ? WD[d.getDay()] : '';
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function daysUntil(iso) {
    var target = parseDate(iso);
    if (!target) return null;
    return Math.round((target - startOfToday()) / 86400000);
  }

  function plural(n, one, few, many) {
    var t = Math.abs(n) % 100;
    var l = t % 10;
    if (t >= 11 && t <= 14) return many;
    if (l === 1) return one;
    if (l >= 2 && l <= 4) return few;
    return many;
  }

  /* ---------------- Чекбоксы и заметки ---------------- */

  var checkHandlers = [];

  function onChecksChanged(fn) { checkHandlers.push(fn); }
  function fireChecksChanged() { checkHandlers.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // Чекбокс с подписью
  function check(id, text, className) {
    var input = el('input', { type: 'checkbox', 'data-check': id });
    input.checked = window.Store.getCheck(id);
    input.addEventListener('change', function () {
      window.Store.setCheck(id, input.checked);
      fireChecksChanged();
    });
    return el('label', { class: 'check' + (className ? ' ' + className : '') }, [
      input,
      el('span', { class: 'check__text', text: text })
    ]);
  }

  // Текстовое поле с автосохранением. Индикатор показывает не «мы записали
  // в localStorage», а что реально произошло с отправкой на сервер.
  function noteField(id, labelText, placeholder, tag) {
    var saved = el('span', { class: 'field__saved', role: 'status', 'aria-live': 'polite' });
    var input = el(tag === 'input' ? 'input' : 'textarea', {
      'data-note': id,
      placeholder: placeholder || '',
      type: tag === 'input' ? 'text' : null,
      'aria-label': labelText || placeholder || 'Заметка'
    });
    input.value = window.Store.getNote(id);

    var timer = null;
    var hideTimer = null;
    var dirty = false;

    input.addEventListener('input', function () {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      dirty = true;
      saved.textContent = 'сохраняем…';
      saved.classList.add('is-on', 'is-pending');
      saved.classList.remove('is-failed');
      timer = setTimeout(function () { window.Store.setNote(id, input.value); }, 400);
    });

    window.Store.onStatus(function (status) {
      if (!dirty) return;
      if (status === 'saved') {
        dirty = false;
        saved.textContent = 'сохранено';
        saved.classList.remove('is-pending', 'is-failed');
        hideTimer = setTimeout(function () { saved.classList.remove('is-on'); }, 1600);
      } else if (status === 'error') {
        saved.textContent = 'нет связи';
        saved.classList.add('is-failed');
        saved.classList.remove('is-pending');
      }
    });

    // Без подписи (счёт матча, тема слота) лейбл-строка только съедала бы высоту:
    // индикатор сохранения в этом случае всплывает поверх поля.
    if (!labelText) {
      return el('label', { class: 'field field--bare' }, [input, saved]);
    }

    return el('label', { class: 'field' }, [
      el('span', { class: 'field__label' }, [el('span', { text: labelText }), saved]),
      input
    ]);
  }

  /* ---------------- Тост ---------------- */

  var toastNode = null;
  var toastTimer = null;

  function toast(message, isError) {
    if (!toastNode) {
      toastNode = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = message;
    toastNode.classList.toggle('toast--error', !!isError);
    // перезапуск анимации
    void toastNode.offsetWidth;
    toastNode.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastNode.classList.remove('is-on'); }, 3200);
  }

  /* ---------------- Печать ---------------- */

  function initPrint() {
    var reopened = [];

    function expandAll() {
      reopened = [];
      document.querySelectorAll('details:not([open])').forEach(function (d) {
        d.open = true;
        reopened.push(d);
      });
    }
    function restore() {
      reopened.forEach(function (d) { d.open = false; });
      reopened = [];
    }

    window.addEventListener('beforeprint', expandAll);
    window.addEventListener('afterprint', restore);

    document.querySelectorAll('[data-action="print"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Safari не всегда шлёт beforeprint — раскрываем руками.
        expandAll();
        window.print();
        setTimeout(restore, 800);
      });
    });
  }

  /* ---------------- Действия в сайдбаре ---------------- */

  function initActions() {
    document.querySelectorAll('[data-action="export"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var blob = new Blob([window.Store.exportJSON()], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var d = new Date();
        var a = el('a', {
          href: url,
          download: 'ushibu-cs2-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json'
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('Бэкап сохранён в загрузки');
      });
    });

    // Сбрасываем только личное. Командные заметки и вето общие —
    // стирать их кнопкой одного игрока нельзя.
    document.querySelectorAll('[data-action="reset"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Сбросить ТОЛЬКО свои отметки — гранаты, правила, лестницу?\n\nКомандные заметки, вето и счёт не тронутся.')) return;
        window.Store.resetPersonal().then(function (n) {
          toast('Сброшено отметок: ' + n);
          setTimeout(function () { window.location.reload(); }, 600);
        });
      });
    });

    document.querySelectorAll('[data-action="logout"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.Store.flush().then(function () {
          var form = el('form', { method: 'POST', action: '/api/logout' });
          document.body.appendChild(form);
          form.submit();
        });
      });
    });
  }

  /* ---------------- Свёрнутая панель действий на мобильном ---------------- */

  function initTools() {
    var toggle = document.getElementById('tools-toggle');
    var sidebar = document.querySelector('.sidebar');
    if (!toggle || !sidebar) return;
    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('is-tools-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------------- Кто вошёл и статус синхронизации ---------------- */

  function initIdentity() {
    var me = window.Store.me();
    document.querySelectorAll('[data-whoami]').forEach(function (node) {
      node.textContent = me ? me.nick : '—';
    });

    var bar = document.getElementById('syncbar');
    var text = document.getElementById('sync-text');
    if (!bar || !text) return;

    function render(status) {
      var pending = window.Store.pendingCount();
      bar.classList.remove('is-saving', 'is-error', 'is-ok');
      if (status === 'error') {
        bar.classList.add('is-error');
        text.textContent = 'нет связи · ' + pending + ' в очереди';
      } else if (status === 'saving') {
        bar.classList.add('is-saving');
        text.textContent = 'сохраняем…';
      } else {
        bar.classList.add('is-ok');
        text.textContent = pending ? pending + ' в очереди' : 'всё сохранено';
      }
    }

    render(window.Store.status());
    window.Store.onStatus(render);
  }

  return {
    el: el, frag: frag, mount: mount, append: append,
    parseDate: parseDate, fmtShort: fmtShort, fmtFull: fmtFull, weekday: weekday,
    daysUntil: daysUntil, startOfToday: startOfToday, plural: plural, pad: pad,
    check: check, noteField: noteField, onChecksChanged: onChecksChanged, fireChecksChanged: fireChecksChanged,
    toast: toast, initTools: initTools, initActions: initActions, initIdentity: initIdentity,
    initPrint: initPrint
  };
})();
