/* ============================================================
   Штаб. Рендер семи разделов из SEASON и PLAYBOOK,
   хеш-роутинг вкладок, прогресс, отсчёт.
   ============================================================ */

(function () {
  'use strict';

  var U = window.UI;
  var el = U.el;
  var S = window.SEASON;
  var PB = window.PLAYBOOK;

  /* ---------------- Прогресс ---------------- */

  function mapCheckIds(map) {
    return []
      .concat((map.nades || []).map(function (n) { return n.id; }))
      .concat((map.checklist || []).map(function (c) { return c.id; }));
  }

  function mapProgress(map) {
    var ids = mapCheckIds(map);
    if (!ids.length) return { done: 0, total: 0, pct: 0 };
    var done = window.Store.countChecked(ids);
    return { done: done, total: ids.length, pct: Math.round((done / ids.length) * 100) };
  }

  function allMapsProgress() {
    var done = 0, total = 0;
    PB.maps.forEach(function (m) {
      var p = mapProgress(m);
      done += p.done; total += p.total;
    });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function rulesProgress() {
    var ids = [];
    for (var i = 1; i <= 30; i++) ids.push('rule-' + i);
    var done = window.Store.countChecked(ids);
    return { done: done, total: 30, pct: Math.round((done / 30) * 100) };
  }

  function sessionsProgress() {
    var ids = [];
    S.sessions.forEach(function (s) { s.goals.forEach(function (g) { ids.push(g.id); }); });
    var done = window.Store.countChecked(ids);
    return { done: done, total: ids.length, pct: ids.length ? Math.round((done / ids.length) * 100) : 0 };
  }

  /* ---------------- Личный прогресс ----------------
     Личное — только гранаты, правила и лестница внедрения.
     Всё остальное командное и на «готовность игрока» не влияет. */

  function personalTotals() {
    var nades = 0;
    PB.maps.forEach(function (m) { nades += (m.nades || []).length; });
    var rules = window.RULES ? window.RULES.rules.length : 30;
    var ladder = window.RULES ? window.RULES.ladder.length : 10;
    return { nades: nades, rules: rules, ladder: ladder, all: nades + rules + ladder };
  }

  /* ---------------- Общие кусочки ---------------- */

  function sectionHead(eyebrow, title, right) {
    return el('div', { class: 'section__head' }, [
      el('div', {}, [
        eyebrow ? el('p', { class: 'eyebrow', text: eyebrow }) : null,
        el('h2', { text: title })
      ]),
      right || null
    ]);
  }

  function panelHeader(eyebrow, titleNode, asideNode, hero) {
    return el('header', { class: 'panel__header' + (hero ? ' panel__header--hero' : '') }, [
      el('div', { class: 'panel__title' }, [
        el('p', { class: 'eyebrow', text: eyebrow }),
        titleNode
      ]),
      asideNode ? el('div', { class: 'panel__aside' }, asideNode) : null
    ]);
  }

  function statBlock(value, label, plain) {
    return el('div', { class: 'stat' }, [
      el('strong', { class: 'stat__value' + (plain ? ' stat__value--plain' : ''), text: value }),
      el('span', { class: 'stat__label', html: label })
    ]);
  }

  function goLink(tab, text) {
    return el('button', {
      type: 'button',
      class: 'chip chip--accent',
      onclick: function () { activate(tab, true); }
    }, text + ' →');
  }

  /* ---------------- 01 Обзор ---------------- */

  function nextEvent() {
    var items = [];
    S.sessions.filter(function (s) { return !s.done; }).forEach(function (s) {
      items.push({ date: s.date, kind: 'тренировка', title: s.map, slot: s.slot });
    });
    S.matches.filter(function (m) { return m.ours; }).forEach(function (m) {
      items.push({ date: m.date, kind: 'матч', title: m.away, slot: m.no });
    });
    items.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    for (var i = 0; i < items.length; i++) {
      if (U.daysUntil(items[i].date) >= 0) return items[i];
    }
    return null;
  }

  function renderOverview() {
    var days = U.daysUntil(S.firstMatch.date);
    var next = nextEvent();
    var maps = allMapsProgress();
    var rules = rulesProgress();
    var upcomingSession = S.sessions.filter(function (s) { return !s.done && U.daysUntil(s.date) >= 0; })[0] || S.sessions[S.sessions.length - 1];
    var doneMaps = PB.maps.filter(function (m) { return m.order === 'done'; });
    var openMaps = PB.maps.filter(function (m) { return m.order !== 'done'; });
    var many = doneMaps.length > 1;

    var head = panelHeader(
      'Операция / первая игра',
      el('h1', { html: days > 0 ? (days + ' ' + U.plural(days, 'день', 'дня', 'дней') + '.<br><em>Собрать маппул.</em>') : 'День игры.<br><em>Работаем.</em>' }),
      el('div', { class: 'countdown' }, [
        el('span', { class: 'countdown__value', id: 'countdown-value', text: String(Math.max(0, days)) }),
        el('small', { class: 'countdown__label', id: 'countdown-label', text: days > 0 ? U.plural(days, 'день', 'дня', 'дней') + ' до матча' : 'день первой игры' })
      ]),
      true
    );
    // <em> внутри h1 красим акцентом
    head.querySelectorAll('h1 em').forEach(function (e) { e.style.cssText = 'color:var(--accent);font-style:normal'; });

    var runway = el('div', { class: 'runway', 'aria-label': 'Путь от сегодняшнего дня до первого матча' }, [
      el('div', { class: 'runway__end' }, [el('span', { class: 'label', text: 'Сегодня' }), el('b', { text: U.fmtShort(new Date().toISOString()) })]),
      el('div', { class: 'runway__track', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function () { return el('i'); })),
      el('div', { class: 'runway__end runway__end--finish' }, [el('span', { class: 'label', text: 'Матч №01' }), el('b', { text: U.fmtShort(S.firstMatch.date) })])
    ]);

    var dash = el('div', { class: 'grid grid--dash' }, [
      /* Ближайшая тренировка */
      el('article', { class: 'module module--feature col-7' }, [
        el('div', { class: 'card__head' }, [
          el('span', { text: next && next.kind === 'матч' ? 'Ближайшее событие' : 'Ближайшая тренировка' }),
          el('span', { class: 'chip chip--accent', text: next && next.kind === 'матч' ? 'матч' : 'обязательная' })
        ]),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value', text: next ? U.fmtShort(next.date).split('.')[0] : '—' }),
          el('span', { class: 'stat__label', html: next ? (monthName(next.date) + '<br>' + weekdayFull(next.date)) : 'всё позади' })
        ]),
        el('h2', { class: 'card__title', text: next ? (next.title + ' · ' + (next.slot || '')) : 'Сезон отыгран' }),
        el('p', { class: 'card__body', text: upcomingSession.focus }),
        el('div', { style: 'margin-top:var(--s5)' }, goLink('training', 'Открыть план тренировки'))
      ]),

      /* Первая игра */
      el('article', { class: 'module col-5' }, [
        el('div', { class: 'card__head' }, [
          el('span', { text: 'Первая игра' }),
          el('span', { class: 'chip chip--signal', text: U.fmtFull(S.firstMatch.date) })
        ]),
        el('p', { class: 'versus' }, [
          el('strong', { html: 'Ушибу<br>ногами' }),
          el('span', { text: 'VS' }),
          el('strong', { html: 'Поцелуй<br>всадницу' })
        ]),
        h2h(S.firstMatch.usRating, S.firstMatch.themRating),
        el('p', { class: 'label', style: 'margin-top:var(--s5)', text: 'Время матча не указано — уточнить у организатора.' })
      ]),

      /* Ресурс */
      el('article', { class: 'module col-5' }, [
        el('div', { class: 'card__head' }, [el('span', { text: 'Ресурс до старта' }), el('span', { text: U.fmtShort(S.meta.today) + ' → ' + U.fmtShort(S.firstMatch.date) })]),
        el('div', { class: 'stat-row', style: 'margin:var(--s5) 0' }, [
          statBlock(String(S.sessions.length), 'основных<br>сессий'),
          statBlock(String(S.optional.length), 'доп.<br>слота'),
          statBlock(String(openMaps.length), 'карт<br>в работе')
        ]),
        el('p', { class: 'card__body', style: 'font-size:var(--fs-sm)', text: S.meta.resourceNote })
      ]),

      /* Приоритет карт */
      el('article', { class: 'module col-7' }, [
        el('div', { class: 'card__head' }, [el('span', { text: 'Приоритет карт' }), el('span', { text: 'по голосованию' })]),
        el('div', { class: 'meter-list' }, openMaps.map(function (m) {
          return el('div', { class: 'meter meter--accent' }, [
            el('div', { class: 'meter__name' }, [
              el('span', { class: 'meter__rank', text: m.order }),
              el('span', { class: 'meter__title', text: m.name })
            ]),
            el('div', { class: 'meter__track' }, el('i', { class: 'meter__fill', style: '--value:' + m.votePct + '%' })),
            el('span', { class: 'meter__value', text: m.votePct + '%' })
          ]);
        })),
        doneMaps.length ? el('div', { class: 'note note--plain', style: 'margin-top:var(--s4)' }, [
          el('span', { class: 'note__title', text: doneMaps.map(function (m) { return m.name; }).join(' и ') + (many ? ' готовы' : ' готова') }),
          el('p', { class: 'note__body', text: (many ? 'Отработаны' : 'Отработана') + ' раньше остальных. Возвращаемся к ' + (many ? 'ним' : 'ней') + ' на закреплении 20.09 и генеральной 27.09.' })
        ]) : null
      ]),

      /* Прогресс — новый блок, которого не было в исходниках */
      el('article', { class: 'module col-12' }, [
        el('div', { class: 'card__head' }, [el('span', { text: 'Готовность' }), el('span', { text: 'считается по вашим отметкам' })]),
        el('div', { class: 'grid grid--3', style: 'margin-top:var(--s4)' }, [
          progressRing('Карты', maps, 'Гранаты и чеклисты в разделе «Тактики»', function () { activate('tactics', true); }),
          progressRing('Тренировки', sessionsProgress(), 'Цели сессий в разделе «Тренировки»', function () { activate('training', true); }),
          progressRingLink('Правила', rules, 'Кодекс командной игры', 'pravila.html')
        ])
      ]),

      teamProgressCard()
    ]);

    var roadmap = el('section', { class: 'section' }, [
      sectionHead('Маршрут', 'Девять точек до сервера', goLink('training', 'Все задачи')),
      el('ol', { class: 'timeline' }, S.sessions.map(function (s) {
        var past = U.daysUntil(s.date) < 0;
        var when = s.doneDate || s.date;
        var mod = s.final ? ' timeline__step--final' : (s.done ? ' timeline__step--done' : (past ? ' timeline__step--past' : ''));
        return el('li', { class: 'timeline__step' + mod }, [
          el('time', { class: 'timeline__date', datetime: when, text: U.fmtShort(when) }),
          el('span', { class: 'timeline__map', text: s.final ? 'Репетиция' : s.map }),
          el('small', { class: 'timeline__kind', text: s.done ? '✓ проведена' : (s.kind === 'генеральная' ? 'match day' : s.kind) })
        ]);
      }))
    ]);

    var principle = el('aside', { class: 'note note--signal', style: 'margin-top:var(--s5)' }, [
      el('span', { class: 'note__title', text: 'Главный принцип' }),
      el('p', { class: 'note__body', text: S.principle })
    ]);

    return [head, runway, dash, roadmap, principle];
  }

  /* Полоса «мы против них»: доля пропорциональна рейтингам */
  function h2h(usRating, themRating) {
    var a = parseFloat(usRating), b = parseFloat(themRating);
    var share = (a + b) > 0 ? Math.round((a / (a + b)) * 100) : 50;
    return el('div', { class: 'h2h' }, [
      el('span', { class: 'h2h__side h2h__side--us', text: 'avg ' + usRating }),
      el('div', { class: 'h2h__bar', role: 'img', 'aria-label': 'Соотношение среднего рейтинга: ' + usRating + ' против ' + themRating },
        el('i', { style: '--value:' + share + '%' })),
      el('span', { class: 'h2h__side h2h__side--them', text: 'avg ' + themRating })
    ]);
  }

  /* Сводка по всем игрокам. Рисует общий модуль — он же стоит
     на странице кодекса, поэтому счёт везде считается одинаково. */
  function teamProgressCard() {
    var totals = personalTotals();

    return window.TeamProgress.card({
      className: 'col-12',
      title: 'Готовность состава',
      hint: 'гранаты · правила · лестница',
      main: function (p) { return { done: p.nades + p.rules + p.ladder, total: totals.all }; },
      sub: function (p) {
        return 'гранаты ' + p.nades + '/' + totals.nades + ' · правила ' + p.rules + '/' + totals.rules;
      }
    });
  }

  function progressRing(title, p, hint, onclick) {
    var node = el('div', { class: 'ring' }, [
      el('div', { class: 'ring__dial', style: '--value:' + p.pct }, el('span', { class: 'ring__num', text: p.pct + '%' })),
      el('div', { class: 'ring__text' }, [
        el('h3', { text: title }),
        el('p', { class: 'label', style: 'margin-top:4px', text: p.done + ' из ' + p.total + ' отмечено' }),
        el('p', { class: 'card__body', style: 'font-size:var(--fs-sm);margin-top:6px', text: hint })
      ])
    ]);
    if (onclick) { node.style.cursor = 'pointer'; node.addEventListener('click', onclick); }
    return node;
  }

  function progressRingLink(title, p, hint, href) {
    return el('a', { class: 'ring', href: href, style: 'text-decoration:none;color:inherit' }, [
      el('div', { class: 'ring__dial', style: '--value:' + p.pct }, el('span', { class: 'ring__num', text: p.pct + '%' })),
      el('div', { class: 'ring__text' }, [
        el('h3', { text: title }),
        el('p', { class: 'label', style: 'margin-top:4px', text: p.done + ' из ' + p.total + ' освоено' }),
        el('p', { class: 'card__body', style: 'font-size:var(--fs-sm);margin-top:6px', text: hint + ' →' })
      ])
    ]);
  }

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  function monthName(iso) { var d = U.parseDate(iso); return d ? MONTHS[d.getMonth()] : ''; }
  function weekdayFull(iso) { var d = U.parseDate(iso); return d ? WD_FULL[d.getDay()] : ''; }

  /* ---------------- 02 Тренировки ---------------- */

  function sessionCard(s, optional) {
    var when = s.doneDate || s.date;
    return el('article', { class: 'session' + (s.final ? ' session--final' : '') + (optional ? ' session--optional' : '') + (s.done ? ' session--done' : '') }, [
      el('div', { class: 'session__index', text: s.done ? '✓' : s.n }),
      el('div', { class: 'session__when' }, [
        el('time', { class: 'session__date', datetime: when, text: U.fmtShort(when) }),
        el('span', { class: 'session__slot', text: s.done ? 'проведена' : s.slot })
      ]),
      el('div', { class: 'session__topic' }, [
        el('span', { class: 'label', text: optional ? 'Опционально' : (s.kind || 'Карта') }),
        el('h3', { class: 'session__map', text: optional ? s.title : s.map }),
        el('p', { class: 'session__focus', text: s.focus })
      ]),
      el('div', { class: 'session__goals check-list' }, s.goals.map(function (g) { return U.check(g.id, g.text); }))
    ]);
  }

  function renderTraining() {
    return [
      panelHeader('Календарь / до первой игры', el('h1', { text: 'Тренировки' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: S.sessions.length + ' + ' + S.optional.length }),
          el('span', { class: 'stat__label', text: 'основные + дополнительные' })
        ])),

      el('div', { class: 'slots' }, S.fixedSlots.map(function (f) {
        return el('div', { class: 'slot' }, [
          el('span', { class: 'slot__day', text: f.day }),
          el('strong', { class: 'slot__time', text: f.time }),
          el('small', { class: 'slot__note', text: f.note })
        ]);
      })),

      el('section', { class: 'section' }, [
        sectionHead('Стандарт', 'Протокол на 120 минут',
          el('a', { class: 'chip chip--ghost', href: '#/reglament', text: 'подробно в «Регламенте» →' })),
        el('ol', { class: 'protocol' }, S.protocol.map(function (p) {
          return el('li', { class: 'protocol__step' }, [
            el('strong', { class: 'protocol__min', text: p.min }),
            el('span', { class: 'protocol__what', text: p.block })
          ]);
        }))
      ]),

      el('section', { class: 'section' }, [
        sectionHead('Обязательные', 'Основной маршрут', el('span', { class: 'section__count', text: '0' + S.sessions.length + ' сессий' })),
        el('div', { class: 'session-list' }, S.sessions.map(function (s) { return sessionCard(s, false); }))
      ]),

      el('section', { class: 'section' }, [
        sectionHead('По возможности', 'Дополнительные окна', el('span', { class: 'section__count', text: '0' + S.optional.length + ' слота' })),
        el('p', { class: 'section__lead', text: 'Субботний дневной слот активируется только после подтверждения состава. Его можно перенести на любой другой свободный день. Дополнительные дни не заменяют обязательные.' }),
        el('div', { class: 'session-grid' }, S.optional.map(function (s) { return sessionCard(s, true); }))
      ]),

      el('section', { class: 'section' }, [
        sectionHead('Октябрь', 'Окно между матчами', el('span', { class: 'section__count', text: 'заполнить позже' })),
        el('p', { class: 'section__lead', text: 'После игр 30.09 и 01.10 и до матчей 21–22.10 есть пауза. Слоты ниже — под подготовку к «Рассаднику добра» и «Smoke mid everyday»: их игры можно скаутить, см. раздел «Соперники». Темы впиши по итогам первых матчей.' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Дата' }), el('th', { text: 'Тема — впиши' })])),
          el('tbody', {}, S.octoberSlots.map(function (o) {
            return el('tr', {}, [
              el('td', { class: 'when' }, [
                el('span', { text: o.label }),
                o.tag ? el('span', { class: 'chip chip--ghost', style: 'margin-left:var(--s2)', text: o.tag }) : null
              ]),
              el('td', {}, U.noteField(o.id, '', o.placeholder, 'input'))
            ]);
          }))
        ]))
      ])
    ];
  }

  /* ---------------- 03 Тактики ---------------- */

  function playbookCard(map) {
    var p = mapProgress(map);
    var body = [];

    body.push(el('p', { class: 'playbook__tagline', text: map.tagline }));

    if (map.veto) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title', text: 'Место в вето' }),
        el('p', { text: map.veto })
      ]));
    }

    if (map.tDefault) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title pb-section__title--t' }, [el('span', { class: 'side-badge side-badge--t', text: 'T' }), 'Дефолт за T']),
        el('p', { text: map.tDefault }),
        el('div', {}, (map.execs || []).map(function (e) {
          return el('div', { class: 'exec' }, [
            el('b', { class: 'exec__name', text: e.name }),
            el('p', { class: 'exec__text', text: e.text })
          ]);
        }))
      ]));
    }

    if (map.ctPositions && map.ctPositions.length) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title pb-section__title--ct' }, [el('span', { class: 'side-badge side-badge--ct', text: 'CT' }), 'Дефолт за CT']),
        el('ul', { class: 'poslist' }, map.ctPositions.map(function (pos) {
          return el('li', {}, [
            el('span', { class: 'poslist__spot', text: pos.spot }),
            el('span', { class: 'poslist__what', text: pos.what })
          ]);
        })),
        el('dl', { class: 'kv', style: 'margin-top:var(--s3)' }, [
          el('dt', { text: 'Ротации' }), el('dd', { text: map.rotations }),
          el('dt', { text: 'Потеряли зону' }), el('dd', { text: map.lostZone })
        ])
      ]));
    }

    if (map.nades && map.nades.length) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title', text: 'Гранаты — выучить всей командой' }),
        el('div', { class: 'nade-list' }, map.nades.map(function (n) {
          var input = el('input', { type: 'checkbox' });
          input.checked = window.Store.getCheck(n.id);
          input.addEventListener('change', function () {
            window.Store.setCheck(n.id, input.checked);
            U.fireChecksChanged();
          });
          return el('label', { class: 'nade' }, [
            input,
            el('span', { class: 'side-badge side-badge--' + n.side.toLowerCase(), text: n.side }),
            el('span', {}, [
              el('b', { class: 'nade__name', text: n.name }),
              el('span', { class: 'nade__desc', text: ' — ' + n.desc })
            ])
          ]);
        }))
      ]));
    }

    if (map.roles) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title', text: 'Роли на карте' }),
        el('p', { text: map.roles })
      ]));
    }

    if (map.checklist && map.checklist.length) {
      body.push(el('div', { class: 'pb-section' }, [
        el('h4', { class: 'pb-section__title', text: map.checklistTitle || 'Чеклист тренировки' }),
        el('div', { class: 'check-list' }, map.checklist.map(function (c) { return U.check(c.id, c.text); }))
      ]));
    }

    body.push(el('div', { class: 'pb-section' }, [
      U.noteField('notes-' + map.id, 'Заметки', 'Коллы, договорённости, что не получилось…')
    ]));

    var pctChip = el('span', { class: 'chip ' + (p.pct === 100 ? 'chip--ok' : p.pct > 0 ? 'chip--accent' : 'chip--ghost'), 'data-map-pct': map.id, text: p.total ? p.pct + '%' : '—' });

    return el('details', { class: 'playbook', 'data-map': map.id }, [
      el('summary', { class: 'playbook__summary' }, [
        el('span', { class: 'playbook__order' + (map.order === 'done' ? ' playbook__order--done' : ''), text: map.order === 'done' ? '✓' : map.order }),
        el('span', { class: 'playbook__id' }, [
          el('small', { class: 'playbook__kicker', text: map.priority }),
          el('strong', { class: 'playbook__name', text: map.name })
        ]),
        el('span', { class: 'playbook__meta' }, [
          el('span', { text: map.training }),
          pctChip
        ])
      ]),
      el('div', { class: 'playbook__body' }, body)
    ]);
  }

  function renderTactics() {
    return [
      panelHeader('Рабочая тетрадь', el('h1', { text: 'Тактики' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: String(PB.maps.length) }),
          el('span', { class: 'stat__label', text: 'карт в плейбуке' })
        ])),
      el('p', { class: 'lead', style: 'margin-bottom:var(--s5)', text: PB.vetoNote }),
      el('div', { class: 'note', style: 'margin-bottom:var(--s5)' }, [
        el('span', { class: 'note__title', text: 'Вето' }),
        el('p', { class: 'note__body', text: S.vetoDraft })
      ]),
      el('div', { class: 'grid', style: 'gap:var(--s2)' }, PB.maps.map(playbookCard))
    ];
  }

  /* ---------------- 04 Соперники ---------------- */

  function teamCard(t) {
    var kids = [
      el('header', { class: 'team__head' }, [
        el('div', {}, [
          el('span', { class: 'team__kicker', text: t.kicker }),
          el('h2', { class: 'team__name', text: t.name })
        ]),
        el('div', { class: 'team__ratings' }, [
          el('div', { class: 'team__rating' }, [el('b', { text: t.avg }), el('span', { text: 'AVG' })]),
          el('div', { class: 'team__rating' }, [el('b', { text: t.top5 }), el('span', { text: 'TOP-5' })])
        ])
      ]),
      el('ol', { class: 'team__roster' }, t.roster.map(function (p, i) {
        return el('li', {}, [el('span', { class: 'team__roster-n', text: U.pad(i + 1) }), el('b', { text: p })]);
      }))
    ];

    var notes = [el('p', { class: 'card__body', style: 'font-size:var(--fs-sm)', text: t.rating })];

    if (t.danger || t.watch) {
      notes.push(el('div', { class: 'team__intel' }, [
        t.danger ? el('div', { class: 'intel' }, [el('span', { class: 'intel__k', text: 'Чем опасны' }), el('span', { class: 'intel__v', text: t.danger })]) : null,
        t.watch ? el('div', { class: 'intel intel--watch' }, [el('span', { class: 'intel__k', text: 'Что смотреть' }), el('span', { class: 'intel__v', text: t.watch })]) : null
      ]));
      notes.push(U.noteField('veto-' + t.id, 'Вето-план', 'Что баним, что пикаем, чего ждём от них…'));
      notes.push(U.noteField('scout-' + t.id, 'Заметки по скаутингу', 'Кто играл, какие карты пикали, привычки…'));
    }

    kids.push(el('div', { class: 'team__notes' }, notes));
    if (!t.us && /^(pocelui|takahuli|rassadnik|smoke)$/.test(t.id)) {
      var planIds = { pocelui: 'm01', takahuli: 'm02', rassadnik: 'm09', smoke: 'm10' };
      kids.push(el('a', {
        class: 'stats-brief-link',
        href: '#/statistika/sopernik/' + t.id,
        text: 'Статистика / открыть профиль ' + t.name
      }));
      kids.push(el('a', {
        class: 'stats-brief-link',
        href: '#/statistika/match/' + planIds[t.id],
        text: 'Полный план против ' + t.name
      }));
    }
    return el('article', { class: 'team' + (t.us ? ' team--us' : '') }, kids);
  }

  function renderOpponents() {
    return [
      panelHeader('Участники лиги', el('h1', { text: 'Соперники' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: '5 × 6' }),
          el('span', { class: 'stat__label', text: 'команд × игроков' })
        ])),
      el('p', { class: 'lead', style: 'margin-bottom:var(--s5)', text: 'По порядку наших матчей. Рейтинги — avg и top-5 из таблицы лиги. До 30.09 чужих игр нет, поэтому по первым двум соперникам скаутинг — только профили; по двум последним успеем посмотреть их живые матчи.' }),
      el('div', { class: 'grid', style: 'gap:var(--s3)' }, S.teams.map(teamCard))
    ];
  }

  /* ---------------- 05 Матчи ---------------- */

  function renderMatches() {
    var ours = S.matches.filter(function (m) { return m.ours; });

    return [
      panelHeader('Лига / итоговая перестановка', el('h1', { text: 'Матчи' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: String(S.matches.length) }),
          el('span', { class: 'stat__label', text: 'игр в расписании' })
        ])),

      el('div', { class: 'route' }, [
        el('p', { class: 'route__label', text: 'Наш маршрут' }),
        el('ol', { class: 'route__items' }, ours.map(function (m) {
          return el('li', { class: 'route__item' }, [
            el('time', { datetime: m.date, text: U.fmtShort(m.date) }),
            el('span', { text: m.away }),
            el('span', { class: 'chip chip--ok', text: 'готов' }),
            el('a', { class: 'stats-brief-link', href: '#/statistika/match/' + m.id, text: 'Полный план ' + m.away })
          ]);
        }))
      ]),

      el('aside', { class: 'note note--signal', style: 'margin:var(--s5) 0' }, [
        el('span', { class: 'note__title', text: '30.09 и 01.10 подряд' }),
        el('p', { class: 'note__body', text: 'Между этими матчами тренировки нет. Вето-планы и настрой под обоих соперников готовим заранее — на генеральной 27.09.' })
      ]),

      el('section', { class: 'section' }, [
        sectionHead('Расписание', 'Все игры лиги', el('span', { class: 'section__count', text: 'наши подсвечены' })),
        el('p', { class: 'section__lead', text: 'После цепочки перестановок. Чужие матчи — материал для скаутинга перед 21–22.10.' }),
        el('div', { class: 'match-list' }, S.matches.map(function (m) {
          return el('article', { class: 'match' + (m.ours ? ' match--ours' : '') }, [
            el('time', { class: 'match__when', datetime: m.date }, [
              el('span', { text: m.wd + ' ' + U.fmtFull(m.date) }),
              m.no ? el('small', { class: 'match__no', text: m.no }) : null
            ]),
            el('div', { class: 'match__team' + (m.ours ? ' match__team--home' : '') }, [
              el('strong', { text: m.home }),
              el('span', { class: 'match__rating', text: m.ours ? 'НАША' : 'avg ' + m.homeRating })
            ]),
            el('b', { class: 'match__vs', text: '—' }),
            el('div', { class: 'match__team match__team--right' }, [
              el('strong', { text: m.away }),
              el('span', { class: 'match__rating', text: 'avg ' + m.awayRating })
            ]),
            m.tag ? el('em', { class: 'chip chip--signal match__tag', text: m.tag })
              : (m.why && m.why !== '—' ? el('em', { class: 'chip chip--ghost match__tag', text: m.why }) : null),
            m.ours ? el('div', { class: 'stats-match-brief' }, [
              el('span', { class: 'chip chip--ok', text: 'план готов' }),
              el('a', { class: 'stats-brief-link', href: '#/statistika/match/' + m.id, text: 'Полный план ' + m.away })
            ]) : null
          ]);
        }))
      ]),

      el('section', { class: 'section' }, [
        sectionHead('Счёт', 'Результаты — вписываем после игр'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Дата' }), el('th', { text: 'Соперник' }), el('th', { text: 'Счёт' }), el('th', { text: 'Сыграно' }), el('th', { text: 'Разбор' })])),
          el('tbody', {}, ours.map(function (m) {
            return el('tr', { class: 'is-ours' }, [
              el('td', { class: 'when', text: m.wd + ' ' + U.fmtShort(m.date) }),
              el('td', {}, el('b', { text: m.away })),
              el('td', { class: 'cell-score' }, U.noteField('score-' + m.id, '', '—:—', 'input')),
              el('td', {}, U.check('played-' + m.id, '')),
              el('td', {}, el('a', { class: 'stats-brief-link', href: '#/statistika/match/' + m.id, text: 'Полный план ' + m.away }))
            ]);
          }))
        ]))
      ])
    ];
  }

  /* ---------------- 06 Регламент ---------------- */

  function renderRegulations() {
    return [
      panelHeader('Как это работает', el('h1', { text: 'Регламент' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: '120′' }),
          el('span', { class: 'stat__label', text: 'стандартная сессия' })
        ])),
      el('p', { class: 'lead', style: 'margin-bottom:var(--s5)', text: 'Шаблон двухчасовой тренировки, чтобы не тратить первые 20 минут на «а что сегодня делаем».' }),

      el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Мин' }), el('th', { text: 'Блок' }), el('th', { text: 'Что делаем' })])),
        el('tbody', {}, S.protocol.map(function (p) {
          return el('tr', {}, [
            el('td', { class: 'when', text: p.range }),
            el('td', {}, el('b', { text: p.block })),
            el('td', { class: 'dim', text: p.what })
          ]);
        }))
      ])),

      el('section', { class: 'section' }, [
        el('div', { class: 'grid grid--2' }, [
          el('div', { class: 'card' }, [
            el('h3', { style: 'margin-bottom:var(--s3)', text: 'Правила' }),
            el('ul', { class: 'essay__body' }, S.teamRules.map(function (r) { return el('li', { html: r }); }))
          ]),
          el('div', { class: 'card' }, [
            el('h3', { style: 'margin-bottom:var(--s3)', text: 'Чеклист матч-дня' }),
            el('div', { class: 'check-list' }, S.matchday.map(function (c) { return U.check(c.id, c.text); }))
          ])
        ])
      ]),

      el('section', { class: 'section' }, [
        sectionHead('Кто есть кто', 'Роли — закрепить за людьми'),
        el('p', { class: 'section__lead', text: 'Состав: ' + S.teams[0].roster.join(', ') + '. Впиши, кто за что отвечает — сохранится в браузере.' }),
        el('div', { class: 'card' }, el('div', { class: 'grid grid--2', style: 'gap:var(--s4)' }, S.roles.map(function (r) {
          return U.noteField(r.id, r.label, 'ник', 'input');
        })))
      ])
    ];
  }

  /* ---------------- 07 Голосование ---------------- */

  function renderPolls() {
    return [
      panelHeader('Исходные решения', el('h1', { text: 'Голосование' }),
        el('div', { class: 'stat' }, [
          el('strong', { class: 'stat__value stat__value--sm', text: String(S.polls.maps.voters) }),
          el('span', { class: 'stat__label', text: 'участников опроса' })
        ])),
      el('p', { class: 'lead', style: 'margin-bottom:var(--s5)', text: 'Архив: отсюда взялся порядок карт и слоты недели.' }),

      el('div', { class: 'grid grid--2', style: 'align-items:start;gap:var(--s3)' }, [
        el('section', { class: 'card' }, [
          sectionHead('Топ-3 карты', 'Приоритет подготовки', el('span', { class: 'section__count', text: S.polls.maps.limit })),
          el('div', { class: 'meter-list' }, S.polls.maps.rows.map(function (r) {
            return el('div', { class: 'meter meter--accent' }, [
              el('div', { class: 'meter__name' }, [
                el('span', { class: 'meter__rank', text: r.rank }),
                el('span', {}, [
                  el('strong', { class: 'meter__title', text: r.map }),
                  r.done ? el('span', { class: 'chip chip--ok', style: 'margin-left:var(--s2)', text: 'готова' }) : null,
                  el('br'),
                  el('small', { class: 'label', text: r.votes + ' ' + U.plural(r.votes, 'голос', 'голоса', 'голосов') })
                ])
              ]),
              el('div', { class: 'meter__track' }, el('i', { class: 'meter__fill', style: '--value:' + r.pct + '%' })),
              el('span', { class: 'meter__value', text: r.pct + '%' })
            ]);
          })),
          el('div', { class: 'decision' }, [
            el('span', { class: 'decision__k', text: 'Решение' }),
            el('p', { class: 'decision__v', text: S.polls.maps.decision })
          ])
        ]),

        el('section', { class: 'card' }, [
          sectionHead('Доступность', 'Когда собираемся'),
          el('div', {}, S.polls.days.map(function (d) {
            return el('div', { class: 'daypoll' }, [
              el('header', { class: 'daypoll__head' }, [
                el('strong', { text: d.day }),
                d.selected ? el('span', { class: 'chip chip--accent', text: d.answers }) : el('span', { class: 'label', text: d.answers })
              ]),
              el('div', {}, d.rows.map(function (r) {
                return el('div', { class: 'daypoll__row' + (r.win ? ' daypoll__row--win' : '') }, [
                  el('span', { text: r.t }),
                  el('div', { class: 'bar' }, el('i', { style: '--value:' + r.pct + '%' })),
                  el('em', { text: r.pct + '%' })
                ]);
              }))
            ]);
          })),
          el('div', { class: 'decision' }, [
            el('span', { class: 'decision__k', text: 'Решение' }),
            el('p', { class: 'decision__v', text: S.polls.daysDecision })
          ])
        ])
      ])
    ];
  }

  /* ---------------- Роутинг ---------------- */

  var TABS = [
    { id: 'overview', slug: 'obzor', render: renderOverview },
    { id: 'training', slug: 'trenirovki', render: renderTraining },
    { id: 'tactics', slug: 'taktiki', render: renderTactics },
    { id: 'opponents', slug: 'soperniki', render: renderOpponents },
    { id: 'matches', slug: 'matchi', render: renderMatches },
    { id: 'regulations', slug: 'reglament', render: renderRegulations },
    { id: 'polls', slug: 'golosovanie', render: renderPolls },
    { id: 'statistics', slug: 'statistika', render: null }
  ];

  var rendered = {};

  function bySlug(slug) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].slug === slug) return TABS[i];
    return null;
  }
  function byId(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return null;
  }

  var statsPromise = null;

  function loadStatsScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(script);
    });
  }

  function ensureStats() {
    if (window.Stats && window.StatsCore) return Promise.resolve(window.Stats);
    if (!statsPromise) {
      statsPromise = loadStatsScript('/assets/js/stats-core.js')
        .then(function () { return loadStatsScript('/assets/js/stats.js'); })
        .then(function () {
          if (!window.Stats) throw new Error('Модуль статистики не запустился');
          return window.Stats;
        })
        .catch(function (error) { statsPromise = null; throw error; });
    }
    return statsPromise;
  }

  function renderStatsScriptError(error) {
    var retry = el('button', { type: 'button', class: 'stats-retry', text: 'Повторить загрузку' });
    retry.addEventListener('click', function () {
      statsPromise = null;
      activateRoute(routeFromHash(), { pushHash: false, moveFocus: false });
    });
    U.mount('#statistics', el('div', { class: 'stats-state stats-state--error' }, [
      el('h1', { tabindex: '-1', text: 'Статистика недоступна' }),
      el('p', { text: String(error && error.message || 'Ошибка загрузки') }), retry,
      el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', text: 'Ошибка: статистика недоступна' })
    ]));
  }

  function activateRoute(route, options) {
    options = options || {};
    var tab = byId(route.tab) || TABS[0];

    if (tab.render && !rendered[tab.id]) {
      U.mount('#' + tab.id, tab.render());
      rendered[tab.id] = true;
    }

    TABS.forEach(function (t) {
      var panel = document.getElementById(t.id);
      var btn = document.querySelector('[data-tab="' + t.id + '"]');
      if (panel) panel.hidden = t.id !== tab.id;
      if (btn) {
        btn.setAttribute('aria-selected', String(t.id === tab.id));
        btn.tabIndex = t.id === tab.id ? 0 : -1;
      }
    });

    if (options.moveFocus) {
      var b = document.querySelector('[data-tab="' + tab.id + '"]');
      if (b) b.focus();
    }
    if (options.pushHash && window.location.hash !== route.path) {
      window.location.hash = route.path;
      return;
    }
    var btnEl = document.querySelector('[data-tab="' + tab.id + '"]');
    var label = 'Штаб';
    if (btnEl) {
      // textContent захватил бы и номер из .nav__num — берём только подпись
      var clone = btnEl.cloneNode(true);
      var num = clone.querySelector('.nav__num');
      if (num) num.remove();
      label = clone.textContent.trim();
    }
    document.title = label + ' — Штаб CS2 «Ушибу ногами»';
    updateProgressChips();

    if (tab.id === 'statistics') {
      ensureStats().then(function () {
        var normalized = window.StatsCore.parseHash(route.rawHash || route.path);
        window.Stats.open(normalized, { moveFocus: false });
      }).catch(renderStatsScriptError);
    }
  }

  function routeFromHash() {
    var hash = window.location.hash || '';
    var m = /^#\/([a-z-]+)(?:\/|$)/.exec(hash);
    if (m && m[1] === 'statistika') return { tab: 'statistics', path: hash || '#/statistika', rawHash: hash };
    var tab = m ? bySlug(m[1]) : null;
    tab = tab || TABS[0];
    return { tab: tab.id, path: '#/' + tab.slug };
  }

  function activate(id, pushHash, moveFocus) {
    var tab = byId(id) || TABS[0];
    activateRoute({ tab: tab.id, path: '#/' + tab.slug }, { pushHash: !!pushHash, moveFocus: !!moveFocus });
  }

  function initTabs() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    buttons.forEach(function (btn, index) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var tab = byId(btn.getAttribute('data-tab')) || TABS[0];
        activateRoute({ tab: tab.id, path: '#/' + tab.slug }, { pushHash: true, moveFocus: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      btn.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = buttons.length - 1;
        if (next === null) return;
        e.preventDefault();
        var nextTab = byId(buttons[next].getAttribute('data-tab')) || TABS[0];
        activateRoute({ tab: nextTab.id, path: '#/' + nextTab.slug }, { pushHash: true, moveFocus: true });
      });
    });

    window.addEventListener('hashchange', function () { activateRoute(routeFromHash(), { pushHash: false, moveFocus: false }); });
    activateRoute(routeFromHash(), { pushHash: false, moveFocus: false });
  }

  /* Проценты готовности карт живут в сводке и в шапках плейбуков */
  function updateProgressChips() {
    document.querySelectorAll('[data-map-pct]').forEach(function (node) {
      var id = node.getAttribute('data-map-pct');
      var map = PB.maps.filter(function (m) { return m.id === id; })[0];
      if (!map) return;
      var p = mapProgress(map);
      node.textContent = p.total ? p.pct + '%' : '—';
      node.className = 'chip ' + (p.pct === 100 ? 'chip--ok' : p.pct > 0 ? 'chip--accent' : 'chip--ghost');
    });

    var maps = allMapsProgress();
    var sess = sessionsProgress();
    var rings = document.querySelectorAll('#overview .ring');
    if (rings.length >= 2) {
      setRing(rings[0], maps, 'отмечено');
      setRing(rings[1], sess, 'отмечено');
    }
  }

  function setRing(node, p, word) {
    var dial = node.querySelector('.ring__dial');
    var num = node.querySelector('.ring__num');
    var label = node.querySelector('.label');
    if (dial) dial.style.setProperty('--value', p.pct);
    if (num) num.textContent = p.pct + '%';
    if (label) label.textContent = p.done + ' из ' + p.total + ' ' + word;
  }

  /* ---------------- Отсчёт ---------------- */

  function tickCountdown() {
    var days = U.daysUntil(S.firstMatch.date);
    var value = document.getElementById('countdown-value');
    var label = document.getElementById('countdown-label');
    if (!value || !label) return;
    value.textContent = String(Math.max(0, days));
    label.textContent = days > 0 ? U.plural(days, 'день', 'дня', 'дней') + ' до матча'
      : days === 0 ? 'день первой игры' : 'первая игра позади';
  }

  /* ---------------- Старт ---------------- */

  // Сначала забираем состояние с сервера — без него рендерить нечего.
  window.Store.init()
    .then(function () {
      initTabs();
      U.initPrint();
      U.initActions();
      U.initTools();
      U.initIdentity();
      tickCountdown();
      setInterval(tickCountdown, 60000);
      U.onChecksChanged(updateProgressChips);
      document.body.classList.remove('is-booting');
    })
    .catch(function (err) {
      if (String(err && err.message) === 'unauthorized') return; // уже уходим на форму входа
      document.body.classList.remove('is-booting');
      U.mount('#overview', U.el('div', { class: 'note note--signal' }, [
        U.el('span', { class: 'note__title', text: 'Не загрузилось' }),
        U.el('p', { class: 'note__body', text: 'Не удалось получить данные с сервера. Обновите страницу — если не помогает, напишите капитану.' })
      ]));
    });

  window.__hq = { activate: activate, activateRoute: activateRoute, routeFromHash: routeFromHash, mapProgress: mapProgress, allMapsProgress: allMapsProgress };
})();
