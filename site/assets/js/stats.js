/* Lazy, authenticated Whoajor dashboard. Remote values are always rendered as text. */
(function () {
  'use strict';

  var U = window.UI;
  var Core = window.StatsCore;
  var el = U.el;
  var activeController = null;
  var requestToken = 0;
  var currentRoute = null;
  var focusNext = false;
  var knownTeams = Object.create(null);
  var knownMatches = Object.create(null);
  var client = Core.createClient(function (url, options) {
    var next = Object.assign({}, options || {});
    if (activeController) next.signal = activeController.signal;
    return window.fetch(url, next);
  });

  var TASKS = [
    { id: 'brief-read', label: 'Прочитать бриф и ограничения' },
    { id: 'veto-confirmed', label: 'Подтвердить pick / ban / backup' },
    { id: 'anti-threat', label: 'Назначить ответ на главную угрозу' },
    { id: 'matchday', label: 'Закрыть чеклист матч-дня' }
  ];

  /* Русские расшифровки метрик — тултипы на заголовках таблиц. */
  var METRIC_HELP = {
    rating: 'Rating 2 — общий вклад за раунд по формуле HLTV (килы, смерти, урон, KAST). 1.00 — средний уровень; выше — лучше.',
    adr: 'ADR — средний урон за раунд. 80+ — очень хорошо.',
    kd: 'K/D — отношение убийств к смертям.',
    kast: 'KAST — доля раундов, где игрок сделал кил, ассист, выжил или был разменян. Показывает стабильность вклада.',
    roundWinRate: 'WR — доля выигранных раундов за окно наблюдения.',
    tRoundWinRate: 'T-WR — доля выигранных раундов в атаке (сторона T).',
    ctRoundWinRate: 'CT-WR — доля выигранных раундов в обороне (сторона CT).',
    openingDiffPer100: 'Entry — разница первых фрагов на 100 раундов: открыл минус был открыт. Плюс — первые дуэли чаще за нами.',
    hsKillPct: 'HS% — доля убийств в голову за всё время. Показатель точности аима.',
    preaimDeg: 'Преаим — на сколько градусов прицел был не на враге в момент контакта. Меньше — лучше держит прицел.',
    ttdMs: 'TTD — время от появления врага до первого урона, в миллисекундах. Меньше — быстрее реакция.',
    utilityDamagePerRound: 'Util — урон гранатами за раунд. Показатель работы с раскидками.',
    flashAssistsPer100: 'Flash — флеш-ассисты на 100 раундов: килы союзников по ослеплённым этим игроком.',
    tradeRate: 'Размены — доля смертей, за которые команда сразу отомстила. Показатель игры парами.',
    clutchWinRate: 'Клатчи — доля выигранных ситуаций один против нескольких.',
    retakeWinRate: 'Ретейки — доля отбитых точек после чужой закладки бомбы.',
    postplantWinRate: 'Постплент — доля выигранных раундов после нашей закладки бомбы.',
    pistolWinRate: 'Пистолетки — доля выигранных пистолетных раундов.',
    forceWinRate: 'Форсы — доля выигранных раундов с неполным закупом.',
    ecoWinRate: 'Эко — доля выигранных раундов почти без закупа.',
    fullWinRate: 'Full-buy — доля выигранных раундов с полным закупом.',
    rounds: 'Раундов в выборке: чем больше, тем надёжнее цифры. Меньше 200 — читать осторожно.',
    edge: 'Edge — разница скорректированного Rating 2 между нами и ими на карте. Плюс — мы сильнее; |edge| < 0.03 — в пределах шума.',
    decision: 'Вердикт движка veto-1: ПИК — играем, БАН — убираем, Б1/Б2 — запасные пики.',
    sideMatchup: 'Наши раунды в атаке против их раундов в обороне на этой карте: у кого сторона сильнее.',
    comfort: 'Голосование команды и практика. В расчёт вердикта не входит — только контекст.',
    confidence: 'Уверенность по размеру выборки: 200+ раундов у обеих команд — средняя, 500+ — высокая.'
  };

  function helpTh(label, helpKey, extra) {
    var attrs = { text: label };
    var help = METRIC_HELP[helpKey];
    if (help) { attrs.title = help; attrs.class = 'stats-help'; }
    if (extra && extra.class) attrs.class = (attrs.class ? attrs.class + ' ' : '') + extra.class;
    return el('th', attrs);
  }

  var METRICS = {
    rating: 'Rating 2', adr: 'ADR', kd: 'K/D', kast: 'KAST', roundWinRate: 'Победы в раундах',
    openingDiffPer100: 'Разница открытий / 100', utilityDamagePerRound: 'Utility damage / раунд',
    flashAssistsPer100: 'Флеш-ассисты / 100', tradeRate: 'Размены', retakeWinRate: 'Ретейки',
    postplantWinRate: 'Постплент', clutchWinRate: 'Клатчи', forceWinRate: 'Форсы',
    fullWinRate: 'Full-buy', pistolWinRate: 'Пистолетные', tRoundWinRate: 'T-раунды', ctRoundWinRate: 'CT-раунды'
  };

  function text(value, empty) {
    return value === null || value === undefined || value === '' ? (empty || 'Нет данных') : String(value);
  }

  function number(value, digits) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits == null ? 2 : digits) : 'Нет данных';
  }

  function percent(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) + '%' : 'Нет данных';
  }

  function mapName(value) {
    if (value === 'de_dust2' || value === 'dust2') return 'Dust 2';
    return text(value).replace(/^de_/, '').replace(/^cs_/, '').replace(/_/g, ' ').replace(/\b\w/g, function (char) { return char.toUpperCase(); });
  }

  function metricName(value) { return METRICS[value] || text(value); }

  function routeLink(href, label, className) {
    return el('a', { href: href, class: className || 'stats-link', text: label });
  }

  function live(message) {
    return el('p', { class: 'stats-live sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', text: message });
  }

  function statsNav() {
    return el('nav', { class: 'stats-nav', 'aria-label': 'Разделы статистики' }, [
      routeLink('#/statistika', 'Сводка'), routeLink('#/statistika/maps', 'Карты'),
      routeLink('#/statistika/weapons', 'Оружие'), routeLink('#/statistika/trends', 'Тренды'),
      routeLink('#/statistika/quality', 'Качество')
    ]);
  }

  function shell(title, eyebrow, children, message) {
    var heading = el('h1', { tabindex: '-1', text: title });
    var node = el('div', { class: 'stats-view' }, [
      el('header', { class: 'panel__header stats-header' }, [
        el('div', { class: 'panel__title' }, [el('p', { class: 'eyebrow', text: eyebrow || 'Whoajor / проверенный снимок' }), heading]),
        statsNav()
      ]),
      children,
      live(message || 'Готово')
    ]);
    return { node: node, heading: heading };
  }

  function mountView(view, shouldFocus) {
    U.mount('#statistics', view.node);
    if (shouldFocus && view.heading) view.heading.focus();
  }

  function loading(route) {
    var names = { overview: 'Статистика', team: 'Профиль соперника', player: 'Профиль игрока', match: 'План матча', maps: 'Карты', weapons: 'Оружие', trends: 'Тренды', quality: 'Качество данных' };
    return shell(names[route.view] || 'Статистика', 'Загрузка проверенных данных',
      el('div', { class: 'stats-state', 'aria-busy': 'true' }, [el('span', { class: 'stats-loader', 'aria-hidden': 'true' }), el('p', { text: 'Проверяем root и SHA-256…' })]),
      'Загрузка статистики');
  }

  function errorView(error) {
    var retry = el('button', { type: 'button', class: 'stats-retry', text: 'Повторить загрузку' });
    retry.addEventListener('click', retryOpen);
    return shell('Статистика недоступна', 'Локальная ошибка данных',
      el('div', { class: 'stats-state stats-state--error' }, [
        el('p', { text: 'Планы скрыты: проверка источника не пройдена.' }),
        el('p', { class: 'stats-mono', text: text(error && error.message, 'Неизвестная ошибка') }), retry
      ]), 'Ошибка статистики. Остальные разделы штаба доступны.');
  }

  function emptyView(reason) {
    return shell('Нет данных', 'Маршрут не найден', el('div', { class: 'stats-state' }, [
      el('p', { text: text(reason, 'Нет данных для этого адреса.') }), routeLink('#/statistika', 'Вернуться к сводке')
    ]), 'Нет данных');
  }

  function findBy(rows, key, value) {
    for (var i = 0; i < rows.length; i++) if (String(rows[i][key]) === String(value)) return rows[i];
    return null;
  }

  function rosterName(rosters, teamId) {
    var roster = findBy(rosters, 'teamId', teamId);
    return roster ? roster.name : teamId;
  }

  function playerName(rosters, steamid) {
    for (var i = 0; i < rosters.length; i++) {
      for (var j = 0; j < rosters[i].players.length; j++) {
        if (rosters[i].players[j].steamid === String(steamid)) return rosters[i].players[j].displayName;
      }
    }
    return String(steamid);
  }

  function confidence(value) {
    var labels = { high: 'высокая', medium: 'средняя', low: 'низкая', none: 'нет данных' };
    return labels[value] || 'не указана';
  }

  function chip(label, type) { return el('span', { class: 'chip chip--' + (type || 'ghost'), text: label }); }

  function card(title, body, className) {
    return el('article', { class: 'card stats-card' + (className ? ' ' + className : '') }, [el('h2', { text: title }), body]);
  }

  function signedNum(value, digits) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'нет данных';
    return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(digits == null ? 2 : digits);
  }

  function pct1(value) {
    return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : 'нет данных';
  }

  function confBadge(level) {
    return el('span', { class: 'stats-conf stats-conf--' + (level || 'none'), text: confidence(level) });
  }

  function proofDetails(ids) {
    var list = Array.isArray(ids) ? ids : [ids];
    return el('details', { class: 'stats-proof', 'data-evidence': 'true' }, [
      el('summary', { text: 'evidence' }),
      el('code', { text: list.join(' · ') })
    ]);
  }

  /* Диверджент-бар edge: центр — ноль, серая зона — шум |edge| < 0.03. Число всегда рядом. */
  function edgeBar(edge) {
    var band = Core.edgeBand(edge);
    if (band === 'no-data') {
      return el('span', { class: 'stats-edgebar-wrap stats-edgebar-wrap--nodata', text: 'нет данных' });
    }
    var magnitude = Math.min(Math.abs(edge), 0.25) / 0.25;
    var bar = el('span', { class: 'stats-edgebar stats-edgebar--' + band, role: 'img', 'aria-label': 'Edge ' + signedNum(edge, 3) },
      el('i', { style: '--mag:' + (magnitude * 100) + '%' }));
    return el('span', { class: 'stats-edgebar-wrap' }, [bar, el('b', { class: 'stats-edgebar-num', text: signedNum(edge, 2) }), band === 'noise' ? el('small', { class: 'stats-edgebar-noise-note', text: '≈ шум' }) : null]);
  }

  var RATE_METRICS = { roundWinRate: 1, kast: 1, tradeRate: 1, retakeWinRate: 1, postplantWinRate: 1, clutchWinRate: 1, ecoWinRate: 1, forceWinRate: 1, fullWinRate: 1, pistolWinRate: 1, tRoundWinRate: 1, ctRoundWinRate: 1 };

  function metricValue(metric, value) {
    return RATE_METRICS[metric] ? pct1(value) : number(value, 2);
  }

  function evidenceList(items, rosters) {
    return el('ul', { class: 'stats-evidence' }, (items || []).map(function (item) {
      var who = item.steamid ? playerName(rosters, item.steamid) + ' · ' : '';
      var sample = item.sampleRounds || item.samplePlayerRounds;
      var meta = sample ? 'n=' + sample + ' раундов за окно' : '';
      if (typeof item.delta === 'number') meta += (meta ? ' · ' : '') + 'отрыв от медианы лиги ' + signedNum(item.delta, 2);
      return el('li', { class: 'stats-fact' }, [
        el('span', { text: who + metricName(item.metric) + ' ' + metricValue(item.metric, item.value) }),
        meta ? el('small', { class: 'stats-fact__meta', text: meta }) : null,
        proofDetails(item.id)
      ]);
    }));
  }

  var THREAT_ROLES = { rating: 'главный фраггер', openingDiffPer100: 'открывает раунды', utilityDamagePerRound: 'гранатчик' };
  var THREAT_ROLE_BY_KIND = { rating: 'rating', opening: 'openingDiffPer100', utility: 'utilityDamagePerRound' };

  function threatCards(threats, rosters, tasks) {
    return el('div', { class: 'stats-threat-grid' }, (threats || []).map(function (item) {
      var kind = String(item.id || '').split(':').pop();
      var metric = item.metric || THREAT_ROLE_BY_KIND[kind] || 'rating';
      var counters = (tasks || []).filter(function (task) {
        return task.task && task.task.toLowerCase().indexOf(playerName(rosters, item.steamid).toLowerCase()) !== -1;
      });
      return el('article', { class: 'card stats-threat' }, [
        el('p', { class: 'stats-threat__role', text: THREAT_ROLES[metric] || metricName(metric) }),
        routeLink(Core.href('player', item.steamid), playerName(rosters, item.steamid), 'stats-threat__name'),
        el('p', { class: 'stats-threat__stat', text: metricName(metric) + ' ' + metricValue(metric, item.value) + ' за ' + (item.sampleRounds || '—') + ' раундов' }),
        counters.length ? el('p', { class: 'stats-threat__answer', text: 'Ответ: ' + counters[0].task + ' (' + counters[0].draftName + ')' }) : null,
        proofDetails(item.id)
      ]);
    }));
  }

  function validatePlans(recommendations, evidence, manifest) {
    var ids = new Set(evidence.map(function (row) { return row.id; }));
    return recommendations.map(function (rec) { return Core.validateRecommendation(rec, manifest, ids); });
  }

  function readiness(matchId) {
    var ids = TASKS.map(function (task) { return Core.scoutKey(matchId, task.id); });
    return { done: window.Store.countChecked(ids), total: ids.length };
  }

  function fmtShortDate(date) {
    return date.slice(5).split('-').reverse().join('.');
  }

  function trainingSignal(data) {
    var us = findBy(data.teamMetrics || [], 'teamId', 'us');
    var m = us && us.recent && us.recent.metrics;
    var gap = m && m.tRoundWinRate != null && m.ctRoundWinRate != null ? m.ctRoundWinRate - m.tRoundWinRate : null;
    var weakest = null;
    (data.teamMapStats || []).forEach(function (row) {
      if (row.teamId !== 'us' || !row.inPool) return;
      var t = row.recent.metrics.tRoundWinRate;
      if (t != null && (!weakest || t < weakest.value)) weakest = { map: row.map, value: t };
    });
    return { gap: gap, weakest: weakest };
  }

  /* Лента ближайшего матча: одна широкая полоса вместо узкой карточки с гигантским шрифтом. */
  function nextMatchStrip(nearest, rosters, advice, completedFallback) {
    if (!nearest) return null;
    var ready = readiness(nearest.matchId);
    var pickRow = advice ? findBy(advice.ranking, 'map', advice.suggestedPick) : null;
    var nextTask = null;
    for (var t = 0; t < TASKS.length; t++) {
      if (!window.Store.getCheck(Core.scoutKey(nearest.matchId, TASKS[t].id))) { nextTask = TASKS[t]; break; }
    }
    return el('section', { class: 'stats-next' }, [
      el('div', { class: 'stats-next__row' }, [
        el('div', { class: 'stats-next__who' }, [
          el('p', { class: 'stats-next__kicker', text: (completedFallback ? 'Последний матч · ' : 'Ближайший матч · ') + U.fmtFull(nearest.date) }),
          el('h2', { class: 'stats-next__opp', text: rosterName(rosters, nearest.opponentTeamId) })
        ]),
        el('div', { class: 'stats-next__verdict' }, [
          el('span', { class: 'stats-decision stats-decision--pick', text: 'Пик ' + mapName(nearest.verdict.pick) }),
          el('span', { class: 'stats-decision stats-decision--ban', text: 'Бан ' + mapName(nearest.verdict.ban) }),
          el('span', { class: 'stats-decision stats-decision--backup', text: 'Бэкап ' + (nearest.verdict.backup || []).map(mapName).join(' / ') })
        ]),
        el('div', { class: 'stats-next__cta' }, [
          el('p', { class: 'stats-next__ready', text: 'Готовность ' + ready.done + '/' + ready.total + (nextTask ? ' · дальше: ' + nextTask.label : '') }),
          routeLink(Core.href('match', nearest.matchId), 'Открыть полный план', 'stats-link stats-next__link')
        ])
      ]),
      pickRow ? el('p', { class: 'stats-next__why', text: mapName(pickRow.map) + ': ' + (pickRow.headline || pickRow.rationale) }) : null
    ]);
  }

  /* Тепловая карта: 7 карт × 4 соперника, цвет — чей перевес. */
  function heatBand(row) {
    if (!row || row.score === null) return 'none';
    if (row.score >= 2) return 'us2';
    if (row.band === 'pick-candidate') return 'us1';
    if (row.score <= -2) return 'them2';
    if (row.band === 'ban-candidate') return 'them1';
    return 'even';
  }

  function heatmapSection(data, plans, rosters) {
    var advices = data.vetoAdvice || [];
    if (!advices.length) return null;
    var order = plans.map(function (plan) { return plan.opponentTeamId; });
    var byOpponent = {};
    advices.forEach(function (advice) {
      var rows = {};
      advice.ranking.forEach(function (row) { rows[row.map] = row; });
      byOpponent[advice.opponentTeamId] = rows;
    });
    var edgeByOpponent = {};
    (data.mapEdges || []).forEach(function (opponent) {
      var rows = {};
      opponent.maps.forEach(function (row) { rows[row.map] = row; });
      edgeByOpponent[opponent.opponentTeamId] = rows;
    });
    var usWr = {};
    (data.teamMapStats || []).forEach(function (row) {
      if (row.teamId === 'us' && row.inPool) usWr[row.map] = row.recent.metrics.roundWinRate;
    });
    var maps = advices[0].ranking.map(function (row) { return row.map; });
    maps = maps.slice().sort(function (a, b) {
      var mean = function (map) {
        var total = 0, count = 0;
        order.forEach(function (teamId) {
          var row = byOpponent[teamId] && byOpponent[teamId][map];
          if (row && row.score !== null) { total += row.score; count += 1; }
        });
        return count ? total / count : -Infinity;
      };
      return mean(b) - mean(a) || a.localeCompare(b);
    });
    var planByOpponent = {};
    plans.forEach(function (plan) { planByOpponent[plan.opponentTeamId] = plan; });
    var head = el('tr', {}, [el('th', { text: 'Карта' }), helpTh('Мы WR', 'roundWinRate')].concat(order.map(function (teamId) {
      var plan = planByOpponent[teamId];
      return el('th', {}, [el('span', { class: 'stats-heat__opp', text: rosterName(rosters, teamId) }), el('small', { text: fmtShortDate(plan.date) })]);
    })));
    var body = maps.map(function (map) {
      var cells = [
        el('td', {}, [el('strong', { text: mapName(map) })]),
        el('td', { text: percent(usWr[map]) })
      ];
      order.forEach(function (teamId) {
        var row = byOpponent[teamId] && byOpponent[teamId][map];
        var edge = edgeByOpponent[teamId] && edgeByOpponent[teamId][map];
        var band = heatBand(row);
        var verdict = planByOpponent[teamId].verdict;
        var mark = map === verdict.pick ? 'ПИК' : map === verdict.ban ? 'БАН' : null;
        var labels = { us2: 'наш большой перевес', us1: 'наш перевес', even: 'примерно равные', them1: 'их перевес', them2: 'их большой перевес', none: 'нет данных' };
        var cell = el('td', {
          class: 'stats-heat__cell stats-heat--' + band,
          role: 'img',
          'aria-label': mapName(map) + ' против ' + rosterName(rosters, teamId) + ': ' + labels[band] + (mark ? ', ' + mark.toLowerCase() : '')
        }, [
          el('span', { text: band === 'none' ? '—' : signedNum(edge && edge.edge, 2) }),
          mark ? el('b', { class: 'stats-heat__mark', text: mark }) : null
        ]);
        cells.push(cell);
      });
      return el('tr', {}, cells);
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Карты против соперников' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Тепловая карта: прокрутите по горизонтали' }, el('table', { class: 'data stats-heat', 'aria-label': 'Тепловая карта' }, [el('thead', {}, head), el('tbody', {}, body)])),
      el('p', { class: 'stats-legend' }, [
        el('span', { class: 'stats-heat__key stats-heat--us1', text: 'зелёное — наш перевес' }),
        el('span', { class: 'stats-heat__key stats-heat--even', text: 'серое — примерно равные' }),
        el('span', { class: 'stats-heat__key stats-heat--them1', text: 'красное — их перевес' }),
        el('span', { text: ' · число — разница рейтинга · ПИК/БАН — вердикт плана · строки отсортированы от нашей лучшей карты' })
      ])
    ]);
  }

  /* Сильные/слабые стороны команды и рекомендации — из отклонений от медианы лиги. */
  function strengthsSection(data, plans) {
    var us = findBy(data.teamMetrics || [], 'teamId', 'us');
    if (!us || !us.scouting) return null;
    function absDelta(metric, delta) {
      return RATE_METRICS[metric] ? (Math.abs(delta) * 100).toFixed(1) + ' п.п.' : Math.abs(delta).toFixed(2);
    }
    function factList(rows, tone) {
      return el('ul', { class: 'stats-list' }, (rows || []).slice(0, 3).map(function (row) {
        return el('li', {}, [
          el('strong', { text: metricName(row.metric) + ' ' + metricValue(row.metric, row.value) }),
          el('span', { text: ' — ' + (tone === 'up' ? 'лучше' : 'хуже') + ' медианы лиги на ' + absDelta(row.metric, row.delta) })
        ]);
      }));
    }
    var strengths = (us.scouting.risks || []).filter(function (row) { return row.delta > 0; });
    var weaknesses = (us.scouting.exploits || []).filter(function (row) { return row.delta < 0; });
    var signal = trainingSignal(data);
    var upcomingPicks = [];
    plans.slice(0, 2).forEach(function (plan) {
      if (upcomingPicks.indexOf(plan.verdict.pick) === -1) upcomingPicks.push(plan.verdict.pick);
    });
    var advice = el('ul', { class: 'stats-list' }, [
      signal.gap != null ? el('li', { text: 'Атака отстаёт от обороны на ' + (signal.gap * 100).toFixed(1) + ' п.п.' + (signal.weakest ? '; слабейшая T-сторона — ' + mapName(signal.weakest.map) + ' (' + pct1(signal.weakest.value) + ')' : '') + ' — основной фокус тренировок.' }) : null,
      upcomingPicks.length ? el('li', { text: 'Отработать пики ближайших матчей: ' + upcomingPicks.map(mapName).join(' и ') + '.' }) : null,
      el('li', {}, [el('span', { text: 'Полный разбор наших карт — в ' }), routeLink(Core.href('team', 'us'), 'самоскаутинге')])
    ]);
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Наша команда: сильное, слабое, что тренировать' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Сильные стороны', strengths.length ? factList(strengths, 'up') : el('p', { text: 'Нет данных' })),
        card('Слабые места', weaknesses.length ? factList(weaknesses, 'down') : el('p', { text: 'Нет данных' })),
        card('Рекомендации', advice)
      ])
    ]);
  }

  /* Лиговая таблица игроков: HLTV/Leetify-набор метрик с тепловой окраской перцентилей. */
  var PLAYER_COLUMNS = [
    { key: 'rating', label: 'Rating', title: 'Rating 2 за окно', digits: 2 },
    { key: 'adr', label: 'ADR', title: 'Средний урон за раунд', digits: 1 },
    { key: 'kd', label: 'K/D', title: 'Убийства к смертям', digits: 2 },
    { key: 'kast', label: 'KAST', title: 'Доля раундов с вкладом', pct: true },
    { key: 'openingDiffPer100', label: 'Entry', title: 'Разница первых фрагов на 100 раундов', digits: 1, signed: true },
    { key: 'hsKillPct', label: 'HS%', title: 'Доля убийств в голову (за всё время)', pct: true, aim: true },
    { key: 'preaimDeg', label: 'Преаим', title: 'Средний угол доводки прицела, ° — меньше лучше', digits: 1, aim: true, lowerBetter: true },
    { key: 'ttdMs', label: 'TTD', title: 'Время от контакта до урона, мс — меньше лучше', digits: 0, aim: true, lowerBetter: true },
    { key: 'utilityDamagePerRound', label: 'Util', title: 'Урон гранатами за раунд', digits: 1 },
    { key: 'flashAssistsPer100', label: 'Flash', title: 'Флеш-ассисты на 100 раундов', digits: 1 },
    { key: 'tradeRate', label: 'Размен', title: 'Доля наших смертей, разменянных командой', pct: true },
    { key: 'clutchWinRate', label: 'Клатчи', title: 'Доля выигранных клатчей', pct: true }
  ];

  function playerCellValue(player, column) {
    if (column.aim) return player.aim ? player.aim[column.key] : null;
    return player.recent.metrics[column.key];
  }

  function formatCell(value, column) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (column.pct) return Math.round(value * 100) + '%';
    if (column.signed) return signedNum(value, column.digits);
    return value.toFixed(column.digits);
  }

  function playersLeagueSection(data, rosters) {
    var players = (data.playerMetrics || []).slice();
    if (!players.length) return null;
    var eligible = players.filter(function (player) { return player.recent.sums.rounds >= 200; });
    var bands = {};
    PLAYER_COLUMNS.forEach(function (column) {
      var values = eligible.map(function (player) { return playerCellValue(player, column); })
        .filter(function (value) { return Number.isFinite(value); })
        .sort(function (a, b) { return a - b; });
      if (values.length < 5) return;
      bands[column.key] = { low: values[Math.floor(values.length * 0.2)], high: values[Math.floor(values.length * 0.8)] };
    });
    function cellClass(player, column, value) {
      var band = bands[column.key];
      if (!band || !Number.isFinite(value) || player.recent.sums.rounds < 200) return '';
      var good = column.lowerBetter ? value <= band.low : value >= band.high;
      var bad = column.lowerBetter ? value >= band.high : value <= band.low;
      return good ? ' stats-heat--us1' : bad ? ' stats-heat--them1' : '';
    }
    var state = { teamId: '', sortKey: 'rating', descending: true };
    var tbody = el('tbody');
    var status = el('p', { class: 'stats-legend', role: 'status' });
    function render() {
      var rows = players.filter(function (player) { return !state.teamId || player.teamId === state.teamId; });
      var column = null;
      PLAYER_COLUMNS.forEach(function (item) { if (item.key === state.sortKey) column = item; });
      rows.sort(function (a, b) {
        var left = column ? playerCellValue(a, column) : a.recent.metrics.rating;
        var right = column ? playerCellValue(b, column) : b.recent.metrics.rating;
        left = Number.isFinite(left) ? left : -Infinity;
        right = Number.isFinite(right) ? right : -Infinity;
        var sign = state.descending ? -1 : 1;
        if (column && column.lowerBetter) sign = -sign;
        return (left - right) * sign || a.displayName.localeCompare(b.displayName, 'ru');
      });
      tbody.textContent = '';
      rows.forEach(function (player) {
        var cells = [
          el('td', {}, [routeLink(Core.href('player', player.steamid), player.displayName)]),
          el('td', {}, [el('span', { class: 'stats-league__team', text: player.teamId === 'us' ? 'мы' : rosterName(rosters, player.teamId) })]),
          el('td', { text: String(player.recent.sums.rounds) })
        ];
        PLAYER_COLUMNS.forEach(function (item) {
          var value = playerCellValue(player, item);
          cells.push(el('td', { class: 'stats-league__cell' + cellClass(player, item, value), text: formatCell(value, item) }));
        });
        tbody.appendChild(el('tr', {}, cells));
      });
      status.textContent = 'Показано ' + rows.length + ' из ' + players.length + ' игроков';
    }
    var filters = el('div', { class: 'stats-league__filters' }, [{ teamId: '', name: 'Все команды' }].concat(rosters.map(function (roster) {
      return { teamId: roster.teamId, name: roster.teamId === 'us' ? 'Мы' : roster.name };
    })).map(function (item) {
      var button = el('button', { type: 'button', class: 'stats-detail-button', text: item.name, 'aria-pressed': item.teamId === state.teamId ? 'true' : 'false' });
      button.addEventListener('click', function () {
        state.teamId = item.teamId;
        filters.querySelectorAll('button').forEach(function (node) { node.setAttribute('aria-pressed', 'false'); });
        button.setAttribute('aria-pressed', 'true');
        render();
      });
      return button;
    }));
    var head = el('tr', {}, [el('th', { text: 'Игрок' }), el('th', { text: 'Команда' }), el('th', { text: 'Раунды' })].concat(PLAYER_COLUMNS.map(function (column) {
      var button = el('button', { type: 'button', text: column.label, title: column.title, 'aria-label': 'Сортировать по ' + column.title });
      button.addEventListener('click', function () {
        if (state.sortKey === column.key) state.descending = !state.descending;
        else { state.sortKey = column.key; state.descending = true; }
        render();
      });
      return el('th', {}, [button]);
    })));
    render();
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Игроки лиги' }),
      filters,
      el('div', { class: 'table-wrap', 'aria-label': 'Таблица игроков: прокрутите по горизонтали' }, el('table', { class: 'data stats-league', 'aria-label': 'Игроки лиги' }, [el('thead', {}, head), tbody])),
      status,
      el('p', { class: 'stats-legend', text: 'Метрики за окно 3 месяца; HS%, преаим и TTD — за всё время (лидерборд). Зелёное — топ-20% лиги, красное — низ-20% (среди игроков с 200+ раундами). Преаим и TTD: меньше — лучше. Клик по заголовку — сортировка, наведение — расшифровка.' })
    ]);
  }

  var INSIGHT_ROLES = {
    rating: { role: 'главный фраггер', counter: 'не давать сухих дуэлей — только с разменом' },
    opening: { role: 'открывает раунды', counter: 'первые контакты под флешку, не пикать в одиночку' },
    utility: { role: 'гранатчик', counter: 'выходить до его раскидки или после её сгорания' }
  };

  function insightsSection(data, plans, rosters) {
    var cards = plans.map(function (plan) {
      var top = plan.threats[0];
      if (!top) return null;
      var kind = String(top.id || '').split(':').pop();
      var meta = INSIGHT_ROLES[kind] || INSIGHT_ROLES.rating;
      var counter = (plan.personalTasks || []).filter(function (task) {
        return task.task.toLowerCase().indexOf(playerName(rosters, top.steamid).toLowerCase()) !== -1;
      })[0];
      var weakness = plan.weaknesses[0];
      return el('article', { class: 'card stats-threat' }, [
        el('p', { class: 'stats-threat__role', text: rosterName(rosters, plan.opponentTeamId) + ' · ' + fmtShortDate(plan.date) }),
        routeLink(Core.href('player', top.steamid), playerName(rosters, top.steamid), 'stats-threat__name'),
        el('p', { class: 'stats-threat__stat', text: meta.role + ' · ' + metricName(top.metric || 'rating') + ' ' + metricValue(top.metric || 'rating', top.value) }),
        el('p', { class: 'stats-threat__answer', text: 'Закрывать: ' + (counter ? counter.task + ' (' + counter.draftName + ')' : meta.counter) }),
        weakness ? el('p', { class: 'stats-threat__stat', text: 'Их слабость: ' + metricName(weakness.metric) + ' ' + metricValue(weakness.metric, weakness.value) + ' — давить именно это.' }) : null
      ]);
    }).filter(Boolean);
    var us = (data.playerMetrics || []).filter(function (player) { return player.teamId === 'us' && player.recent.sums.rounds >= 200; });
    if (us.length) {
      var star = us.slice().sort(function (a, b) { return b.recent.metrics.rating - a.recent.metrics.rating; })[0];
      cards.push(el('article', { class: 'card stats-threat stats-threat--us' }, [
        el('p', { class: 'stats-threat__role', text: 'Наш козырь' }),
        routeLink(Core.href('player', star.steamid), star.displayName, 'stats-threat__name'),
        el('p', { class: 'stats-threat__stat', text: 'Rating ' + number(star.recent.metrics.rating) + ' · Entry ' + signedNum(star.recent.metrics.openingDiffPer100, 1) + '/100' }),
        el('p', { class: 'stats-threat__answer', text: 'Соперник будет закрывать его первым: первый контакт — только под флешку и с разменом.' })
      ]));
    }
    if (!cards.length) return null;
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Инсайты: кого закрывать' }),
      el('div', { class: 'stats-threat-grid' }, cards)
    ]);
  }

  function overviewView(data, manifest) {
    var rosters = data.rosters;
    var plans = validatePlans(data.recommendations, data.evidence, manifest).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    rosters.forEach(function (row) { knownTeams[row.teamId] = true; });
    plans.forEach(function (row) { knownMatches[row.matchId] = true; });
    var now = new Date();
    var today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    var scheduleSelection = Core.selectSchedulePlan(plans, today);
    var nearest = scheduleSelection.plan;
    var advice = nearest ? findBy(data.vetoAdvice || [], 'opponentTeamId', nearest.opponentTeamId) : null;
    var main = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Проекция из индивидуальной статистики. Сыгранность пятёрок не измерена.' }),
      nextMatchStrip(nearest, rosters, advice, scheduleSelection.completedFallback),
      heatmapSection(data, plans, rosters),
      strengthsSection(data, plans),
      insightsSection(data, plans, rosters),
      playersLeagueSection(data, rosters),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Четыре плана матчей' }),
        el('div', { class: 'stats-plan-grid' }, plans.map(function (plan) {
          var planReady = readiness(plan.matchId);
          var dot = function () { return el('span', { class: 'stats-plan-card__dot', text: ' · ' }); };
          return el('a', { href: Core.href('match', plan.matchId), class: 'card stats-plan-card' }, [
            el('span', { class: 'stats-plan-card__date', text: fmtShortDate(plan.date) }),
            dot(),
            el('strong', { class: 'stats-plan-card__opp', text: rosterName(rosters, plan.opponentTeamId) }),
            dot(),
            el('span', { class: 'stats-plan-card__chunk', text: 'Пик ' + mapName(plan.verdict.pick) }),
            dot(),
            el('span', { class: 'stats-plan-card__chunk', text: 'Бан ' + mapName(plan.verdict.ban) }),
            dot(),
            el('span', { class: 'stats-plan-card__ready stats-plan-card__chunk', text: 'готовность ' + planReady.done + '/' + planReady.total })
          ]);
        }))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Пять проекций составов' }),
        el('div', { class: 'stats-plan-grid' }, rosters.map(function (roster) {
          var label = roster.teamId === 'us' ? roster.name + ' · мы · самоскаутинг' : roster.name + ' · ' + roster.players.length + ' игроков';
          return routeLink(Core.href('team', roster.teamId), label, 'card stats-plan-card');
        }))
      ]),
      el('p', { class: 'stats-legend' }, [
        el('span', { text: 'Данные до ' + fmtShortDate(manifest.window.recentEnd) + ' (окно ' + manifest.window.recentStart + ' — ' + manifest.window.recentEnd + ') · ' + manifest.counts.matches + ' матчей · ' + manifest.counts.players + ' игроков · ' }),
        routeLink('#/statistika/quality', 'качество и provenance')
      ]),
      directoryLinks(manifest)
    ]);
    return shell('Статистика', 'Операционная сводка', main, 'Готово: тепловая карта, профиль команды и четыре плана');
  }

  function directoryLinks(manifest) {
    var playersHost = el('div', { class: 'stats-directory', id: 'stats-player-directory' });
    var matchesHost = el('div', { class: 'stats-directory', id: 'stats-match-directory' });
    var playersLink = routeLink('#stats-player-directory', manifest.counts.players + ' игроков — открыть каталог');
    var matchesLink = routeLink('#stats-match-directory', manifest.counts.matches + ' исходных матчей — открыть каталог');
    playersLink.addEventListener('click', function (event) { event.preventDefault(); loadDirectory('players', playersHost); });
    matchesLink.addEventListener('click', function (event) { event.preventDefault(); loadDirectory('matches', matchesHost); });
    return el('section', { class: 'section stats-directory-links' }, [
      el('h2', { text: 'Детали снимка' }),
      routeLink('#/statistika/maps', manifest.counts.maps + ' карт'),
      routeLink('#/statistika/weapons', manifest.counts.weapons + ' видов оружия'),
      routeLink('#/statistika/trends', manifest.counts.trendPlayers + ' тренд-профилей'),
      playersLink, matchesLink, playersHost, matchesHost
    ]);
  }

  async function loadDirectory(kind, host) {
    host.textContent = 'Загрузка…';
    try {
      var rows = await client.dataset(kind);
      if (kind === 'players') {
        rows.forEach(function (row) { if (typeof row.steamid === 'string') knownTeams[row.teamId || ''] = knownTeams[row.teamId || ''] || false; });
        U.mount(host, el('div', { class: 'stats-directory-grid' }, rows.map(function (row) { return routeLink(Core.href('player', row.steamid), row.displayName + ' · ' + row.steamid); })));
      } else {
        rows.forEach(function (row) { knownMatches[row.matchId] = true; });
        U.mount(host, el('div', { class: 'stats-directory-grid' }, rows.map(function (row) { return routeLink(Core.href('match', row.matchId), U.fmtFull(row.startedAt) + ' · ' + mapName(row.map) + ' · ' + row.matchId); })));
      }
    } catch (error) { host.textContent = 'Нет данных: ' + text(error.message); }
  }

  function comfortChips(comfort) {
    var chips = [];
    if (!comfort) return chips;
    if (comfort.practiced) chips.push(chip('тренируем', 'ok'));
    if (comfort.votes > 0) chips.push(chip('голос ' + comfort.pct + '%', 'ghost'));
    return chips;
  }

  function decisionChip(map, verdict) {
    if (!verdict) return null;
    if (map === verdict.pick) return el('span', { class: 'stats-decision stats-decision--pick', text: 'ПИК' });
    if (map === verdict.ban) return el('span', { class: 'stats-decision stats-decision--ban', text: 'БАН' });
    var backupIndex = (verdict.backup || []).indexOf(map);
    if (backupIndex !== -1) return el('span', { class: 'stats-decision stats-decision--backup', text: 'Б' + (backupIndex + 1) });
    return null;
  }

  function vetoMatrixSection(advice, edgeRows, verdict) {
    if (!advice) return el('section', { class: 'section' }, [el('h2', { text: 'Вето-матрица' }), el('p', { text: 'Нет данных' })]);
    var edgeByMap = {};
    ((edgeRows && edgeRows.maps) || []).forEach(function (row) { edgeByMap[row.map] = row; });
    var rows = advice.ranking.map(function (row) {
      var edge = edgeByMap[row.map] || { us: {}, opponent: {} };
      var noData = row.score === null;
      var cells = [
        el('td', {}, [el('strong', { text: mapName(row.map) })]),
        el('td', {}, [decisionChip(row.map, verdict)]),
        el('td', { text: noData ? 'нет данных' : percent(edge.us.roundWinRate) }),
        el('td', { text: noData ? 'нет данных' : percent(edge.opponent.roundWinRate) }),
        el('td', {}, [edgeBar(edge.edge != null ? edge.edge : null)]),
        el('td', { class: 'stats-col-opt', text: noData ? '—' : percent(edge.us.tRoundWinRate) + ' → ' + percent(edge.opponent.ctRoundWinRate) }),
        el('td', {}, comfortChips(row.comfort)),
        el('td', {}, [confBadge(row.confidence), row.crossModelDisagreement ? chip('модели расходятся', 'signal') : null])
      ];
      var tr = el('tr', {}, cells);
      if (verdict && row.map === verdict.pick) tr.className = 'is-pick';
      else if (verdict && row.map === verdict.ban) tr.className = 'is-ban';
      if (noData) tr.className += ' is-null';
      return tr;
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Вето-матрица · 7 карт пула' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Вето-матрица: прокрутите по горизонтали' }, el('table', { class: 'data stats-matrix', 'aria-label': 'Вето-матрица' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Карта' }), helpTh('Решение', 'decision'), helpTh('Мы WR', 'roundWinRate'), helpTh('Они WR', 'roundWinRate'), helpTh('Edge', 'edge'), helpTh('Наш T → их CT', 'sideMatchup', { class: 'stats-col-opt' }), helpTh('Комфорт', 'comfort'), helpTh('Данные', 'confidence')])),
        el('tbody', {}, rows)
      ])),
      el('p', { class: 'stats-legend', text: 'Сортировка — по score движка veto-1 (rating + winrate + матчап сторон, с поправкой на выборку). Edge — разница скорректированного Rating 2; |edge| < 0.03 — в пределах шума. WR — доля выигранных раундов за окно.' }),
      el('details', { class: 'stats-proof stats-proof--block' }, [
        el('summary', { text: 'Пояснения движка по каждой карте' }),
        el('ul', { class: 'stats-list' }, advice.ranking.map(function (row) {
          return el('li', {}, [
            el('strong', { text: mapName(row.map) + ': ' }),
            el('span', { text: row.headline || '' }),
            el('small', { class: 'stats-fact__meta', text: ' ' + row.rationale })
          ]);
        }))
      ])
    ]);
  }

  function playerCards(players, playerMetrics, scoutingBlock) {
    var threatIds = {};
    (scoutingBlock && scoutingBlock.ratingThreats || []).forEach(function (row) { threatIds[row.steamid] = true; });
    return el('div', { class: 'stats-plan-grid' }, players.map(function (player) {
      var metric = findBy(playerMetrics || [], 'steamid', player.steamid);
      var recent = metric && metric.recent && metric.recent.sums.rounds > 0 ? metric.recent : null;
      return el('article', { class: 'card stats-threat' }, [
        el('p', { class: 'stats-threat__role' }, [
          el('span', { text: 'draft ' + number(player.draftRating, 2) }),
          threatIds[player.steamid] ? chip('угроза', 'signal') : null
        ]),
        routeLink(Core.href('player', player.steamid), player.displayName, 'stats-threat__name'),
        recent ? el('p', { class: 'stats-threat__stat', text: 'Rating ' + number(recent.metrics.rating) + ' · ADR ' + number(recent.metrics.adr, 1) + ' · KAST ' + percent(recent.metrics.kast) + ' · n=' + recent.sums.rounds }) : el('p', { class: 'stats-threat__stat', text: 'Нет recent-выборки' })
      ]);
    }));
  }

  function selfView(data, roster, metrics, manifest) {
    var poolRows = (data.teamMapStats || []).filter(function (row) { return row.teamId === 'us' && row.inPool; });
    var anyAdvice = (data.vetoAdvice || [])[0];
    var comfortByMap = {};
    if (anyAdvice) anyAdvice.ranking.forEach(function (row) { comfortByMap[row.map] = row.comfort; });
    var sorted = poolRows.slice().sort(function (a, b) {
      var left = a.recent.metrics.roundWinRate, right = b.recent.metrics.roundWinRate;
      return (right == null ? -1 : right) - (left == null ? -1 : left) || a.map.localeCompare(b.map);
    });
    var tGap = null;
    var m = metrics.recent && metrics.recent.metrics;
    if (m && m.tRoundWinRate != null && m.ctRoundWinRate != null) tGap = m.ctRoundWinRate - m.tRoundWinRate;
    var weakestT = null;
    sorted.forEach(function (row) {
      var t = row.recent.metrics.tRoundWinRate;
      if (t != null && (weakestT === null || t < weakestT.value)) weakestT = { map: row.map, value: t };
    });
    var fieldByMap = {};
    (data.teamMapStats || []).forEach(function (row) {
      if (row.teamId === 'us' || !row.inPool) return;
      var wr = row.recent.metrics.roundWinRate;
      if (wr == null) return;
      if (!fieldByMap[row.map]) fieldByMap[row.map] = [];
      fieldByMap[row.map].push(wr);
    });
    var vsField = sorted.filter(function (row) { return row.recent.metrics.roundWinRate != null && (fieldByMap[row.map] || []).length; })
      .map(function (row) {
        var mean = fieldByMap[row.map].reduce(function (sum, value) { return sum + value; }, 0) / fieldByMap[row.map].length;
        return { map: row.map, delta: row.recent.metrics.roundWinRate - mean };
      }).sort(function (a, b) { return b.delta - a.delta; });
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Самоскаутинг: проекция индивидуальной статистики шести игроков; сыгранность пятёрки не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Сигнал на тренировку', el('div', {}, [
          el('p', { class: 'stats-big', text: tGap != null ? signedNum(-tGap * 100, 1) + ' п.п.' : 'Нет данных' }),
          el('p', { text: 'T-сторона отстаёт от CT' + (weakestT ? '; слабейший T — ' + mapName(weakestT.map) + ' (' + pct1(weakestT.value) + ')' : '') }),
          routeLink('#/trenirovki', 'К тренировкам')
        ])),
        card('Мы против лиги', vsField.length ? el('ul', { class: 'stats-list' }, vsField.slice(0, 3).map(function (row) {
          return el('li', { text: mapName(row.map) + ': ' + signedNum(row.delta * 100, 1) + ' п.п. к среднему WR соперников' });
        })) : el('p', { text: 'Нет данных' })),
        card('Recent / all-time', metricPairs(metrics.recent && metrics.recent.metrics, metrics.allTime && metrics.allTime.metrics))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Наши 7 карт' }),
        el('div', { class: 'table-wrap', 'aria-label': 'Наши карты: прокрутите по горизонтали' }, el('table', { class: 'data stats-matrix', 'aria-label': 'Наши 7 карт' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Карта' }), helpTh('WR', 'roundWinRate'), helpTh('T-WR', 'tRoundWinRate'), helpTh('CT-WR', 'ctRoundWinRate'), helpTh('Раунды', 'rounds'), helpTh('Rating', 'rating'), helpTh('Комфорт', 'comfort')])),
          el('tbody', {}, sorted.map(function (row) {
            var rm = row.recent.metrics;
            return el('tr', {}, [
              el('td', {}, [el('strong', { text: mapName(row.map) })]),
              el('td', { text: percent(rm.roundWinRate) }),
              el('td', { text: percent(rm.tRoundWinRate) }),
              el('td', { text: percent(rm.ctRoundWinRate) }),
              el('td', { text: String(row.recent.sums.rounds) }),
              el('td', { text: number(rm.rating) }),
              el('td', {}, comfortChips(comfortByMap[row.map]))
            ]);
          }))
        ]))
      ]),
      el('section', { class: 'section' }, [el('h2', { text: 'Состав' }), playerCards(roster.players, data.playerMetrics, metrics.scouting)]),
      el('p', { class: 'stats-legend', text: 'Окно данных: ' + manifest.window.recentStart + ' — ' + manifest.window.recentEnd + '. Все числа — player-rounds наших шести игроков, включая матчи в других составах.' })
    ]);
    return shell(roster.name, 'Наша команда · самоскаутинг', body, 'Готово: самоскаутинг');
  }

  function teamView(data, route, manifest) {
    var roster = findBy(data.rosters, 'teamId', route.teamId);
    var metrics = findBy(data.teamMetrics, 'teamId', route.teamId);
    if (!roster || !metrics) return emptyView('Нет данных для команды ' + route.teamId);
    knownTeams[route.teamId] = true;
    if (route.teamId === 'us') return selfView(data, roster, metrics, manifest);
    var edges = findBy(data.mapEdges, 'opponentTeamId', route.teamId);
    var advice = findBy(data.vetoAdvice || [], 'opponentTeamId', route.teamId);
    var plans = data.recommendations.filter(function (plan) { return plan.opponentTeamId === route.teamId; });
    var verdict = plans.length ? plans[0].verdict : (advice ? { pick: advice.suggestedPick, ban: advice.suggestedBan, backup: advice.suggestedBackup } : null);
    var lineup = metrics.confirmedLineup || {};
    var otherMaps = (data.teamMapStats || []).filter(function (row) { return row.teamId === route.teamId && !row.inPool && row.recent.sums.rounds > 0; })
      .sort(function (a, b) { return b.recent.sums.rounds - a.recent.sums.rounds; });
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Командные показатели — проекция индивидуальной статистики; сыгранность пятёрки не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Вердикт', verdict ? el('div', {}, [
          el('p', { class: 'stats-verdict-line stats-big', text: 'Пик ' + mapName(verdict.pick) }),
          el('p', { class: 'stats-verdict-line', text: 'Бан ' + mapName(verdict.ban) + ' · Бэкап ' + (verdict.backup || []).map(mapName).join(' / ') }),
          plans.length ? routeLink(Core.href('match', plans[0].matchId), 'Открыть план матча') : null
        ]) : el('p', { text: 'Нет данных' })),
        card('Recent / all-time', metricPairs(metrics.recent && metrics.recent.metrics, metrics.allTime && metrics.allTime.metrics)),
        card('Покрытие', el('div', {}, [
          el('p', { class: 'stats-big', text: roster.players.length + ' / 6' }),
          el('p', { text: lineup.confirmed ? 'Пятёрка подтверждена (' + (lineup.confirmedMatches || []).length + ' матчей)' : 'Подтверждённой пятёрки нет — все числа проекция' })
        ]))
      ]),
      vetoMatrixSection(advice, edges, verdict),
      otherMaps.length ? el('details', { class: 'stats-proof stats-proof--block' }, [
        el('summary', { text: 'Прочие карты вне пула (' + otherMaps.length + ') — для справки' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Карта' }), el('th', { text: 'Раунды' }), el('th', { text: 'Rating' }), el('th', { text: 'WR' })])),
          el('tbody', {}, otherMaps.map(function (row) {
            return el('tr', {}, [el('td', { text: mapName(row.map) }), el('td', { text: String(row.recent.sums.rounds) }), el('td', { text: number(row.recent.metrics.rating) }), el('td', { text: percent(row.recent.metrics.roundWinRate) })]);
          }))
        ]))
      ]) : null,
      el('section', { class: 'section' }, [el('h2', { text: 'Состав' }), playerCards(roster.players, data.playerMetrics, metrics.scouting)]),
      scouting(metrics.scouting, data.rosters),
      planLinks(plans, roster.name)
    ]);
    return shell(roster.name, 'Профиль соперника', body, 'Готово: профиль ' + roster.name);
  }

  function metricPairs(recent, all) {
    recent = recent || {}; all = all || {};
    return el('dl', { class: 'stats-dl' }, ['rating', 'adr', 'kast', 'openingDiffPer100'].map(function (key) {
      return [el('dt', { text: metricName(key) }), el('dd', { text: number(recent[key]) + ' / ' + number(all[key]) })];
    }));
  }

  function scouting(value, rosters) {
    value = value || {};
    function metricCards(title, rows) {
      return card(title, evidenceList((rows || []).map(function (row) {
        return { id: row.evidenceId, metric: row.metric, value: row.value, delta: row.delta };
      }), rosters));
    }
    var threatRows = (value.ratingThreats || []).concat(value.openingLeader || []).concat(value.utilityLeader || []);
    return el('section', { class: 'section' }, [el('h2', { text: 'Угрозы, уязвимости и риски' }), el('div', { class: 'stats-hero-grid' }, [
      card('Угрозы', el('ul', { class: 'stats-evidence' }, threatRows.map(function (row) {
        return el('li', { class: 'stats-fact' }, [routeLink(Core.href('player', row.steamid), playerName(rosters, row.steamid)), proofDetails(row.evidenceId)]);
      }))),
      metricCards('Уязвимости', value.exploits), metricCards('Риски', value.risks)
    ])]);
  }

  function planLinks(plans, name) {
    return el('section', { class: 'section' }, [el('h2', { text: 'Матчи' }), plans.length ? el('div', { class: 'stats-plan-grid' }, plans.map(function (plan) { return routeLink(Core.href('match', plan.matchId), plan.date + ' · полный план против ' + name, 'card stats-route-card'); })) : el('p', { text: 'Нет данных' })]);
  }

  function playerView(data, route) {
    var raw = findBy(data.players, 'steamid', route.steamid);
    var metric = findBy(data.playerMetrics, 'steamid', route.steamid);
    if (!raw && !metric) return emptyView('Игрок ' + route.steamid + ' не найден');
    var name = metric ? metric.displayName : raw.displayName;
    var roster = null;
    data.rosters.forEach(function (team) { if (findBy(team.players, 'steamid', route.steamid)) roster = team; });
    var maps = (data.playerMapStats || []).filter(function (row) { return row.steamid === route.steamid; }).map(function (row) { return { map: row.map, value: row }; });
    var weapons = data.playerWeaponStats.filter(function (row) { return row.steamid === route.steamid; }).slice(0, 20);
    var trends = data.trendMatches.filter(function (row) { return row.steamid === route.steamid; }).slice(-20);
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'stats-mono', text: route.steamid }),
      roster ? routeLink(Core.href('team', roster.teamId), 'Вернуться к составу ' + roster.name) : el('p', { text: 'Команда не сопоставлена' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Recent / all-time', metric ? metricPairs(metric.recent.metrics, metric.allTime.metrics) : metricPairs({ rating: raw.rating2, adr: raw.adr, kast: raw.kast_pct / 100 }, {})),
        card('Стороны', metric && metric.recent.metrics ? sideFigure(metric.recent.metrics.sides, metric.recent.sums.rounds) : el('p', { text: 'Нет данных' })),
        card('Выборка', el('div', {}, [el('p', { class: 'stats-big', text: String(metric ? metric.recent.sums.rounds : raw.rounds_played) }), el('p', { text: 'recent rounds' })]))
      ]),
      playerMapTable(maps), playerWeaponTable(weapons), trendTable(trends), playerClutchTable(data.playerClutches || [])
    ]);
    return shell(name, 'Профиль игрока', body, 'Готово: профиль ' + name);
  }

  function sideFigure(sides, sample) {
    sides = sides || {};
    var t = sides.T || {}, ct = sides.CT || {};
    return el('figure', { class: 'stats-chart', role: 'img', 'aria-label': 'Rating игрока: T ' + number(t.rating) + ', CT ' + number(ct.rating) }, [
      el('figcaption', {}, [el('strong', { text: 'T / CT split' }), el('span', { text: 'n=' + sample + ' раундов; стороны различаются буквами и цветом' })]),
      el('div', { class: 'stats-bars' }, [
        el('div', { class: 'stats-bar stats-bar--t' }, [el('span', { text: 'T' }), el('i', { style: '--value:' + Math.min(100, (t.rating || 0) * 50) + '%' }), el('b', { text: number(t.rating) })]),
        el('div', { class: 'stats-bar stats-bar--ct' }, [el('span', { text: 'CT' }), el('i', { style: '--value:' + Math.min(100, (ct.rating || 0) * 50) + '%' }), el('b', { text: number(ct.rating) })])
      ])
    ]);
  }

  function playerMapTable(rows) {
    return simpleTableSection('Карты игрока', ['Карта', 'Rating', 'Раунды'], rows.slice(0, 46).map(function (item) {
      var value = item.value || {}, metrics = value.metrics || value, sums = value.sums || value;
      return [mapName(item.map), number(metrics.rating || metrics.rating2), text(sums.rounds || sums.rounds_played)];
    }));
  }

  function playerWeaponTable(rows) {
    return simpleTableSection('Оружие игрока', ['Оружие', 'Убийства', 'Выстрелы'], rows.map(function (row) { return [text(row.weapon), text(row.kills), text(row.shots)]; }));
  }

  function trendTable(rows) {
    return simpleTableSection('Последние матчи тренда', ['Дата', 'Карта', 'Rating'], rows.map(function (row) { return [U.fmtFull(row.startedAt), mapName(row.map), number(row.rating2)]; }));
  }

  function playerClutchTable(rows) {
    return simpleTableSection('Клатчи игрока', ['Матч', 'Раунд', 'Против', 'Убийства', 'Победа', 'Выжил'], rows.map(function (row) {
      return [row.matchId, row.round, '1v' + row.vs, row.kills, row.won ? 'Да' : 'Нет', row.survived ? 'Да' : 'Нет'];
    }));
  }

  function simpleTableSection(title, heads, rows) {
    return el('section', { class: 'section' }, [el('h2', { text: title }), rows.length ? el('div', { class: 'table-wrap', 'aria-label': 'Таблица ' + title + ': прокрутите по горизонтали' }, el('table', { class: 'data', 'aria-label': title }, [
      el('thead', {}, el('tr', {}, heads.map(function (head) { return el('th', { text: head }); }))),
      el('tbody', {}, rows.map(function (row) { return el('tr', {}, row.map(function (cell) { return el('td', { text: text(cell) }); })); }))
    ])) : el('p', { text: 'Нет данных' })]);
  }

  function verdictPanel(plan, advice) {
    var verdict = plan.verdict || {};
    var pickRow = advice ? findBy(advice.ranking, 'map', verdict.pick) : null;
    var banRow = advice ? findBy(advice.ranking, 'map', verdict.ban) : null;
    var branch = advice ? (advice.decisionTree.branches || []).filter(function (item) { return item.trigger.map === verdict.pick; })[0] : null;
    function panel(kicker, map, why, tech, type) {
      return el('div', { class: 'stats-verdict__card stats-verdict__card--' + type }, [
        el('span', { class: 'stats-verdict__kicker', text: kicker }),
        el('strong', { class: 'stats-verdict__map', text: mapName(map) }),
        why ? el('p', { class: 'stats-verdict__why', text: why }) : null,
        tech ? el('p', { class: 'stats-verdict__tech', text: tech }) : null
      ]);
    }
    return el('div', { class: 'stats-verdict' }, [
      panel('Пикаем', verdict.pick, pickRow ? pickRow.headline : '', pickRow ? pickRow.rationale : '', 'pick'),
      panel('Баним', verdict.ban, banRow ? 'Наш худший расклад из семи. ' + (banRow.headline || '') : '', banRow ? banRow.rationale : '', 'ban'),
      branch && branch.response.map ? panel('Если ' + mapName(verdict.pick) + ' банят', branch.response.map, 'Следующая по силе карта; полное дерево вето ниже.', null, 'branch') : null
    ]);
  }

  function conflictBanner(plan) {
    var conflicts = plan.comfortConflict || [];
    if (!conflicts.length) return null;
    var lines = conflicts.map(function (item) {
      var comfort = 'голос ' + item.pct + '%' + (item.practiced ? ', тренируем' : '');
      return item.verdictAction === 'ban'
        ? mapName(item.map) + ' (' + comfort + ') — по цифрам это наш худший матчап, вердикт: бан.'
        : mapName(item.map) + ' (' + comfort + ') — против этого соперника карта в минусе.';
    });
    return el('aside', { class: 'stats-conflict' }, [
      el('p', { class: 'stats-conflict__kicker', text: 'Комфорт против цифр' }),
      el('ul', { class: 'stats-list' }, lines.map(function (line) { return el('li', { text: line }); })),
      el('p', {}, [el('span', { text: 'Вердикт построен только по статистике; комфорт — контекст для обсуждения. ' }), el('a', { href: '#/taktiki', class: 'stats-link', text: 'Обсудить в Тактиках' })])
    ]);
  }

  function vetoTreeSection(advice, plan) {
    if (!advice) return null;
    var tree = advice.decisionTree;
    var verdict = plan.verdict || {};
    var steps = [{ title: 'Баним ' + mapName(verdict.ban), why: 'наш худший матчап по цифрам' }];
    (tree.branches || []).forEach(function (branch) {
      steps.push({
        title: 'Они сняли ' + mapName(branch.trigger.map) + ' → пикаем ' + mapName(branch.response.map),
        why: branch.response.why
      });
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Дерево вето' }),
      tree.orderConfirmed ? null : el('p', { class: 'stats-legend', text: 'Точный порядок вето лиги не подтверждён (' + text(tree.format) + '): ветки отвечают на «какую карту сняли», а не на номер шага.' }),
      el('ol', { class: 'stats-tree' }, steps.map(function (step) {
        return el('li', {}, [el('strong', { text: step.title }), step.why ? el('span', { text: ' — ' + step.why }) : null]);
      })),
      plan.contingency ? el('p', { class: 'stats-legend', text: 'Примечание штаба: ' + plan.contingency }) : null
    ]);
  }

  function matchView(data, route, manifest) {
    var plan = findBy(data.recommendations, 'matchId', route.matchId);
    if (!plan) {
      var source = findBy(data.matches, 'matchId', route.matchId);
      return source ? sourceMatchView(source) : emptyView('Матч ' + route.matchId + ' не найден');
    }
    validatePlans([plan], data.evidence, manifest);
    knownMatches[plan.matchId] = true;
    var opponent = rosterName(data.rosters, plan.opponentTeamId);
    var advice = findBy(data.vetoAdvice || [], 'opponentTeamId', plan.opponentTeamId);
    var edgeRows = findBy(data.mapEdges || [], 'opponentTeamId', plan.opponentTeamId);
    var tasks = el('div', { class: 'stats-tasks' }, TASKS.map(function (task) {
      var key = Core.scoutKey(plan.matchId, task.id);
      return el('div', { class: 'stats-task' }, [U.check(key, task.label), U.noteField(key, 'Общая заметка', 'Короткая договорённость по задаче…')]);
    }));
    var body = el('div', { class: 'stats-stack' }, [
      verdictPanel(plan, advice),
      conflictBanner(plan),
      vetoMatrixSection(advice, edgeRows, plan.verdict),
      vetoTreeSection(advice, plan),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Как играем: их слабости — наши действия' }),
        el('div', { class: 'stats-hero-grid' }, [
          card('Их слабые места', evidenceList(plan.weaknesses, data.rosters)),
          listCard('Делаем', plan.do),
          listCard('Не делаем', plan.dont)
        ])
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Кто у них опасен' }),
        threatCards(plan.threats, data.rosters, plan.personalTasks)
      ]),
      el('section', { class: 'section' }, [el('h2', { text: 'Чеклист тренировки' }), simpleList(plan.trainingChecklist || [])]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Личные задачи' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data', 'aria-label': 'Личные задачи' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Игрок' }), el('th', { text: 'Задача' })])),
          el('tbody', {}, (plan.personalTasks || []).map(function (task) {
            return el('tr', {}, [
              el('td', {}, [task.steamid ? routeLink(Core.href('player', task.steamid), task.draftName) : el('span', { text: task.draftName })]),
              el('td', { text: task.task })
            ]);
          }))
        ]))
      ]),
      el('section', { class: 'section' }, [el('h2', { text: 'Чеклист матч-дня' }), simpleList(plan.matchdayChecklist || [])]),
      el('section', { class: 'section' }, [el('h2', { text: 'Общие задачи' }), tasks, el('p', { class: 'stats-sync-note', text: 'Сохраняется в командное состояние; одновременное редактирование одной заметки — last write wins.' })]),
      el('section', { class: 'section', id: 'stats-methodology' }, [
        el('h2', { text: 'Методология и ограничения' }),
        el('p', { class: 'lead stats-caveat', text: 'Командные числа — проекция индивидуальной статистики шести игроков; сыгранность пятёрок не измерена.' }),
        simpleList((plan.caveats || []).map(function (row) { return row.text; })),
        el('p', { class: 'stats-legend' }, [
          el('span', { text: 'Вердикт: движок veto-1 (только цифры) · уверенность ' }),
          confBadge(plan.confidence),
          el('span', { text: ' · план проверен штабом ' + plan.reviewedAt + ' · данные до ' + plan.dataThrough })
        ]),
        el('details', { class: 'stats-proof stats-proof--block', 'data-evidence': 'true' }, [
          el('summary', { text: 'Evidence IDs (для сверки)' }),
          simpleList(Core.recommendationEvidenceIds(plan))
        ])
      ])
    ]);
    return shell('План матча · ' + opponent, plan.date + ' / ' + plan.matchId, body, 'Готово: reviewed план матча ' + plan.matchId);
  }
  function listCard(title, rows) { return card(title, simpleList(rows || [])); }
  function simpleList(rows) { return rows.length ? el('ul', { class: 'stats-list' }, rows.map(function (row) { return el('li', { text: text(row) }); })) : el('p', { text: 'Нет данных' }); }

  function sourceMatchView(source) {
    var detailHosts = [el('div'), el('div'), el('div')];
    var host = el('div', { id: 'stats-source-match-detail', class: 'stats-directory', 'data-detail-readonly': 'true' }, detailHosts);
    var load = el('button', { type: 'button', class: 'stats-detail-button', text: 'Загрузить детали матча' });
    var status;
    load.addEventListener('click', async function () {
      load.disabled = true; load.textContent = 'Загрузка деталей матча…';
      detailHosts.forEach(function (detailHost) { detailHost.textContent = 'Загрузка…'; });
      var loaders = [
        { dataset: 'matchPlayers', label: 'игроки', render: function (rows) {
          return simpleTableSection('Игроки матча', ['SteamID', 'Имя', 'Rating', 'Результат'], rows.map(function (row) {
            return [row.steamid, row.name, number(row.rating2), row.matchResult];
          }));
        } },
        { dataset: 'matchRounds', label: 'раунды', render: function (rows) {
          return simpleTableSection('Раунды матча', ['Раунд', 'Победитель', 'Причина', 'Бомба'], rows.map(function (row) {
            return [row.round, row.winner, row.reason, row.bombPlanted ? 'Установлена' : 'Нет'];
          }));
        } },
        { dataset: 'matchPlayerWeapons', label: 'оружие', render: function (rows) {
          return simpleTableSection('Оружие матча', ['SteamID', 'Оружие', 'Убийства', 'Урон', 'Выстрелы'], rows.map(function (row) {
            return [row.steamid, row.weapon, row.kills, row.damage, row.shots];
          }));
        } }
      ];
      var results = await Promise.all(loaders.map(async function (definition, index) {
        try {
          var rows = await client.datasetForKey(definition.dataset, 'matchId', source.matchId);
          U.mount(detailHosts[index], definition.render(rows));
          return null;
        } catch (error) {
          detailHosts[index].textContent = 'Нет данных: ' + error.message;
          return definition.label;
        }
      }));
      var failed = results.filter(Boolean);
      if (failed.length) {
        load.disabled = false; load.textContent = 'Повторить детали матча';
        status.textContent = 'Ошибка деталей: ' + failed.join(', ') + '. Успешные таблицы сохранены.';
      } else {
        load.textContent = 'Детали матча загружены';
        status.textContent = 'Детали матча загружены';
      }
    });
    var view = shell('Исходный матч · ' + mapName(source.map), source.startedAt + ' / ' + source.matchId, el('div', { class: 'stats-stack' }, [
      card('Матч', el('dl', { class: 'stats-dl' }, [el('dt', { text: 'Раунды' }), el('dd', { text: String(source.roundsPlayed) }), el('dt', { text: 'Режим' }), el('dd', { text: text(source.mode) }), el('dt', { text: 'Server' }), el('dd', { text: text(source.serverName) })])), load, host
    ]), 'Готово: исходный матч');
    status = view.node.querySelector('[role="status"]');
    return view;
  }

  function sortableView(title, eyebrow, rows, config, detailLoader) {
    var sortKey = config.defaultKey;
    var direction = 'descending';
    var query = '';
    var tbody = el('tbody');
    var caption = el('caption', { class: 'sr-only' });
    var status = live('Показано ' + rows.length + ' результатов');
    var input = el('input', { type: 'search', class: 'stats-filter', placeholder: 'Фильтр…' });
    var label = el('label', { class: 'stats-filter-label' }, [el('span', { text: 'Фильтр ' + title.toLowerCase() }), input]);
    var headers = config.columns.map(function (col) {
      var th = el('th', { 'aria-sort': 'none' });
      var button = el('button', { type: 'button', text: col.label, 'aria-label': 'Сортировать по ' + col.label.toLowerCase() });
      button.addEventListener('click', function () { sortKey === col.key ? direction = direction === 'ascending' ? 'descending' : 'ascending' : (sortKey = col.key, direction = 'ascending'); render(); });
      th.appendChild(button); return { th: th, col: col };
    });
    if (detailLoader) headers.push({ th: el('th', { text: 'Детали' }), col: null });

    function render() {
      headers.forEach(function (head) { if (head.col) head.th.setAttribute('aria-sort', head.col.key === sortKey ? direction : 'none'); });
      var filtered = rows.filter(function (row) { return !query || config.search(row).toLowerCase().indexOf(query) !== -1; });
      filtered = Core.sortRows(filtered, sortKey, direction);
      tbody.textContent = '';
      filtered.forEach(function (row) {
        var cells = config.columns.map(function (col) { return el('td', { text: text(col.value(row)) }); });
        if (detailLoader) {
          var host = el('div', { class: 'stats-row-detail' });
          var button = el('button', { type: 'button', class: 'stats-detail-button', text: 'Открыть ' + config.name(row) });
          button.addEventListener('click', function () { detailLoader(row, host, button, status); });
          cells.push(el('td', {}, [button, host]));
        }
        tbody.appendChild(el('tr', {}, cells));
      });
      var message = 'Показано ' + filtered.length + ' из ' + rows.length + ' результатов';
      caption.textContent = message + ', сортировка ' + sortKey + ' ' + direction;
      status.textContent = message;
    }
    input.addEventListener('input', function () { query = input.value.trim().toLowerCase(); render(); });
    render();
    var table = el('table', { class: 'data stats-sortable' }, [caption, el('thead', {}, el('tr', {}, headers.map(function (head) { return head.th; }))), tbody]);
    var view = shell(title, eyebrow, el('div', { class: 'stats-stack' }, [label, el('div', { class: 'table-wrap', 'aria-label': 'Таблица ' + title + ': прокрутите по горизонтали' }, table)]), 'Показано ' + rows.length + ' результатов');
    view.node.replaceChild(status, view.node.lastChild);
    return view;
  }

  function mapsView(rows) {
    return sortableView('Карты', rows.length + ' карт / aggregate', rows, { defaultKey: 'n', search: function (row) { return row.map; }, name: function (row) { return mapName(row.map); }, columns: [
      { key: 'map', label: 'Карта', value: function (row) { return mapName(row.map); } }, { key: 'n', label: 'Матчам', value: function (row) { return row.n; } }
    ] }, async function (row, host, button, status) {
      button.disabled = true; host.textContent = 'Загрузка…';
      try {
        var details = (await client.datasetForKey('playerMapStats', 'map', row.map)).slice(0, 10);
        U.mount(host, simpleList(details.map(function (item) { return text(item.name || item.steamid) + ' · Rating ' + number(item.rating2 || item.rating); })));
        status.textContent = 'Детали карты ' + mapName(row.map) + ' загружены';
      } catch (error) {
        host.textContent = 'Нет данных: ' + error.message; button.disabled = false;
        status.textContent = 'Ошибка деталей карты ' + mapName(row.map) + '. Можно повторить.';
      }
    });
  }

  function weaponsView(rows) {
    return sortableView('Оружие', rows.length + ' видов оружия / aggregate', rows, { defaultKey: 'kills', search: function (row) { return row.weapon; }, name: function (row) { return row.weapon; }, columns: [
      { key: 'weapon', label: 'Оружие', value: function (row) { return row.weapon; } }, { key: 'kills', label: 'Убийствам', value: function (row) { return row.kills; } }, { key: 'shots', label: 'Выстрелам', value: function (row) { return row.shots; } }, { key: 'players', label: 'Игрокам', value: function (row) { return row.players; } }
    ] }, async function (row, host, button, status) {
      button.disabled = true; host.textContent = 'Загрузка…';
      try {
        var details = (await client.datasetForKey('playerWeaponStats', 'weapon', row.weapon)).slice(0, 10);
        U.mount(host, simpleList(details.map(function (item) { return text(item.name || item.steamid) + ' · ' + text(item.kills) + ' убийств'; })));
        status.textContent = 'Детали оружия ' + text(row.weapon) + ' загружены';
      } catch (error) {
        host.textContent = 'Нет данных: ' + error.message; button.disabled = false;
        status.textContent = 'Ошибка деталей оружия ' + text(row.weapon) + '. Можно повторить.';
      }
    });
  }

  function trendsView(rows) {
    return sortableView('Тренды', rows.length + ' профилей / recent movement', rows, { defaultKey: 'roundsTotal', search: function (row) { return row.name + ' ' + row.steamid; }, name: function (row) { return row.name; }, columns: [
      { key: 'name', label: 'Игроку', value: function (row) { return row.name; } }, { key: 'roundsTotal', label: 'Раундам', value: function (row) { return row.roundsTotal; } }, { key: 'steamid', label: 'SteamID', value: function (row) { return row.steamid; } }
    ] }, function (row) { window.location.hash = Core.href('player', row.steamid); });
  }

  function qualityView(rows, manifest) {
    var quality = rows[0] || {};
    var body = el('div', { class: 'stats-stack' }, [
      el('div', { class: 'stats-hero-grid' }, [card('Integrity', el('div', {}, [chip(text(quality.integrity), quality.integrity === 'ok' ? 'ok' : 'signal'), el('p', { text: quality.foreignKeyViolations + ' FK violations · ' + quality.sourceDiscrepancies + ' discrepancies' })])), card('Root', el('p', { class: 'stats-mono', text: manifest.root })), card('Окно', el('p', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd }))]),
      simpleTableSection('Покрытие', ['Dataset', 'Строк', 'Шардов'], Object.keys(manifest.counts).map(function (key) { return [key, manifest.counts[key], manifest.assets.filter(function (asset) { return asset.dataset === key; }).length || '—']; })),
      simpleTableSection('Проверенные assets', ['Dataset', 'Путь', 'Строк', 'SHA-256'], manifest.assets.map(function (asset) { return [asset.dataset, asset.path, asset.count, asset.sha256.slice(0, 12) + '…']; }))
    ]);
    return shell('Качество данных', 'Provenance / validation', body, 'Готово: ' + manifest.assets.length + ' assets проверяются по SHA-256');
  }

  async function loadRoute(route) {
    var state = await client.open();
    var names = Core.datasetsForRoute(route);
    var values = await Promise.all(names.map(function (name) { return client.dataset(name); }));
    var data = {};
    names.forEach(function (name, index) { data[name] = values[index]; });
    if (route.view === 'player') {
      var keyed = await Promise.all([
        client.datasetForKey('playerMapStats', 'steamid', route.steamid),
        client.datasetForKey('playerWeaponStats', 'steamid', route.steamid),
        client.datasetForKey('trendMatches', 'steamid', route.steamid),
        client.datasetForKey('playerClutches', 'steamid', route.steamid)
      ]);
      data.playerMapStats = keyed[0]; data.playerWeaponStats = keyed[1];
      data.trendMatches = keyed[2]; data.playerClutches = keyed[3];
    }
    if (route.view === 'overview') return overviewView(data, state.manifest);
    if (route.view === 'team') return teamView(data, route, state.manifest);
    if (route.view === 'player') return playerView(data, route);
    if (route.view === 'match') return matchView(data, route, state.manifest);
    if (route.view === 'maps') return mapsView(data.maps);
    if (route.view === 'weapons') return weaponsView(data.weapons);
    if (route.view === 'trends') return trendsView(data.trendPlayers);
    if (route.view === 'quality') return qualityView(data.quality, state.manifest);
    return emptyView(route.reason);
  }

  async function open(route, options) {
    currentRoute = route;
    var shouldFocus = !!(options && options.moveFocus) || focusNext;
    focusNext = false;
    if (activeController) activeController.abort();
    activeController = new AbortController();
    var token = ++requestToken;
    if (route.view === 'invalid') return mountView(emptyView(route.reason), shouldFocus);
    mountView(loading(route), false);
    try {
      var view = await loadRoute(route);
      if (token !== requestToken) return;
      mountView(view, shouldFocus);
    } catch (error) {
      if (token !== requestToken) return;
      if (error && error.name === 'AbortError' && !(options && options.abortRetry)) {
        return open(route, { moveFocus: shouldFocus, abortRetry: true });
      }
      mountView(errorView(error), shouldFocus);
    }
  }

  function retryOpen() {
    client.clear();
    if (currentRoute) open(currentRoute, { moveFocus: true });
  }

  document.getElementById('statistics').addEventListener('click', function (event) {
    var link = event.target.closest('a[href^="#/statistika"]');
    if (link) focusNext = true;
  });

  window.Store.onChange(function () {
    if (currentRoute && currentRoute.view === 'overview') open(currentRoute, { moveFocus: false });
  });

  /* ---- Обогащение вкладки «Соперники» лениво загруженной статистикой ---- */

  var TEAM_COLUMNS = [
    { key: 'rating', label: 'Rating', digits: 2 },
    { key: 'roundWinRate', label: 'WR', pct: true },
    { key: 'tRoundWinRate', label: 'T-WR', pct: true },
    { key: 'ctRoundWinRate', label: 'CT-WR', pct: true },
    { key: 'adr', label: 'ADR', digits: 1 },
    { key: 'openingDiffPer100', label: 'Entry', digits: 1, signed: true },
    { key: 'utilityDamagePerRound', label: 'Util', digits: 1 },
    { key: 'flashAssistsPer100', label: 'Flash', digits: 1 },
    { key: 'tradeRate', label: 'Размены', pct: true },
    { key: 'clutchWinRate', label: 'Клатчи', pct: true },
    { key: 'retakeWinRate', label: 'Ретейки', pct: true },
    { key: 'postplantWinRate', label: 'Постплент', pct: true },
    { key: 'pistolWinRate', label: 'Пистолетки', pct: true }
  ];

  function teamCompareSection(data, plans) {
    var order = ['us'].concat(plans.map(function (plan) { return plan.opponentTeamId; }));
    var teams = order.map(function (teamId) { return findBy(data.teamMetrics, 'teamId', teamId); }).filter(Boolean);
    var extremes = {};
    TEAM_COLUMNS.forEach(function (column) {
      var values = teams.map(function (team) { return team.recent.metrics[column.key]; })
        .filter(function (value) { return Number.isFinite(value); });
      if (values.length >= 3) extremes[column.key] = { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
    });
    var head = el('tr', {}, [el('th', { text: 'Команда' }), helpTh('Раунды', 'rounds')].concat(TEAM_COLUMNS.map(function (column) {
      return helpTh(column.label, column.key);
    })));
    var rows = teams.map(function (team) {
      var cells = [
        el('td', {}, [el('strong', { text: team.teamId === 'us' ? 'Мы · ' + team.name : team.name })]),
        el('td', { text: String(team.recent.sums.rounds) })
      ];
      TEAM_COLUMNS.forEach(function (column) {
        var value = team.recent.metrics[column.key];
        var extreme = extremes[column.key];
        var className = '';
        if (extreme && Number.isFinite(value) && extreme.max !== extreme.min) {
          if (value === extreme.max) className = ' stats-heat--us1';
          else if (value === extreme.min) className = ' stats-heat--them1';
        }
        cells.push(el('td', { class: 'stats-league__cell' + className, text: formatCell(value, column) }));
      });
      var tr = el('tr', {}, cells);
      if (team.teamId === 'us') tr.className = 'is-us';
      return tr;
    });
    return el('section', { class: 'stats-compare' }, [
      el('h2', { text: 'Сравнение команд по цифрам' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Сравнение команд: прокрутите по горизонтали' }, el('table', { class: 'data stats-league', 'aria-label': 'Сравнение команд' }, [el('thead', {}, head), el('tbody', {}, rows)])),
      el('p', { class: 'stats-legend', text: 'Все числа — за окно 3 месяца, проекция из индивидуальной статистики. Зелёная ячейка — лучший в лиге по колонке, красная — худший. Наведите на заголовок колонки — там расшифровка метрики.' })
    ]);
  }

  function bestWorstMaps(data, teamId) {
    var rows = (data.teamMapStats || []).filter(function (row) {
      return row.teamId === teamId && row.inPool && row.recent.sums.rounds >= 100 && row.recent.metrics.roundWinRate != null;
    }).sort(function (a, b) { return b.recent.metrics.roundWinRate - a.recent.metrics.roundWinRate; });
    return rows.length ? { best: rows[0], worst: rows[rows.length - 1] } : null;
  }

  function teamStatsBox(data, plans, teamId) {
    var team = findBy(data.teamMetrics, 'teamId', teamId);
    if (!team) return null;
    var m = team.recent.metrics;
    var lines = [el('p', {}, [
      el('strong', { text: 'Rating ' + number(m.rating) }),
      el('span', { text: ' · WR ' + percent(m.roundWinRate) + ' · T ' + percent(m.tRoundWinRate) + ' / CT ' + percent(m.ctRoundWinRate) + ' · ' + team.recent.sums.rounds + ' раундов' })
    ])];
    var maps = bestWorstMaps(data, teamId);
    if (maps) {
      lines.push(el('p', { text: 'Сильнейшая карта: ' + mapName(maps.best.map) + ' (WR ' + percent(maps.best.recent.metrics.roundWinRate) + ') · слабейшая: ' + mapName(maps.worst.map) + ' (WR ' + percent(maps.worst.recent.metrics.roundWinRate) + ')' }));
    }
    if (teamId === 'us') {
      lines.push(el('p', {}, [routeLink(Core.href('team', 'us'), 'Самоскаутинг: наши 7 карт и сигнал на тренировку')]));
    } else {
      var plan = null;
      plans.forEach(function (item) { if (item.opponentTeamId === teamId) plan = item; });
      if (plan) {
        lines.push(el('p', {}, [
          el('span', { class: 'stats-decision stats-decision--pick', text: 'Пик ' + mapName(plan.verdict.pick) }),
          el('span', { text: ' ' }),
          el('span', { class: 'stats-decision stats-decision--ban', text: 'Бан ' + mapName(plan.verdict.ban) })
        ]));
      }
    }
    return el('div', { class: 'stats-teambox' }, lines);
  }

  async function enrichOpponents() {
    var compare = document.getElementById('opponents-compare');
    if (!compare || compare.getAttribute('data-loaded') === 'true') return;
    compare.textContent = 'Загружаем проверенную статистику…';
    try {
      var names = ['rosters', 'teamMetrics', 'teamMapStats', 'vetoAdvice', 'recommendations', 'evidence'];
      var values = await Promise.all(names.map(function (name) { return client.dataset(name); }));
      var data = {};
      names.forEach(function (name, index) { data[name] = values[index]; });
      var state = await client.open();
      var plans = validatePlans(data.recommendations, data.evidence, state.manifest)
        .slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      U.mount(compare, teamCompareSection(data, plans));
      compare.setAttribute('data-loaded', 'true');
      document.querySelectorAll('[data-team-stats]').forEach(function (host) {
        var box = teamStatsBox(data, plans, host.getAttribute('data-team-stats'));
        if (box) U.mount(host, box);
      });
    } catch (error) {
      compare.textContent = 'Статистика недоступна: ' + text(error && error.message);
    }
  }

  window.Stats = {
    open: open,
    href: Core.href,
    hasTeam: function (teamId) { return knownTeams[teamId] === true; },
    hasMatch: function (matchId) { return knownMatches[matchId] === true; },
    enrichOpponents: enrichOpponents,
    retry: retryOpen
  };
})();
