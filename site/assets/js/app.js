/* Operational headquarters. JSON and state values only enter the DOM as text. */
(function () {
  'use strict';

  var Core = window.OperationsCore;
  var operations = null;
  var statsPromise = null;
  var noteSerial = 0;

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) return children.forEach(function (child) { append(node, child); });
    node.appendChild(typeof children === 'string' || typeof children === 'number'
      ? document.createTextNode(String(children)) : children);
  }

  function create(tag, attributes, children) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (name) {
      var value = attributes[name];
      if (value === null || value === undefined || value === false) return;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = String(value);
      else if (name.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(name.slice(2), value);
      else if (value === true) node.setAttribute(name, '');
      else node.setAttribute(name, String(value));
    });
    append(node, children);
    return node;
  }

  function mount(host, children) {
    host.textContent = '';
    append(host, children);
  }

  function find(rows, id) {
    return (rows || []).filter(function (row) { return row.id === id; })[0] || null;
  }

  function vetoCard(match) {
    return match ? find(match.cards, match.vetoCardId) : null;
  }

  function formatDate(iso) {
    var parts = String(iso || '').split('-');
    return parts.length === 3 ? parts[2] + '.' + parts[1] + '.' + parts[0] : 'Дата неизвестна';
  }

  function header(eyebrow, title, description, aside) {
    return create('header', { class: 'panel__header ops-header' }, [
      create('div', { class: 'panel__title' }, [
        create('p', { class: 'eyebrow', text: eyebrow }),
        create('h1', { tabindex: '-1', text: title }),
        description ? create('p', { class: 'lead ops-lead', text: description }) : null
      ]),
      aside ? create('div', { class: 'panel__aside', text: aside }) : null
    ]);
  }

  function section(title, children, label) {
    return create('section', { class: 'section ops-section' }, [
      create('div', { class: 'section__head' }, [
        create('div', {}, [label ? create('p', { class: 'eyebrow', text: label }) : null, create('h2', { text: title })])
      ]),
      children
    ]);
  }

  function cardMeta(card) {
    if (card.type === 'fact' || card.type === 'projection') {
      return card.sourceLabel + ' · на ' + formatDate(card.asOf) + ' · уверенность: ' + confidence(card.confidence);
    }
    if (card.type === 'unknown') return 'Ответственный: ' + card.owner + ' · закрыть до ' + formatDate(card.dueAt);
    if (card.type === 'action') return 'Ответственный: ' + card.owner + ' · срок ' + formatDate(card.dueAt);
    return 'Ответственный: ' + card.owner + ' · принято ' + formatDate(card.decidedAt);
  }

  function confidence(value) {
    return { high: 'высокая', medium: 'средняя', low: 'низкая' }[value] || 'не указана';
  }

  function cardLabel(type) {
    return { fact: 'Факт', projection: 'Проекция', decision: 'Решение', unknown: 'Неизвестно', action: 'Действие' }[type];
  }

  function renderCard(card, options) {
    options = options || {};
    var body = [
      create('div', { class: 'ops-card__head' }, [
        create('span', { class: 'ops-card__type ops-card__type--' + card.type, text: cardLabel(card.type) }),
        create('span', { class: 'ops-card__meta', text: cardMeta(card) })
      ]),
      create('h3', { text: card.title }),
      create('p', { class: 'ops-card__body', text: card.body })
    ];
    if (card.type === 'unknown') {
      body.push(create('p', { class: 'ops-card__verify', text: 'Закроет пробел: ' + card.closeWith }));
    } else if (card.type === 'action') {
      body.push(create('p', { class: 'ops-card__verify', text: 'Проверка: ' + card.verifyWith }));
      if (options.checkable) body.push(actionCheck(card));
    } else if (card.type === 'projection') {
      body.push(create('p', { class: 'ops-card__verify', text: 'Оговорка: ' + card.caveat }));
    } else if (card.type === 'decision') {
      body.push(create('p', { class: 'ops-card__verify', text: 'Основание: ' + card.rationale }));
    }
    return create('article', { class: 'ops-card ops-card--' + card.type, 'data-card-type': card.type }, body);
  }

  function actionCheck(card) {
    var input = create('input', { type: 'checkbox', 'data-check': card.id });
    input.checked = window.Store.getCheck(card.id);
    input.addEventListener('change', function () { window.Store.setCheck(card.id, input.checked); });
    return create('label', { class: 'check ops-action-check' }, [
      input, create('span', { class: 'check__text', text: 'Отметить выполнение действия: ' + card.title })
    ]);
  }

  function noteField(id, labelText, placeholder, inputTag) {
    var fieldId = 'ops-field-' + (++noteSerial);
    var saved = create('span', { class: 'field__saved ops-save-status', role: 'status', 'aria-live': 'polite' });
    var input = create(inputTag === 'input' ? 'input' : 'textarea', {
      id: fieldId, 'data-note': id, type: inputTag === 'input' ? 'text' : null,
      placeholder: placeholder || '', 'aria-describedby': fieldId + '-status'
    });
    saved.id = fieldId + '-status';
    input.value = window.Store.getNote(id);
    var timer = null;
    var dirty = false;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      dirty = true;
      saved.textContent = 'Сохраняем…';
      saved.classList.add('is-on', 'is-pending');
      saved.classList.remove('is-failed');
      timer = setTimeout(function () { window.Store.setNote(id, input.value); }, 400);
    });
    window.Store.onStatus(function (status) {
      if (!dirty) return;
      if (status === 'saved') {
        dirty = false; saved.textContent = 'Сохранено';
        saved.classList.remove('is-pending', 'is-failed'); saved.classList.add('is-on');
      } else if (status === 'error') {
        saved.textContent = 'Ошибка сохранения'; saved.classList.add('is-on', 'is-failed');
      }
    });
    return create('div', { class: 'field ops-field' }, [
      create('div', { class: 'field__label' }, [create('label', { for: fieldId, text: labelText }), saved]), input
    ]);
  }

  function cardsGrid(cards, options) {
    return create('div', { class: 'ops-grid' }, cards.map(function (card) { return renderCard(card, options); }));
  }

  function renderNow() {
    var selected = Core.selectMatch(operations.matches, Core.todayIso(new Date()));
    var match = selected.match;
    if (!match) return [header('Маршрут', 'Сейчас', 'В оперативном источнике нет матчей.')];
    var facts = match.cards.filter(function (card) { return card.type === 'fact'; });
    var unknowns = match.cards.filter(function (card) { return card.type === 'unknown'; });
    var actions = match.cards.filter(function (card) { return card.type === 'action'; }).slice(0, 3);
    return [
      header('Маршрут / ближайшая точка', 'Сейчас', selected.completedFallback
        ? 'Все матчи расписания прошли. Показан последний матч; фактический результат нужно подтвердить.'
        : 'Ближайший предстоящий матч выбран относительно текущей даты.', formatDate(match.date)),
      create('article', { class: 'ops-match-hero' }, [
        create('p', { class: 'eyebrow', text: 'Матч ' + match.id.toUpperCase() }),
        create('h2', { text: match.opponent }),
        create('time', { datetime: match.date, text: formatDate(match.date) }),
        create('a', { class: 'ops-primary-link', href: '#/match/' + match.id, text: 'Открыть карточку матча' })
      ]),
      section('Подтверждено', cardsGrid(facts), 'Факты'),
      section('Блокеры', cardsGrid(unknowns), 'Нужно закрыть'),
      section('Следующие действия', cardsGrid(actions), 'Не больше трёх')
    ];
  }

  function renderMatches() {
    return [
      header('Маршрут сезона', 'Матчи', 'Только наши матчи из репозиторного оперативного источника.', operations.matches.length + ' матча'),
      create('div', { class: 'ops-list' }, operations.matches.map(function (match) {
        var veto = vetoCard(match);
        return create('article', { class: 'ops-list-row' }, [
          create('time', { datetime: match.date, text: formatDate(match.date) }),
          create('div', {}, [create('h2', { text: match.opponent }), create('p', { text: veto ? veto.title : 'Статус вето не указан' })]),
          create('a', { class: 'ops-row-link', href: '#/match/' + match.id, text: 'Открыть матч' })
        ]);
      }))
    ];
  }

  function renderMatch(match) {
    if (!match) return renderNotFound();
    var veto = vetoCard(match);
    return [
      header('Матч ' + match.id.toUpperCase(), match.opponent, 'Оперативная карточка на ' + formatDate(match.date), formatDate(match.date)),
      create('div', { class: 'ops-status-strip', 'data-veto-type': veto ? veto.type : 'missing' }, [
        create('span', { class: 'ops-status-dot', 'aria-hidden': 'true' }),
        create('strong', { text: veto ? veto.title : 'Статус вето не указан' })
      ]),
      section('Факты и неизвестные', cardsGrid(match.cards.filter(function (card) { return card.type !== 'action'; })), 'Состояние матча'),
      section('Действия', cardsGrid(match.cards.filter(function (card) { return card.type === 'action'; }), { checkable: true }), 'Выполнение, не освоение'),
      section('Матчевый журнал', create('div', { class: 'ops-form-grid' }, [
        noteField('match-' + match.id + '-score', 'Фактический счёт', '—:—', 'input'),
        noteField('match-' + match.id + '-note', 'Фактическая заметка', 'Что подтверждено после матча…')
      ]), 'Сохраняется для команды')
    ];
  }

  function renderTraining() {
    return [
      header('Фактические сессии', 'Тренировки', 'Проведение сессии не означает освоение карты.', operations.training.length + ' сессия'),
      create('div', { class: 'ops-stack' }, operations.training.map(function (training) {
        var report = create('article', { class: 'ops-training' }, [
          create('div', { class: 'ops-training__title' }, [create('h2', { text: training.map }), create('time', { datetime: training.date, text: formatDate(training.date) })]),
          cardsGrid(training.cards),
          create('div', { class: 'ops-report' }, [
            noteField('training-' + training.mapId + '-report', 'Фактическая заметка о сессии', 'Кто был, что реально прошли, какие договорённости зафиксировали…'),
            actionCheck({ id: 'training-' + training.mapId + '-report-complete', title: 'фактический отчёт заполнен' })
          ])
        ]);
        return report;
      }))
    ];
  }

  function renderMaps() {
    return [
      header('Текущий пул', 'Карты', 'Протокол появляется здесь только после публикации и проверки.', operations.maps.length + ' карт'),
      create('div', { class: 'ops-grid ops-grid--maps' }, operations.maps.map(function (map) {
        return create('article', { class: 'ops-map', 'data-map-id': map.id }, [
          create('p', { class: 'eyebrow', text: 'Протокол отсутствует' }),
          create('h2', {}, create('a', { href: '#/karty/' + map.id, text: map.name })),
          create('p', { class: 'ops-map__state', text: map.cards[0].title })
        ]);
      }))
    ];
  }

  function renderMap(map) {
    if (!map) return renderNotFound();
    return [
      header('Карта / протокол', map.name, 'В интерфейсе нет черновых тактик или автоматически собранных советов.'),
      cardsGrid(map.cards),
      create('a', { class: 'ops-back-link', href: '#/karty', text: '← Все карты' })
    ];
  }

  function renderOpponents() {
    return [
      header('Наше расписание', 'Соперники', 'Карточки показывают дату матча и границу метода — без автоугроз и автослабостей.', operations.opponents.length + ' соперника'),
      create('div', { class: 'ops-grid' }, operations.opponents.map(function (opponent) {
        var projection = opponent.cards.filter(function (card) { return card.type === 'projection'; })[0];
        return create('article', { class: 'ops-opponent', 'data-opponent-id': opponent.id }, [
          create('time', { datetime: opponent.matchDate, text: formatDate(opponent.matchDate) }),
          create('h2', {}, create('a', { href: '#/soperniki/' + opponent.id, text: opponent.name })),
          create('p', { text: projection.caveat })
        ]);
      }))
    ];
  }

  function renderOpponent(opponent) {
    if (!opponent) return renderNotFound();
    return [
      header('Соперник / наш матч', opponent.name, 'Матч ' + formatDate(opponent.matchDate), formatDate(opponent.matchDate)),
      cardsGrid(opponent.cards),
      create('div', { class: 'ops-route-actions' }, [
        create('a', { class: 'ops-primary-link', href: '#/match/' + opponent.matchId, text: 'Открыть наш матч' }),
        create('a', { class: 'ops-back-link', href: '#/soperniki', text: '← Все соперники' })
      ])
    ];
  }

  function renderNotFound() {
    return [header('Маршрут', 'Страница не найдена', 'В оперативном источнике нет сущности для этого адреса.'), create('a', { class: 'ops-primary-link', href: '#/seichas', text: 'Вернуться на экран «Сейчас»' })];
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script'); script.src = src; script.onload = resolve;
      script.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(script);
    });
  }

  function ensureStats() {
    if (window.Stats && window.StatsCore) return Promise.resolve(window.Stats);
    if (!statsPromise) {
      statsPromise = loadScript('/assets/js/stats-core.js').then(function () { return loadScript('/assets/js/stats.js'); }).then(function () {
        if (!window.Stats) throw new Error('Раздел данных не запустился');
        return window.Stats;
      }).catch(function (error) { statsPromise = null; throw error; });
    }
    return statsPromise;
  }

  function renderStatsError(error, route) {
    var retry = create('button', { type: 'button', class: 'stats-retry', text: 'Повторить загрузку' });
    retry.addEventListener('click', function () { statsPromise = null; openRoute(route); });
    mount(document.getElementById('statistics'), create('div', { class: 'stats-state stats-state--error' }, [
      create('h1', { text: 'Данные недоступны' }), create('p', { text: String(error && error.message || 'Ошибка загрузки') }), retry,
      create('p', { role: 'status', 'aria-live': 'polite', text: 'Ошибка: данные недоступны' })
    ]));
  }

  function updateNavigation(sectionName) {
    document.querySelectorAll('[data-section]').forEach(function (link) {
      if (link.getAttribute('data-section') === sectionName) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function renderRoute(route) {
    if (route.view === 'now') return renderNow();
    if (route.view === 'matchi') return renderMatches();
    if (route.view === 'match') return renderMatch(find(operations.matches, route.id));
    if (route.view === 'trenirovki') return renderTraining();
    if (route.view === 'karty') return renderMaps();
    if (route.view === 'map') return renderMap(find(operations.maps, route.id));
    if (route.view === 'soperniki') return renderOpponents();
    if (route.view === 'opponent') return renderOpponent(find(operations.opponents, route.id));
    return renderNotFound();
  }

  function openRoute(route) {
    if (route.redirect) {
      window.history.replaceState(null, '', route.redirect);
      return openRoute(Core.parseHash(route.redirect));
    }
    var operational = document.getElementById('operational');
    var statistics = document.getElementById('statistics');
    updateNavigation(route.section);
    if (route.view === 'statistics') {
      operational.hidden = true; statistics.hidden = false;
      document.title = 'Данные — Штаб CS2 «Ушибу ногами»';
      ensureStats().then(function () {
        window.Stats.open(window.StatsCore.parseHash(route.rawHash), {
          moveFocus: false,
          canonicalMaps: operations.maps.map(function (map) { return { id: map.id, name: map.name }; })
        });
      }).catch(function (error) { renderStatsError(error, route); });
      return;
    }
    statistics.hidden = true; operational.hidden = false;
    mount(operational, renderRoute(route));
    var heading = operational.querySelector('h1');
    document.title = (heading ? heading.textContent : 'Штаб') + ' — Штаб CS2 «Ушибу ногами»';
  }

  function routeCurrent() { return Core.parseHash(window.location.hash || '#/seichas'); }

  function showLoadError(error) {
    var host = document.getElementById('operational');
    var retry = create('button', { type: 'button', class: 'ops-primary-button', text: 'Повторить загрузку' });
    retry.addEventListener('click', start);
    mount(host, [header('Оперативный источник', 'Штаб недоступен', 'Не удалось загрузить operations.json.'),
      create('div', { class: 'ops-load-error', role: 'status', 'aria-live': 'assertive' }, [
        create('p', { text: 'Ошибка загрузки: ' + String(error && error.message || 'нет связи') }), retry
      ])]);
  }

  function start() {
    var contentRequest = fetch('/assets/data/operations.json', { credentials: 'same-origin', cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
    Promise.all([contentRequest, window.Store.init()]).then(function (result) {
      operations = result[0];
      window.UI.initPrint(); window.UI.initActions(); window.UI.initTools(); window.UI.initIdentity();
      window.addEventListener('hashchange', function () { openRoute(routeCurrent()); });
      openRoute(routeCurrent());
      document.body.classList.remove('is-booting');
    }).catch(function (error) {
      if (String(error && error.message) === 'unauthorized') return;
      document.body.classList.remove('is-booting'); showLoadError(error);
    });
  }

  start();
})();
