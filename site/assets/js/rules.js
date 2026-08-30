/* ============================================================
   Кодекс командной игры: заповеди, 30 правил с фильтрами,
   лестница внедрения, разборы, источники.
   ============================================================ */

(function () {
  'use strict';

  var U = window.UI;
  var el = U.el;
  var R = window.RULES;

  var ruleIds = R.rules.map(function (r) { return 'rule-' + r.n; });
  var ladderIds = R.ladder.map(function (s) { return s.id; });
  var themeName = {};
  R.themes.forEach(function (t) { themeName[t.id] = t.name; });

  /* ---------------- Прогресс ---------------- */

  function progress() {
    var done = window.Store.countChecked(ruleIds);
    return { done: done, total: ruleIds.length, pct: Math.round((done / ruleIds.length) * 100) };
  }

  function renderHero() {
    var p = progress();
    return el('header', { class: 'panel__header panel__header--hero' }, [
      el('div', { class: 'panel__title' }, [
        el('p', { class: 'eyebrow', text: 'Что каждый обязан развивать' }),
        el('h1', { text: 'Кодекс командной игры' })
      ]),
      el('div', { class: 'panel__aside' }, el('div', { class: 'ring', id: 'rules-ring' }, [
        el('div', { class: 'ring__dial', style: '--value:' + p.pct }, el('span', { class: 'ring__num', text: p.pct + '%' })),
        el('div', { class: 'ring__text' }, [
          el('h3', { text: 'Освоено' }),
          el('p', { class: 'label', style: 'margin-top:4px', text: p.done + ' из ' + p.total + ' правил' })
        ])
      ]))
    ]);
  }

  function refreshRing() {
    var p = progress();
    var ring = document.getElementById('rules-ring');
    if (!ring) return;
    ring.querySelector('.ring__dial').style.setProperty('--value', p.pct);
    ring.querySelector('.ring__num').textContent = p.pct + '%';
    ring.querySelector('.label').textContent = p.done + ' из ' + p.total + ' правил';
  }

  /* ---------------- Кто сколько освоил ---------------- */

  function renderTeam() {
    return el('section', { class: 'section', id: 'progress' }, [
      sectionHead('Видно всем', 'Кто сколько освоил',
        el('span', { class: 'section__count', text: 'обновляется само' })),
      el('p', {
        class: 'section__lead',
        text: 'Полоска — освоенные правила, под ником — этапы лестницы. '
          + 'Видно только количество: какие именно галочки поставил другой, не показывается.'
      }),
      window.TeamProgress.card({
        title: 'Готовность по кодексу',
        hint: 'правила · лестница',
        main: function (p) { return { done: p.rules, total: ruleIds.length }; },
        sub: function (p) { return 'лестница ' + p.ladder + ' / ' + ladderIds.length; }
      })
    ]);
  }

  /* ---------------- Вступление ---------------- */

  function renderIntro() {
    return el('section', { class: 'section', id: 'intro' }, [
      el('p', { class: 'lead', text: R.intro.lead }),
      el('div', { class: 'grid grid--2', style: 'margin-top:var(--s4);align-items:start' }, [
        el('div', { class: 'note note--signal' }, [
          el('span', { class: 'note__title', text: 'Поправка' }),
          el('p', { class: 'note__body', text: R.intro.correction })
        ]),
        el('dl', { class: 'kv' }, R.intro.scale.reduce(function (acc, s) {
          acc.push(el('dt', { text: s.k }));
          acc.push(el('dd', { text: s.v }));
          return acc;
        }, []))
      ])
    ]);
  }

  /* ---------------- 10 заповедей ---------------- */

  function renderCommandments() {
    return el('section', { class: 'section', id: 'zapovedi' }, [
      sectionHead('Сжатая версия', 'Десять заповедей', el('span', { class: 'section__count', text: 'выучить наизусть' })),
      el('div', { class: 'commandments' }, R.commandments.map(function (text, i) {
        return el('article', { class: 'commandment' }, [
          el('span', { class: 'commandment__num', text: U.pad(i + 1) }),
          el('p', { class: 'commandment__text', text: text })
        ]);
      }))
    ]);
  }

  /* ---------------- 30 правил ---------------- */

  var filters = { themes: [], priority: null, query: '', onlyOpen: false };

  function ruleCard(r) {
    var id = 'rule-' + r.n;
    var input = el('input', { type: 'checkbox' });
    input.checked = window.Store.getCheck(id);

    var card = el('article', {
      class: 'rule' + (input.checked ? ' is-done' : ''),
      id: 'pravilo-' + r.n,
      'data-rule': r.n,
      'data-theme-id': r.theme,
      'data-priority': r.p
    }, [
      el('span', { class: 'rule__num', text: U.pad(r.n) }),
      el('div', { class: 'rule__head' }, [
        el('h3', { class: 'rule__title', text: r.title }),
        el('span', { class: 'chip ' + (r.p === 'A' ? 'chip--accent' : 'chip--warn'), text: r.p })
      ]),
      el('p', { class: 'rule__why' }, [el('b', { text: 'Почему: ' }), r.why]),
      el('div', { class: 'rule__foot' }, [
        el('span', { class: 'rule__theme', text: themeName[r.theme] }),
        el('label', { class: 'check rule__check' }, [input, el('span', { class: 'check__text', text: 'Освоено' })])
      ])
    ]);

    input.addEventListener('change', function () {
      window.Store.setCheck(id, input.checked);
      card.classList.toggle('is-done', input.checked);
      refreshRing();
      applyFilters();
    });

    return card;
  }

  function filterChip(label, isActive, onClick) {
    var btn = el('button', { type: 'button', class: 'filter-chip', 'aria-pressed': String(isActive), text: label });
    btn.addEventListener('click', function () { onClick(btn); });
    return btn;
  }

  function renderRules() {
    var counter = el('span', { class: 'filterbar__result', id: 'rules-count' });

    var themeRow = el('div', { class: 'filterbar__row' }, [
      el('span', { class: 'label filterbar__legend', text: 'Тема' })
    ].concat(R.themes.map(function (t) {
      var n = R.rules.filter(function (r) { return r.theme === t.id; }).length;
      return filterChip(t.name + ' · ' + n, false, function (btn) {
        var i = filters.themes.indexOf(t.id);
        if (i === -1) filters.themes.push(t.id); else filters.themes.splice(i, 1);
        btn.setAttribute('aria-pressed', String(filters.themes.indexOf(t.id) !== -1));
        applyFilters();
      });
    })));

    var metaRow = el('div', { class: 'filterbar__row' }, [
      el('span', { class: 'label filterbar__legend', text: 'Приоритет' }),
      filterChip('A — фундамент', false, function (btn) { togglePriority('A', btn); }),
      filterChip('B — сильное', false, function (btn) { togglePriority('B', btn); }),
      filterChip('Только неосвоенные', false, function (btn) {
        filters.onlyOpen = !filters.onlyOpen;
        btn.setAttribute('aria-pressed', String(filters.onlyOpen));
        applyFilters();
      }),
      el('input', {
        type: 'search',
        class: 'filterbar__search',
        placeholder: 'Поиск по формулировке…',
        'aria-label': 'Поиск по правилам',
        oninput: function (e) { filters.query = e.target.value.trim().toLowerCase(); applyFilters(); }
      }),
      counter
    ]);

    function togglePriority(p, btn) {
      filters.priority = filters.priority === p ? null : p;
      metaRow.querySelectorAll('.filter-chip').forEach(function (b) {
        if (b.textContent.indexOf('A —') === 0) b.setAttribute('aria-pressed', String(filters.priority === 'A'));
        if (b.textContent.indexOf('B —') === 0) b.setAttribute('aria-pressed', String(filters.priority === 'B'));
      });
      applyFilters();
    }

    var reset = el('button', { type: 'button', class: 'chip chip--ghost', text: 'Сбросить фильтры' });
    reset.addEventListener('click', function () {
      filters = { themes: [], priority: null, query: '', onlyOpen: false };
      document.querySelectorAll('.filterbar .filter-chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      var search = document.querySelector('.filterbar__search');
      if (search) search.value = '';
      applyFilters();
    });

    return el('section', { class: 'section', id: 'pravila' }, [
      sectionHead('Полный список', 'Тридцать правил', reset),
      el('div', { class: 'filterbar' }, [themeRow, metaRow]),
      el('div', { class: 'rules', id: 'rules-grid' }, R.rules.map(ruleCard)),
      el('p', { class: 'label', id: 'rules-empty', hidden: true, style: 'margin-top:var(--s4)', text: 'Под фильтр ничего не подошло.' })
    ]);
  }

  function applyFilters() {
    var shown = 0;
    document.querySelectorAll('#rules-grid .rule').forEach(function (card) {
      var n = Number(card.getAttribute('data-rule'));
      var rule = R.rules.filter(function (r) { return r.n === n; })[0];
      var ok = true;
      if (filters.themes.length && filters.themes.indexOf(rule.theme) === -1) ok = false;
      if (filters.priority && rule.p !== filters.priority) ok = false;
      if (filters.onlyOpen && window.Store.getCheck('rule-' + n)) ok = false;
      if (filters.query) {
        var hay = (rule.title + ' ' + rule.why + ' ' + themeName[rule.theme]).toLowerCase();
        if (hay.indexOf(filters.query) === -1) ok = false;
      }
      card.hidden = !ok;
      if (ok) shown++;
    });
    var counter = document.getElementById('rules-count');
    if (counter) counter.textContent = 'показано ' + shown + ' из ' + R.rules.length;
    var empty = document.getElementById('rules-empty');
    if (empty) empty.hidden = shown !== 0;
  }

  /* ---------------- Лестница ---------------- */

  function renderLadder() {
    return el('section', { class: 'section', id: 'lestnica' }, [
      sectionHead('Порядок внедрения', 'Не тридцать правил сразу', el('span', { class: 'section__count', text: '10 этапов' })),
      el('p', { class: 'section__lead', text: 'Слоями: пока предыдущий этап не доведён до автоматизма, следующий не берём. Номера справа — ссылки на конкретные правила.' }),
      el('ol', { class: 'ladder' }, R.ladder.map(function (step) {
        var input = el('input', { type: 'checkbox' });
        input.checked = window.Store.getCheck(step.id);
        var node = el('li', { class: 'ladder__step' + (input.checked ? ' is-done' : '') }, [
          el('span', { class: 'ladder__n', text: String(step.n) }),
          el('div', { class: 'ladder__what' }, [
            el('span', { class: 'ladder__title', text: step.title }),
            el('div', { class: 'ladder__rules' }, step.rules.map(function (n) {
              return el('a', { class: 'ladder__ref', href: '#pravilo-' + n, text: '№' + n });
            }))
          ]),
          el('label', { class: 'check rule__check' }, [input, el('span', { class: 'check__text', text: 'Доведено' })])
        ]);
        input.addEventListener('change', function () {
          window.Store.setCheck(step.id, input.checked);
          node.classList.toggle('is-done', input.checked);
        });
        return node;
      }))
    ]);
  }

  /* ---------------- Разборы ---------------- */

  function block(b) {
    switch (b.t) {
      case 'p': return el('p', { html: b.v });
      case 'h': return el('h4', { text: b.v });
      case 'quote': return el('blockquote', { class: 'quote', text: b.v });
      case 'call': return el('p', {}, el('span', { class: 'callsign', text: b.v }));
      case 'list': return el('ul', {}, b.v.map(function (i) { return el('li', { html: i }); }));
      case 'kv': return el('dl', { class: 'kv' }, b.v.reduce(function (acc, i) {
        acc.push(el('dt', { text: i.k }));
        acc.push(el('dd', { html: i.v }));
        return acc;
      }, []));
      case 'compare': return el('div', { class: 'compare' }, Object.keys(b.v).map(function (side) {
        return el('div', { class: 'compare__side compare__side--' + side }, [
          el('span', { class: 'compare__k', text: b.v[side].k }),
          el('p', { class: 'compare__v', text: b.v[side].v })
        ]);
      }));
      default: return null;
    }
  }

  function renderEssays() {
    return el('section', { class: 'section', id: 'razbory' }, [
      sectionHead('Почему именно так', 'Шестнадцать разборов', el('span', { class: 'section__count', text: 'раскрывается по клику' })),
      el('div', { class: 'essays' }, R.essays.map(function (e) {
        return el('details', { class: 'essay', id: e.id }, [
          el('summary', { class: 'essay__summary' }, [
            el('span', { class: 'essay__n', text: U.pad(e.n) }),
            el('h3', { class: 'essay__title', text: e.title })
          ]),
          el('div', { class: 'essay__body' }, e.blocks.map(block))
        ]);
      }))
    ]);
  }

  /* ---------------- Источники ---------------- */

  function renderSources() {
    return el('section', { class: 'section', id: 'istochniki' }, [
      sectionHead('База', 'Источники', el('span', { class: 'section__count', text: R.sources.length + ' ссылок' })),
      el('p', { class: 'section__lead', text: R.sourcesNote }),
      el('ul', { class: 'sources' }, R.sources.map(function (s) {
        return el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, [
          el('span', { class: 'sources__org', text: s.org }),
          el('span', { text: s.title }),
          el('span', { class: 'sources__arrow', text: '↗' })
        ]));
      })),
      el('blockquote', { class: 'quote', style: 'margin-top:var(--s6)', text: R.intro.closing })
    ]);
  }

  /* ---------------- Общее ---------------- */

  function sectionHead(eyebrow, title, right) {
    return el('div', { class: 'section__head' }, [
      el('div', {}, [
        eyebrow ? el('p', { class: 'eyebrow', text: eyebrow }) : null,
        el('h2', { text: title })
      ]),
      right || null
    ]);
  }

  /* ---------------- Старт ---------------- */

  window.Store.init()
    .then(function () {
      U.mount('#rules-page', [
        renderHero(),
        renderIntro(),
        renderTeam(),
        renderCommandments(),
        renderRules(),
        renderLadder(),
        renderEssays(),
        renderSources()
      ]);
      applyFilters();
      U.initPrint();
      U.initActions();
      U.initTools();
      U.initIdentity();
      document.body.classList.remove('is-booting');
    })
    .catch(function (err) {
      if (String(err && err.message) === 'unauthorized') return;
      document.body.classList.remove('is-booting');
      U.mount('#rules-page', U.el('div', { class: 'note note--signal' }, [
        U.el('span', { class: 'note__title', text: 'Не загрузилось' }),
        U.el('p', { class: 'note__body', text: 'Не удалось получить данные с сервера. Обновите страницу.' })
      ]));
    });

  /* Клик по ссылке из лестницы подсвечивает правило */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.ladder__ref');
    if (!a) return;
    var target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    // Если правило скрыто фильтром — снимаем фильтры, иначе прыжок никуда не ведёт.
    if (target.hidden) {
      filters = { themes: [], priority: null, query: '', onlyOpen: false };
      document.querySelectorAll('.filterbar .filter-chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      var search = document.querySelector('.filterbar__search');
      if (search) search.value = '';
      applyFilters();
    }
    target.style.transition = 'outline-color .6s';
    target.style.outline = '2px solid var(--accent)';
    target.style.outlineOffset = '3px';
    setTimeout(function () { target.style.outline = ''; }, 1600);
  });
})();
