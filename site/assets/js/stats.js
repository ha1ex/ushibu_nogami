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
      routeLink('#/statistika', 'Сводка'), routeLink('#/statistika/zerkalo', 'Как нас видят'),
      routeLink('#/statistika/maps', 'Карты'),
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

  function rosterPlayers(rosters, teamId) {
    var roster = findBy(rosters, 'teamId', teamId);
    if (!roster || !Array.isArray(roster.players)) return [];
    return roster.players.slice().sort(function (a, b) { return (b.draftRating || 0) - (a.draftRating || 0); });
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
    var labels = { high: 'высокая', medium: 'средняя', low: 'низкая' };
    return labels[value] || 'не указана';
  }

  function chip(label, type) { return el('span', { class: 'chip chip--' + (type || 'ghost'), text: label }); }

  function card(title, body, className) {
    return el('article', { class: 'card stats-card' + (className ? ' ' + className : '') }, [el('h2', { text: title }), body]);
  }

  function rosterNote(count) {
    return el('p', { class: 'stats-roster-note', text: 'Ростер ' + count + ' · пятёрка не подтверждена' });
  }

  function rosterStrip(rosters, teamId) {
    var players = rosterPlayers(rosters, teamId);
    if (!players.length) return el('p', { class: 'stats-roster-note', text: 'Состав не сопоставлен' });
    return el('div', { class: 'stats-roster-strip' }, [
      el('ul', { class: 'stats-roster stats-roster--compact', 'aria-label': 'Ники соперника' }, players.map(function (player) {
        return el('li', {}, routeLink(Core.href('player', player.steamid), player.displayName, 'stats-roster-name'));
      })),
      rosterNote(players.length)
    ]);
  }

  /* Шапка ближайшего матча: сначала метки и дата, затем имя, ники и переход в план. */
  function nextMatchCard(rosters, plan) {
    var opponent = rosterName(rosters, plan.opponentTeamId);
    return el('div', { class: 'stats-next' }, [
      el('div', { class: 'stats-next-meta' }, [
        chip('reviewed', 'ok'),
        el('time', { datetime: plan.date, text: U.fmtFull(plan.date) })
      ]),
      el('p', { class: 'stats-big stats-big--name', text: opponent }),
      rosterStrip(rosters, plan.opponentTeamId),
      el('a', { href: Core.href('match', plan.matchId), class: 'stats-link stats-next-cta', 'aria-label': 'Открыть полный план матча: ' + opponent, text: 'Открыть полный план →' })
    ]);
  }

  function rosterBlock(rosters, teamId, threats) {
    var players = rosterPlayers(rosters, teamId);
    var flagged = new Set((threats || []).map(function (row) { return String(row.steamid); }));
    if (!players.length) return el('section', { class: 'section' }, [el('h2', { text: 'Состав соперника' }), el('p', { text: 'Состав не сопоставлен' })]);
    return el('section', { class: 'section stats-roster-section' }, [
      el('h2', { text: 'Состав соперника · ' + rosterName(rosters, teamId) }),
      el('ul', { class: 'stats-roster stats-roster--full', 'aria-label': 'Ники соперника' }, players.map(function (player) {
        var threat = flagged.has(String(player.steamid));
        return el('li', { class: threat ? 'is-threat' : null }, [
          routeLink(Core.href('player', player.steamid), player.displayName, 'stats-roster-name'),
          el('span', { class: 'stats-roster-meta', text: 'draft ' + number(player.draftRating, 3) }),
          threat ? chip('угроза', 'signal') : null
        ]);
      })),
      rosterNote(players.length)
    ]);
  }

  function evidenceList(items, rosters) {
    return el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, (items || []).map(function (item) {
      var label = item.steamid ? playerName(rosters, item.steamid) + ' · ' : '';
      label += metricName(item.metric) + ' ' + number(item.value, 2);
      var sample = item.sampleRounds || item.samplePlayerRounds;
      return el('li', {}, [el('span', { text: label }), el('small', { text: 'evidence ' + text(item.id) + (sample ? ' · n=' + sample : '') })]);
    }));
  }

  function validatePlans(recommendations, evidence, manifest) {
    var ids = new Set(evidence.map(function (row) { return row.id; }));
    return recommendations.map(function (rec) { return Core.validateRecommendation(rec, manifest, ids); });
  }

  function mapFigure(rec) {
    var row = (rec.maps || []).filter(function (item) { return item.map === rec.pick; })[0] || (rec.maps || [])[0];
    if (!row) return el('p', { text: 'Нет данных по карте.' });
    var us = Math.max(0, Math.min(2, row.us.adjustedRating || 0));
    var them = Math.max(0, Math.min(2, row.opponent.adjustedRating || 0));
    var chartLabel = 'Скорректированный Rating на ' + mapName(row.map) + ': Ушибу ногами ' + number(us) + ', соперник ' + number(them);
    return el('figure', { class: 'stats-chart' }, [
      el('figcaption', {}, [el('strong', { text: 'Map edge · ' + mapName(row.map) }), el('span', { text: 'выборка ' + row.us.playerRounds + '/' + row.opponent.playerRounds + ' player-rounds · уверенность ' + confidence(row.confidence) })]),
      el('div', { class: 'stats-chart-graphic', role: 'img', 'aria-label': chartLabel }, el('div', { class: 'stats-bars' }, [
        el('div', { class: 'stats-bar stats-bar--ct' }, [el('span', { text: 'Мы' }), el('i', { style: '--value:' + (us / 2 * 100) + '%' }), el('b', { text: number(us) })]),
        el('div', { class: 'stats-bar stats-bar--t' }, [el('span', { text: 'Они' }), el('i', { style: '--value:' + (them / 2 * 100) + '%' }), el('b', { text: number(them) })])
      ])),
      el('details', {}, [el('summary', { text: 'Табличный эквивалент' }), el('table', { class: 'data', 'aria-label': 'Map edge · ' + mapName(row.map) }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Сторона' }), el('th', { text: 'Rating' }), el('th', { text: 'Выборка' })])),
        el('tbody', {}, [el('tr', {}, [el('td', { text: 'Ушибу ногами' }), el('td', { text: number(us) }), el('td', { text: String(row.us.playerRounds) })]), el('tr', {}, [el('td', { text: 'Соперник' }), el('td', { text: number(them) }), el('td', { text: String(row.opponent.playerRounds) })])])
      ])])
    ]);
  }

  function readiness(matchId) {
    var ids = TASKS.map(function (task) { return Core.scoutKey(matchId, task.id); });
    return { done: window.Store.countChecked(ids), total: ids.length };
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
    var ready = nearest ? readiness(nearest.matchId) : { done: 0, total: 0 };
    var main = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Проекция из индивидуальной статистики. Сыгранность пятёрок не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card(scheduleSelection.completedFallback ? 'Последний матч · расписание завершено' : 'Ближайший матч',
          nearest ? nextMatchCard(rosters, nearest) : el('p', { text: 'Нет данных · низкая уверенность' })),
        card('Готовность плана', el('div', {}, [el('p', { class: 'stats-big', text: ready.done + ' / ' + ready.total }), el('p', { text: 'общих задач закрыто' }), el('small', { text: 'Снимок по ' + manifest.window.recentEnd })])),
        card('Главный edge', nearest ? mapFigure(nearest) : el('p', { text: 'Нет данных' })),
        card('Угрозы', nearest ? evidenceList(nearest.threats, rosters) : el('p', { text: 'Нет данных' })),
        card('Как нас видят', el('div', {}, [
          el('p', { text: 'Зеркальный скаутинг: наш профиль глазами каждого из четырёх соперников.' }),
          routeLink('#/statistika/zerkalo', 'Открыть зеркальные отчёты')
        ])),
        card('Свежесть', el('div', {}, [
          el('p', { class: 'stats-mono', text: manifest.root.slice(0, 12) + '…' }),
          el('p', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd }),
          routeLink('#/statistika/quality', 'Открыть качество и provenance')
        ]))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Четыре плана матчей' }),
        el('div', { class: 'stats-plan-grid' }, plans.map(function (plan) {
          return routeLink(Core.href('match', plan.matchId), plan.date + ' · ' + rosterName(rosters, plan.opponentTeamId) + ' · pick ' + mapName(plan.pick), 'card stats-route-card');
        }))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Пять проекций составов' }),
        el('div', { class: 'stats-plan-grid' }, rosters.map(function (roster) {
          return routeLink(Core.href('team', roster.teamId), roster.name + ' · ' + roster.players.length + ' игроков', 'card stats-route-card');
        }))
      ]),
      directoryLinks(manifest)
    ]);
    return shell('Статистика', 'Операционная сводка', main, 'Готово: четыре плана и пять проекций составов');
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

  function teamView(data, route, manifest) {
    var roster = findBy(data.rosters, 'teamId', route.teamId);
    var metrics = findBy(data.teamMetrics, 'teamId', route.teamId);
    var edges = findBy(data.mapEdges, 'opponentTeamId', route.teamId);
    if (!roster || !metrics) return emptyView('Нет данных для команды ' + route.teamId);
    knownTeams[route.teamId] = true;
    var lineup = metrics.confirmedLineup || {};
    var recent = metrics.recent || {};
    var all = metrics.allTime || {};
    var isUs = route.teamId === 'us';
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Командные показатели — проекция индивидуальной статистики; сыгранность пятёрки не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Покрытие', el('div', {}, [el('p', { class: 'stats-big', text: roster.players.length + ' / 6' }), el('p', { text: 'игроков сопоставлено; top-5 считается отдельно' }), el('p', { text: lineup.confirmed ? 'Пятёрка подтверждена' : 'Подтверждённой пятёрки нет' })])),
        card('Recent / all-time', metricPairs(recent.metrics, all.metrics)),
        card('Публикация', el('div', {}, [el('p', { text: 'Draft avg ' + number(metrics.publishedDraftAverage, 3) }), el('p', { text: 'Draft top-5 ' + number(metrics.publishedDraftTop5Average, 3) }), el('small', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd })]))
      ]),
      el('section', { class: 'section' }, [el('h2', { text: 'Состав' }), el('div', { class: 'stats-plan-grid' }, roster.players.map(function (player) { return routeLink(Core.href('player', player.steamid), player.displayName + ' · draft ' + number(player.draftRating, 3), 'card stats-route-card'); }))]),
      isUs ? el('section', { class: 'section' }, [
        el('h2', { text: 'Map edges' }),
        el('p', { text: 'Наши edge считаются попарно против каждого соперника — они собраны в зеркальном скаутинге.' }),
        routeLink('#/statistika/zerkalo', 'Открыть «Как нас видят»')
      ]) : edgeTable(edges && edges.maps || []),
      scouting(metrics.scouting, data.rosters),
      planLinks(isUs ? data.recommendations : data.recommendations.filter(function (plan) { return plan.opponentTeamId === route.teamId; }), data.rosters)
    ]);
    return shell(roster.name, isUs ? 'Наша команда' : 'Профиль соперника', body, 'Готово: профиль ' + roster.name);
  }

  function metricPairs(recent, all) {
    recent = recent || {}; all = all || {};
    return el('dl', { class: 'stats-dl' }, ['rating', 'adr', 'kast', 'openingDiffPer100'].map(function (key) {
      return [el('dt', { text: metricName(key) }), el('dd', { text: number(recent[key]) + ' / ' + number(all[key]) })];
    }));
  }

  function edgeTable(rows) {
    return el('section', { class: 'section' }, [el('h2', { text: 'Map edges' }), el('div', { class: 'table-wrap', 'aria-label': 'Таблица map edges: прокрутите по горизонтали' }, el('table', { class: 'data', 'aria-label': 'Map edges' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: 'Карта' }), el('th', { text: 'Edge' }), el('th', { text: 'Мы n' }), el('th', { text: 'Они n' }), el('th', { text: 'Confidence' })])),
      el('tbody', {}, rows.map(function (row) { return el('tr', {}, [el('td', { text: mapName(row.map) }), el('td', { text: number(row.edge, 3) }), el('td', { text: String(row.us.playerRounds) }), el('td', { text: String(row.opponent.playerRounds) }), el('td', { text: confidence(row.confidence) })]); }))
    ]))]);
  }

  function scouting(value, rosters) {
    value = value || {};
    function metricCards(title, rows) {
      return card(title, el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, (rows || []).map(function (row) { return el('li', {}, [el('span', { text: metricName(row.metric) + ' · ' + number(row.value) }), el('small', { text: 'delta ' + number(row.delta) + ' · ' + row.evidenceId })]); })));
    }
    var threatRows = (value.ratingThreats || []).concat(value.openingLeader || []).concat(value.utilityLeader || []);
    return el('section', { class: 'section' }, [el('h2', { text: 'Угрозы, уязвимости и риски' }), el('div', { class: 'stats-hero-grid' }, [
      card('Угрозы', el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, threatRows.map(function (row) { return el('li', {}, [routeLink(Core.href('player', row.steamid), playerName(rosters, row.steamid)), el('small', { text: row.evidenceId })]); }))),
      metricCards('Уязвимости', value.exploits), metricCards('Риски', value.risks)
    ])]);
  }

  function planLinks(plans, rosters) {
    return el('section', { class: 'section' }, [el('h2', { text: 'Матчи' }), plans.length ? el('div', { class: 'stats-plan-grid' }, plans.map(function (plan) { return routeLink(Core.href('match', plan.matchId), plan.date + ' · полный план против ' + rosterName(rosters, plan.opponentTeamId), 'card stats-route-card'); })) : el('p', { text: 'Нет данных' })]);
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

  function matchView(data, route, manifest) {
    var plan = findBy(data.recommendations, 'matchId', route.matchId);
    if (!plan) {
      var source = findBy(data.matches, 'matchId', route.matchId);
      return source ? sourceMatchView(source) : emptyView('Матч ' + route.matchId + ' не найден');
    }
    validatePlans([plan], data.evidence, manifest);
    knownMatches[plan.matchId] = true;
    var opponent = rosterName(data.rosters, plan.opponentTeamId);
    var tasks = el('div', { class: 'stats-tasks' }, TASKS.map(function (task) {
      var key = Core.scoutKey(plan.matchId, task.id);
      return el('div', { class: 'stats-task' }, [U.check(key, task.label), U.noteField(key, 'Общая заметка', 'Короткая договорённость по задаче…')]);
    }));
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'План read-only. Командные числа — проекция игроков; сыгранность не измерена.' }),
      rosterBlock(data.rosters, plan.opponentTeamId, plan.threats),
      el('div', { class: 'stats-veto-strip' }, [veto('Pick', plan.pick, 'ct'), veto('Ban', plan.ban, 'signal'), veto('Backup', (plan.backup || []).map(mapName).join(' / '), 'ghost')]),
      card('Contingency', el('p', { text: plan.contingency })),
      simpleTableSection('Цифры по картам', ['Карта', 'Edge', 'Наш Rating', 'Их Rating', 'Наши раунды', 'Их раунды', 'Confidence'], (plan.maps || []).map(function (row) {
        return [mapName(row.map), number(row.edge, 3), number(row.us && row.us.adjustedRating, 3), number(row.opponent && row.opponent.adjustedRating, 3), text(row.us && row.us.playerRounds), text(row.opponent && row.opponent.playerRounds), confidence(row.confidence)];
      })),
      (plan.mapOverrides || []).length ? simpleTableSection('Ручные решения по картам', ['Решение', 'Карта', 'Обоснование', 'Evidence'], plan.mapOverrides.map(function (row) {
        return [text(row.action), mapName(row.map), text(row.rationale), (row.evidenceIds || []).join(', ')];
      })) : null,
      el('div', { class: 'stats-hero-grid' }, [card('Угрозы', evidenceList(plan.threats, data.rosters)), card('Уязвимости', evidenceList(plan.weaknesses, data.rosters)), card('Confidence', el('div', {}, [el('p', { class: 'stats-big', text: confidence(plan.confidence) }), el('p', { text: 'reviewed ' + plan.reviewedAt + ' · data through ' + plan.dataThrough })]))]),
      el('div', { class: 'stats-hero-grid' }, [listCard('Делать', plan.do), listCard('Не делать', plan.dont), listCard('Ограничения', (plan.caveats || []).map(function (row) { return row.text; }))]),
      el('section', { class: 'section' }, [el('h2', { text: 'Чеклист тренировки' }), simpleList(plan.trainingChecklist || [])]),
      el('section', { class: 'section' }, [el('h2', { text: 'Чеклист матч-дня' }), simpleList(plan.matchdayChecklist || [])]),
      el('section', { class: 'section' }, [el('h2', { text: 'Общие задачи' }), tasks, el('p', { class: 'stats-sync-note', text: 'Сохраняется в командное состояние; одновременное редактирование одной заметки — last write wins.' })]),
      el('section', { class: 'section' }, [el('h2', { text: 'Личные задачи в плане (read-only)' }), simpleList((plan.personalTasks || []).map(function (task) { return task.draftName + ': ' + task.task; }))]),
      el('section', { class: 'section', 'data-evidence': 'true' }, [el('h2', { text: 'Evidence IDs' }), simpleList(Core.recommendationEvidenceIds(plan))])
    ]);
    return shell('План матча · ' + opponent, plan.date + ' / ' + plan.matchId, body, 'Готово: reviewed план матча ' + plan.matchId);
  }

  function veto(label, value, type) { return el('div', { class: 'stats-veto stats-veto--' + type }, [el('span', { text: label }), el('strong', { text: Array.isArray(value) ? value.map(mapName).join(' / ') : mapName(value) })]); }
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
    return sortableView('Карты', '46 карт / aggregate', rows, { defaultKey: 'n', search: function (row) { return row.map; }, name: function (row) { return mapName(row.map); }, columns: [
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
    return sortableView('Оружие', '39 видов оружия / aggregate', rows, { defaultKey: 'kills', search: function (row) { return row.weapon; }, name: function (row) { return row.weapon; }, columns: [
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
    return sortableView('Тренды', '20 профилей / recent movement', rows, { defaultKey: 'roundsTotal', search: function (row) { return row.name + ' ' + row.steamid; }, name: function (row) { return row.name; }, columns: [
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

  /* --- Зеркальный скаутинг: наш профиль со стороны каждого соперника --- */

  var MIRROR_KINDS = { rating: 'рейтинг', opening: 'открытия', utility: 'утилита' };
  // Порог показа, а не порог пайплайна: на отдельной карте 200 раундов недостижимы,
  // поэтому значения на тонкой выборке приглушаем, но не прячем.
  var MIRROR_MAP_ROUNDS_FLOOR = 100;
  var MIRROR_CAVEATS = {
    'limitation:cohesion': 'Сыгранность пятёрки не измерена: источник не знает сущности «команда», все командные числа — проекция из индивидуальной статистики.',
    'limitation:positions': 'Позиции и раскидки в источнике недоступны, поэтому противник видит только агрегаты, а не наши расстановки.',
    'confirmed-lineup:us': 'Подтверждённых матчей нашей пятёркой в снимке нет — как мы играем составом, не видно ни им, ни нам.'
  };

  function signed(value, digits) {
    return typeof value === 'number' && Number.isFinite(value)
      ? (value > 0 ? '+' : '') + value.toFixed(digits == null ? 3 : digits) : 'Нет данных';
  }

  function mirrorEdgeClass(row) {
    if (!row || !row.significant) return 'stats-mirror--flat';
    return row.mirrorEdge > 0 ? 'stats-mirror--theirs' : 'stats-mirror--ours';
  }

  function mirrorOrder(mirrors) {
    return mirrors.slice().sort(function (a, b) {
      var left = a.ourPlan ? a.ourPlan.date : '9999-99-99';
      var right = b.ourPlan ? b.ourPlan.date : '9999-99-99';
      return left.localeCompare(right) || a.opponentTeamId.localeCompare(b.opponentTeamId);
    });
  }

  function mirrorLead(teamMetrics, us) {
    var rounds = us.recent && us.recent.sums ? us.recent.sums.rounds : 0;
    var thickest = teamMetrics.reduce(function (max, team) {
      return Math.max(max, team.recent && team.recent.sums ? team.recent.sums.rounds : 0);
    }, 0);
    var lineup = us.confirmedLineup || {};
    return el('p', { class: 'lead stats-caveat', text: 'Наш профиль глазами соперника: те же публичные цифры, но с их стороны. '
      + 'Командные показатели — проекция индивидуальной статистики шести игроков, сыгранность не измерена'
      + (lineup.confirmed ? '.' : '; подтверждённой пятёрки у нас нет.')
      + ' Наша выборка — ' + rounds + ' player-раундов против ' + thickest + ' у самой «толстой» команды лиги, поэтому наши числа шумнее.' });
  }

  function mirrorRankList(rows, us) {
    return el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, (rows || []).map(function (row) {
      var rank = (us.scouting && us.scouting.leagueRanks || {})[row.metric];
      return el('li', {}, [
        el('span', { text: metricName(row.metric) + ' · ' + number(row.value) }),
        el('small', { text: (rank ? rank.rank + '-е из ' + rank.of + ' · ' : '')
          + (row.delta === 0 ? 'ровно на медиане лиги' : 'к медиане ' + signed(row.delta)) + ' · ' + row.evidenceId })
      ]);
    }));
  }

  function mirrorTargets(title, rows, rosters, note) {
    return card(title, el('div', {}, [
      el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, (rows || []).map(function (row) {
        return el('li', {}, [
          el('span', {}, [
            routeLink(Core.href('player', row.steamid), playerName(rosters, row.steamid)),
            ' · ' + MIRROR_KINDS[row.kind] + ' ' + number(row.value)
          ]),
          el('small', { text: row.sampleRounds + ' раундов · ' + row.evidenceId })
        ]);
      })),
      el('small', { class: 'stats-sync-note', text: note })
    ]));
  }

  function mirrorVetoLine(mirror) {
    return (mirror.likelyPick ? 'вероятный пик — ' + mapName(mirror.likelyPick) : 'нет карты, где они сильнее нас')
      + ' · ' + (mirror.likelyBan ? 'вероятный бан — ' + mapName(mirror.likelyBan) : 'нет карты, где мы сильнее них');
  }

  function mirrorMatrix(mirrors) {
    var maps = mirrors[0].maps.map(function (row) { return row.map; }).sort();
    var byTeam = mirrors.map(function (mirror) {
      var index = Object.create(null);
      mirror.maps.forEach(function (row) { index[row.map] = row; });
      return { mirror: mirror, index: index };
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Матрица вето их глазами' }),
      el('p', { class: 'stats-sync-note', text: 'Плюс — карта в пользу соперника, минус — в нашу. Жирным выделены значимые расхождения (|edge| ≥ 0.03).' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Матрица зеркальных map edge: прокрутите по горизонтали' },
        el('table', { class: 'data stats-mirror-matrix', 'aria-label': 'Зеркальные map edge по соперникам' }, [
          el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: 'Карта' })].concat(byTeam.map(function (entry) {
            return el('th', { scope: 'col', text: entry.mirror.opponentName });
          })))),
          el('tbody', {}, maps.map(function (map) {
            return el('tr', {}, [el('th', { scope: 'row', text: mapName(map) })].concat(byTeam.map(function (entry) {
              var row = entry.index[map];
              return el('td', { class: mirrorEdgeClass(row), text: row ? signed(row.mirrorEdge) : 'Нет данных' });
            })));
          }))
        ]))
    ]);
  }

  function mirrorView(data, manifest) {
    var rosters = data.rosters;
    var us = findBy(data.teamMetrics, 'teamId', 'us');
    var mirrors = mirrorOrder(data.mirrorScouting || []);
    if (!us || !mirrors.length) return emptyView('Зеркальный скаутинг недоступен в этом снимке');
    rosters.forEach(function (row) { knownTeams[row.teamId] = true; });
    var ranks = (us.scouting && us.scouting.leagueRanks) || {};
    var ratingRank = ranks.rating;
    var lineup = us.confirmedLineup || {};
    var contested = mirrors.filter(function (mirror) { return mirror.clash && mirror.clash.pickContested; });
    var main = el('div', { class: 'stats-stack' }, [
      mirrorLead(data.teamMetrics, us),
      el('div', { class: 'stats-hero-grid' }, [
        card('Наш профиль в лиге', el('div', {}, [
          el('p', { class: 'stats-big', text: number(us.recent.metrics.rating) }),
          el('p', { text: 'Rating 2' + (ratingRank ? ' · ' + ratingRank.rank + '-е место из ' + ratingRank.of : '') }),
          el('small', { text: 'ADR ' + number(us.recent.metrics.adr, 1) + ' · KAST ' + percent(us.recent.metrics.kast) })
        ])),
        card('Что они видят сильным', mirrorRankList(us.scouting && us.scouting.risks, us)),
        card('Что они будут атаковать', mirrorRankList(us.scouting && us.scouting.exploits, us)),
        card('Чего они про нас не знают', el('ul', { class: 'stats-list' }, [
          el('li', { text: lineup.confirmed ? 'Пятёрка подтверждена' : 'Ни одного матча подтверждённой пятёркой — сыгранность не видна никому' }),
          el('li', { text: 'Позиции и раскидки в источнике недоступны' }),
          el('li', { text: 'История вето соперников не наблюдалась ни разу' })
        ]))
      ]),
      contested.length ? el('p', { class: 'stats-caveat', text: 'Внимание: у ' + contested.length + ' из ' + mirrors.length
        + ' соперников наш плановый пик совпадает с их наиболее вероятным баном — ' + contested.map(function (mirror) { return mirror.opponentName; }).join(', ') + '.' }) : null,
      mirrorMatrix(mirrors),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Четыре зеркальных отчёта' }),
        el('div', { class: 'stats-plan-grid' }, mirrors.map(function (mirror) {
          return routeLink(Core.href('mirror', mirror.opponentTeamId),
            mirror.opponentName + ' · ' + mirrorVetoLine(mirror), 'card stats-route-card');
        }))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Кого они видят в нашем составе' }),
        el('div', { class: 'stats-hero-grid' }, [
          mirrorTargets('Угрозы', mirrors[0].focusTargets, rosters, 'Топ-2 по рейтингу плюс лидеры по открытиям и утилите. Один игрок может закрывать несколько векторов.'),
          mirrorTargets('Цели для размена', mirrors[0].softTargets, rosters, 'Худшие по рейтингу и по разнице открытий среди игроков с выборкой от ' + mirrors[0].sufficientSampleRounds + ' раундов.')
        ])
      ]),
      el('p', { class: 'stats-sync-note', text: 'Снимок по ' + manifest.window.recentEnd + ' · окно ' + manifest.window.recentStart + ' — ' + manifest.window.recentEnd })
    ]);
    return shell('Как нас видят', 'Зеркальный скаутинг', main, 'Готово: зеркальный профиль и ' + mirrors.length + ' отчёта соперников');
  }

  function mirrorMapTable(mirror) {
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Вето их глазами' }),
      el('p', { class: 'stats-sync-note', text: 'Сверху — карты, которые выгодны сопернику. Вето соперников не наблюдалось, это проекция силы на карте, а не история пиков.' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Таблица зеркальных map edge: прокрутите по горизонтали' },
        el('table', { class: 'data stats-mirror-maps', 'aria-label': 'Зеркальные map edge' }, [
          el('thead', {}, el('tr', {}, ['Карта', 'Edge для них', 'Мы', 'Они', 'Наши раунды', 'Их раунды', 'Confidence'].map(function (head) {
            return el('th', { scope: 'col', text: head });
          }))),
          el('tbody', {}, mirror.maps.map(function (row) {
            return el('tr', {}, [
              el('th', { scope: 'row', text: mapName(row.map) }),
              el('td', { class: mirrorEdgeClass(row), text: signed(row.mirrorEdge) }),
              el('td', { text: number(row.usAdjustedRating) }),
              el('td', { text: number(row.opponentAdjustedRating) }),
              el('td', { text: String(row.usPlayerRounds) }),
              el('td', { text: String(row.opponentPlayerRounds) }),
              el('td', { text: confidence(row.confidence) })
            ]);
          }))
        ]))
    ]);
  }

  function mirrorMetricTable(mirror) {
    var worse = mirror.metricEdges.filter(function (row) { return row.delta < 0; });
    var better = mirror.metricEdges.filter(function (row) { return row.delta > 0; }).reverse();
    function list(rows, empty) {
      return rows.length ? el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, rows.slice(0, 3).map(function (row) {
        return el('li', {}, [
          el('span', { text: metricName(row.metric) + ' · мы ' + number(row.usValue) + ' / они ' + number(row.opponentValue) }),
          el('small', { text: signed(row.delta) + ' · ' + row.usEvidenceId + ' · ' + row.opponentEvidenceId })
        ]);
      })) : el('p', { text: empty });
    }
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Мы против них' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Что они будут эксплуатировать', list(worse, 'Ни по одной метрике мы им не уступаем')),
        card('Чего они опасаются', list(better, 'Ни по одной метрике мы их не превосходим'))
      ])
    ]);
  }

  function mirrorPickTable(mirror, players, rosters) {
    // Значимого пика может не быть вовсе; тогда берём лучшую для них карту пула и помечаем это.
    var focus = mirror.likelyPick || (mirror.maps[0] && mirror.maps[0].map);
    if (!focus) return null;
    var note = mirror.likelyPick
      ? 'Карта, где соперник статистически сильнее нас.'
      : 'Значимого перевеса у соперника нет ни на одной карте; это лучшая для них карта пула, расхождение незначимо.';
    var rows = players.map(function (player) {
      var window = (player.maps && player.maps.recent && player.maps.recent[focus]) || null;
      return {
        steamid: player.steamid,
        rating: window ? window.metrics.rating : null,
        rounds: window ? window.sums.rounds : 0
      };
    }).sort(function (a, b) {
      if (a.rating === null) return 1;
      if (b.rating === null) return -1;
      return b.rating - a.rating;
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Наши шесть на ' + mapName(focus) }),
      el('p', { class: 'stats-sync-note', text: note + ' Rating 2 на одной карте считается по десяткам раундов: значения на выборке меньше '
        + MIRROR_MAP_ROUNDS_FLOOR + ' раундов приглушены — это ориентир, а не оценка.' }),
      el('div', { class: 'table-wrap', 'aria-label': 'Таблица нашего состава на вероятном пике соперника' },
        el('table', { class: 'data', 'aria-label': 'Наш состав на вероятном пике соперника' }, [
          el('thead', {}, el('tr', {}, ['Игрок', 'Rating 2', 'Раундов'].map(function (head) { return el('th', { scope: 'col', text: head }); }))),
          el('tbody', {}, rows.map(function (row) {
            return el('tr', {}, [
              el('th', { scope: 'row' }, routeLink(Core.href('player', row.steamid), playerName(rosters, row.steamid))),
              el('td', { class: row.rounds >= MIRROR_MAP_ROUNDS_FLOOR ? null : 'stats-mirror--flat', text: number(row.rating) }),
              el('td', { class: row.rounds >= MIRROR_MAP_ROUNDS_FLOOR ? null : 'stats-mirror--flat', text: row.rounds ? String(row.rounds) : 'Нет данных' })
            ]);
          }))
        ]))
    ]);
  }

  function mirrorTeamView(data, route, manifest) {
    var mirror = findBy(data.mirrorScouting || [], 'opponentTeamId', route.teamId);
    if (!mirror) return emptyView('Зеркальный отчёт для команды ' + route.teamId + ' недоступен');
    var rosters = data.rosters;
    rosters.forEach(function (row) { knownTeams[row.teamId] = true; });
    var players = (data.playerMetrics || []).filter(function (player) { return player.teamId === 'us'; });
    var plan = mirror.ourPlan;
    var clash = mirror.clash || {};
    var evidenceById = Object.create(null);
    (data.evidence || []).forEach(function (item) { evidenceById[item.id] = item; });
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Проекция из индивидуальной статистики; сыгранность пятёрки не измерена. '
        + 'Наши ' + mirror.sample.usPlayerRounds + ' player-раундов против их ' + mirror.sample.opponentPlayerRounds + '.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Их вероятный пик', el('div', {}, [
          el('p', { class: 'stats-big', text: mirror.likelyPick ? mapName(mirror.likelyPick) : '—' }),
          el('p', { text: mirror.likelyPick ? 'карта, где они статистически сильнее нас' : 'нет карты, где они статистически сильнее нас' })
        ])),
        card('Их вероятный бан', el('div', {}, [
          el('p', { class: 'stats-big', text: mirror.likelyBan ? mapName(mirror.likelyBan) : '—' }),
          el('p', { text: mirror.likelyBan ? 'карта, где мы статистически сильнее' : 'нет карты, где мы статистически сильнее' })
        ])),
        card('Наш план против них', plan ? el('div', {}, [
          el('p', { text: 'Пик ' + mapName(plan.pick) + ' · бан ' + mapName(plan.ban) }),
          el('p', { text: 'Наш пик их глазами: ' + signed(clash.ourPickMirrorEdge) }),
          routeLink(Core.href('match', plan.matchId), plan.date + ' · полный план матча')
        ]) : el('p', { text: 'Нет данных' })),
        card('Столкновение', el('ul', { class: 'stats-list' }, [
          el('li', { text: clash.pickContested ? 'Наш пик ' + mapName(plan.pick) + ' — их наиболее вероятный бан' : 'Наш пик не совпадает с их вероятным баном' }),
          el('li', { text: clash.banConfirmed ? 'Наш бан бьёт по их вероятному пику' : 'Наш бан не совпадает с их вероятным пиком' })
        ]))
      ]),
      mirrorMapTable(mirror),
      mirrorPickTable(mirror, players, rosters),
      mirrorMetricTable(mirror),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Кого они видят в нашем составе' }),
        el('div', { class: 'stats-hero-grid' }, [
          mirrorTargets('Угрозы', mirror.focusTargets, rosters, 'Топ-2 по рейтингу плюс лидеры по открытиям и утилите.'),
          mirrorTargets('Цели для размена', mirror.softTargets, rosters, 'Худшие по рейтингу и по разнице открытий среди игроков с выборкой от ' + mirror.sufficientSampleRounds + ' раундов.')
        ])
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Чего они не могут увидеть' }),
        el('ul', { class: 'stats-evidence', 'data-evidence': 'true' }, mirror.caveatEvidenceIds.map(function (id) {
          var item = evidenceById[id] || {};
          return el('li', {}, [
            el('span', { text: MIRROR_CAVEATS[id] || text(item.kind, id) }),
            el('small', { text: 'значение ' + text(item.value === undefined ? null : String(item.value)) + ' · ' + id })
          ]);
        }))
      ]),
      el('p', { class: 'stats-sync-note', text: 'Снимок по ' + manifest.window.recentEnd }),
      routeLink('#/statistika/zerkalo', 'Ко всем зеркальным отчётам')
    ]);
    return shell('Нас глазами «' + mirror.opponentName + '»', 'Зеркальный отчёт', body, 'Готово: зеркальный отчёт против ' + mirror.opponentName);
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
    if (route.view === 'mirror') return mirrorView(data, state.manifest);
    if (route.view === 'mirrorTeam') return mirrorTeamView(data, route, state.manifest);
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

  window.Stats = {
    open: open,
    href: Core.href,
    hasTeam: function (teamId) { return knownTeams[teamId] === true; },
    hasMatch: function (matchId) { return knownMatches[matchId] === true; },
    retry: retryOpen
  };
})();
