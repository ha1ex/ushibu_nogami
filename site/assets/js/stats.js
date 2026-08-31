/* Lazy, authenticated Whoajor dashboard. Remote values are always rendered as text. */
(function () {
  'use strict';

  var U = window.UI;
  var Core = window.StatsCore;
  var el = U.el;
  var activeController = null;
  var requestToken = 0;
  var currentRoute = null;
  var canonicalMaps = [];
  var focusNext = false;
  var knownTeams = Object.create(null);
  var knownMatches = Object.create(null);
  var client = Core.createClient(function (url, options) {
    var next = Object.assign({}, options || {});
    if (activeController) next.signal = activeController.signal;
    return window.fetch(url, next);
  });

  var METRICS = {
    rating: 'Rating 2', adr: 'ADR', kd: 'K/D', kast: 'KAST', roundWinRate: 'Победы в раундах',
    openingDiffPer100: 'Разница открытий / 100', utilityDamagePerRound: 'Utility damage / раунд',
    flashAssistsPer100: 'Флеш-ассисты / 100', tradeRate: 'Размены', retakeWinRate: 'Ретейки',
    postplantWinRate: 'Постплент', clutchWinRate: 'Клатчи', forceWinRate: 'Форсы',
    fullWinRate: 'Full-buy', pistolWinRate: 'Пистолетные', tRoundWinRate: 'T-раунды', ctRoundWinRate: 'CT-раунды'
  };
  var WEAPONS = {
    ak47: 'AK-47', aug: 'AUG', awp: 'AWP', bizon: 'ПП-19 Бизон', cz75a: 'CZ75-Auto', deagle: 'Desert Eagle',
    elite: 'Dual Berettas', famas: 'FAMAS', fiveseven: 'Five-SeveN', g3sg1: 'G3SG1', galilar: 'Galil AR',
    glock: 'Glock-18', hegrenade: 'Осколочная граната', hkp2000: 'P2000', inferno: 'Огонь', knife: 'Нож',
    m249: 'M249', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', mac10: 'MAC-10', mag7: 'MAG-7', molotov: 'Коктейль Молотова',
    mp5sd: 'MP5-SD', mp7: 'MP7', mp9: 'MP9', negev: 'Negev', nova: 'Nova', p250: 'P250', p90: 'P90',
    revolver: 'R8 Revolver', sawedoff: 'Sawed-Off', scar20: 'SCAR-20', sg556: 'SG 553', ssg08: 'SSG 08',
    taser: 'Zeus x27', tec9: 'Tec-9', ump45: 'UMP-45', usp_silencer: 'USP-S', xm1014: 'XM1014'
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
  function weaponName(value) { return WEAPONS[value] || 'Неизвестное оружие'; }

  function routeLink(href, label, className) {
    return el('a', { href: href, class: className || 'stats-link', text: label });
  }

  function live(message) {
    return el('p', { class: 'stats-live sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', text: message });
  }

  function statsNav() {
    return el('nav', { class: 'stats-nav', 'aria-label': 'Разделы данных' }, [
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
    var names = { overview: 'Данные', team: 'Профиль состава', player: 'Профиль игрока', match: 'Исходный матч', maps: 'Карты', weapons: 'Оружие', trends: 'Тренды', quality: 'Качество данных' };
    return shell(names[route.view] || 'Данные', 'Загрузка проверенных данных',
      el('div', { class: 'stats-state', 'aria-busy': 'true' }, [el('span', { class: 'stats-loader', 'aria-hidden': 'true' }), el('p', { text: 'Проверяем целостность снимка…' })]),
      'Загрузка данных');
  }

  function errorView(error) {
    var retry = el('button', { type: 'button', class: 'stats-retry', text: 'Повторить загрузку' });
    retry.addEventListener('click', retryOpen);
    return shell('Данные недоступны', 'Локальная ошибка данных',
      el('div', { class: 'stats-state stats-state--error' }, [
        el('p', { text: 'Снимок скрыт: проверка источника не пройдена.' }),
        el('p', { class: 'stats-mono', text: text(error && error.message, 'Неизвестная ошибка') }), retry
      ]), 'Ошибка данных. Остальные разделы штаба доступны.');
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
    var labels = { high: 'высокая', medium: 'средняя', low: 'низкая' };
    return labels[value] || 'не указана';
  }

  function chip(label, type) { return el('span', { class: 'chip chip--' + (type || 'ghost'), text: label }); }

  function card(title, body, className) {
    return el('article', { class: 'card stats-card' + (className ? ' ' + className : '') }, [el('h2', { text: title }), body]);
  }

  function overviewView(data, manifest) {
    var rosters = data.rosters;
    rosters.forEach(function (row) { knownTeams[row.teamId] = true; });
    var main = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Снимок по 30.08.2026. Проекция из индивидуальных данных игроков; сыгранность пятёрок не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Составы', el('div', {}, [el('p', { class: 'stats-big', text: String(rosters.length) }), el('p', { text: 'проекций ростеров в снимке' })])),
        card('Игроки', el('div', {}, [el('p', { class: 'stats-big', text: String(manifest.counts.players) }), el('p', { text: 'игроков в каталоге' })])),
        card('Исходные матчи', el('div', {}, [el('p', { class: 'stats-big', text: String(manifest.counts.matches) }), el('p', { text: 'матчей доступны для проверки' })])),
        card('Окно данных', el('div', {}, [el('p', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd }), routeLink('#/statistika/quality', 'Открыть качество данных')]))
      ]),
      el('section', { class: 'section' }, [
        el('h2', { text: 'Пять проекций составов' }),
        el('div', { class: 'stats-plan-grid' }, rosters.map(function (roster) {
          return routeLink(Core.href('team', roster.teamId), roster.name + ' · ' + roster.players.length + ' игроков', 'card stats-route-card');
        }))
      ]),
      directoryLinks(manifest),
      technicalDetails(manifest)
    ]);
    return shell('Данные', 'Whoajor / нейтральный снимок', main, 'Готово: нейтральный каталог данных');
  }

  function technicalDetails(manifest, rows) {
    return el('details', { class: 'stats-diagnostics' }, [
      el('summary', { text: 'Техническая диагностика' }),
      el('dl', { class: 'stats-dl' }, [
        el('dt', { text: 'Root' }), el('dd', { class: 'stats-mono', text: manifest.root }),
        el('dt', { text: 'Версия' }), el('dd', { class: 'stats-mono', text: manifest.version }),
        el('dt', { text: 'Проверка' }), el('dd', { text: 'Manifest и assets проверяются по SHA-256' })
      ]),
      rows || null
    ]);
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
      routeLink('#/statistika/maps', canonicalMaps.length + ' карт в пуле'),
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
        U.mount(host, el('div', { class: 'stats-directory-grid' }, rows.map(function (row) { return routeLink(Core.href('player', row.steamid), row.displayName); })));
      } else {
        rows.forEach(function (row) { knownMatches[row.matchId] = true; });
        U.mount(host, el('div', { class: 'stats-directory-grid' }, rows.map(function (row) { return routeLink(Core.href('match', row.matchId), U.fmtFull(row.startedAt) + ' · ' + mapName(row.map)); })));
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
    var body = el('div', { class: 'stats-stack' }, [
      el('p', { class: 'lead stats-caveat', text: 'Командные показатели — проекция индивидуальной статистики; сыгранность пятёрки не измерена.' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Покрытие', el('div', {}, [el('p', { class: 'stats-big', text: roster.players.length + ' / 6' }), el('p', { text: 'игроков сопоставлено; top-5 считается отдельно' }), el('p', { text: lineup.confirmed ? 'Пятёрка подтверждена' : 'Подтверждённой пятёрки нет' })])),
        card('Rating', ratingMeters(recent.metrics, all.metrics)),
        card('Публикация', el('div', {}, [el('p', { text: 'Draft avg ' + number(metrics.publishedDraftAverage, 3) }), el('p', { text: 'Draft top-5 ' + number(metrics.publishedDraftTop5Average, 3) }), el('small', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd })]))
      ]),
      el('section', { class: 'section' }, [el('h2', { text: 'Состав' }), el('div', { class: 'stats-plan-grid' }, roster.players.map(function (player) { return routeLink(Core.href('player', player.steamid), player.displayName + ' · draft ' + number(player.draftRating, 3), 'card stats-route-card'); }))]),
      metricTable(recent.metrics, all.metrics),
      edgeTable(edges && edges.maps || []),
      technicalDetails(manifest, el('p', { class: 'stats-mono', text: 'teamId: ' + route.teamId }))
    ]);
    return shell(roster.name, 'Проекция состава', body, 'Готово: профиль ' + roster.name);
  }

  function metricTable(recent, all) {
    recent = recent || {}; all = all || {};
    return simpleTableSection('Показатели команды', ['Метрика', 'Последнее окно', 'За всё время'], ['rating', 'adr', 'kast', 'openingDiffPer100'].map(function (key) {
      return [metricName(key), number(recent[key]), number(all[key])];
    }));
  }

  function ratingMeters(recent, all) {
    recent = recent || {}; all = all || {};
    return el('div', { class: 'stats-bars' }, [
      el('div', { class: 'stats-bar stats-bar--ct' }, [el('span', { text: 'Последнее окно' }), el('meter', { min: '0', max: '2', value: String(recent.rating || 0), text: number(recent.rating) }), el('b', { text: number(recent.rating) })]),
      el('div', { class: 'stats-bar stats-bar--t' }, [el('span', { text: 'За всё время' }), el('meter', { min: '0', max: '2', value: String(all.rating || 0), text: number(all.rating) }), el('b', { text: number(all.rating) })])
    ]);
  }

  function edgeTable(rows) {
    rows = Core.canonicalMapRows(rows, canonicalMaps, true);
    if (!rows.length) {
      return el('section', { class: 'section' }, [
        el('h2', { text: 'Сравнение по картам' }),
        el('p', { text: 'Нет карт текущего пула с наблюдениями у обеих сторон.' })
      ]);
    }
    return el('section', { class: 'section' }, [el('h2', { text: 'Сравнение по картам' }), el('div', { class: 'table-wrap', 'aria-label': 'Таблица сравнения карт: прокрутите по горизонтали' }, el('table', { class: 'data', 'aria-label': 'Сравнение по картам' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: 'Карта' }), el('th', { text: 'Разница Rating' }), el('th', { text: 'Наша выборка, раундов' }), el('th', { text: 'Их выборка, раундов' }), el('th', { text: 'Уверенность' })])),
      el('tbody', {}, rows.map(function (row) { return el('tr', {}, [el('td', { text: row.canonicalName }), el('td', { text: number(row.edge, 3) }), el('td', { text: String(row.us.playerRounds) }), el('td', { text: String(row.opponent.playerRounds) }), el('td', { text: confidence(row.confidence) })]); }))
    ]))]);
  }

  function playerView(data, route, manifest) {
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
      roster ? routeLink(Core.href('team', roster.teamId), 'Вернуться к составу ' + roster.name) : el('p', { text: 'Команда не сопоставлена' }),
      el('div', { class: 'stats-hero-grid' }, [
        card('Последнее окно / всё время', metric ? metricPairs(metric.recent.metrics, metric.allTime.metrics) : metricPairs({ rating: raw.rating2, adr: raw.adr, kast: raw.kast_pct / 100 }, {})),
        card('Стороны', metric && metric.recent.metrics ? sideFigure(metric.recent.metrics.sides, metric.recent.sums.rounds) : el('p', { text: 'Нет данных' })),
        card('Выборка', el('div', {}, [el('p', { class: 'stats-big', text: String(metric ? metric.recent.sums.rounds : raw.rounds_played) }), el('p', { text: 'раундов в последнем окне' })]))
      ]),
      playerMapTable(maps), playerWeaponTable(weapons), trendTable(trends), playerClutchTable(data.playerClutches || []),
      technicalDetails(manifest, el('p', { class: 'stats-mono', text: 'steamid: ' + route.steamid }))
    ]);
    return shell(name, 'Профиль игрока', body, 'Готово: профиль ' + name);
  }

  function metricPairs(recent, all) {
    recent = recent || {}; all = all || {};
    return el('dl', { class: 'stats-dl' }, ['rating', 'adr', 'kast', 'openingDiffPer100'].map(function (key) {
      return [el('dt', { text: metricName(key) }), el('dd', { text: number(recent[key]) + ' / ' + number(all[key]) })];
    }));
  }

  function sideFigure(sides, sample) {
    sides = sides || {};
    var t = sides.T || {}, ct = sides.CT || {};
    return el('figure', { class: 'stats-chart', 'aria-label': 'Rating игрока: T ' + number(t.rating) + ', CT ' + number(ct.rating) }, [
      el('figcaption', {}, [el('strong', { text: 'T / CT split' }), el('span', { text: 'n=' + sample + ' раундов; стороны различаются буквами и цветом' })]),
      el('div', { class: 'stats-bars' }, [
        el('div', { class: 'stats-bar stats-bar--t' }, [el('span', { text: 'T' }), el('meter', { min: '0', max: '2', value: String(t.rating || 0), text: number(t.rating) }), el('b', { text: number(t.rating) })]),
        el('div', { class: 'stats-bar stats-bar--ct' }, [el('span', { text: 'CT' }), el('meter', { min: '0', max: '2', value: String(ct.rating || 0), text: number(ct.rating) }), el('b', { text: number(ct.rating) })])
      ])
    ]);
  }

  function playerMapTable(rows) {
    rows = Core.canonicalMapRows(rows, canonicalMaps, false);
    return simpleTableSection('Карты игрока', ['Карта', 'Rating', 'Раунды'], rows.slice(0, 46).map(function (item) {
      var value = item.value || {}, metrics = value.metrics || value, sums = value.sums || value;
      return [item.canonicalName, number(metrics.rating || metrics.rating2), text(sums.rounds || sums.rounds_played)];
    }));
  }

  function playerWeaponTable(rows) {
    return simpleTableSection('Оружие игрока', ['Оружие', 'Убийства', 'Выстрелы'], rows.map(function (row) { return [weaponName(row.weapon), text(row.kills), text(row.shots)]; }));
  }

  function trendTable(rows) {
    return simpleTableSection('Последние матчи тренда', ['Дата', 'Карта', 'Rating'], rows.map(function (row) { return [U.fmtFull(row.startedAt), mapName(row.map), number(row.rating2)]; }));
  }

  function playerClutchTable(rows) {
    return simpleTableSection('Клатчи игрока', ['Раунд', 'Против', 'Убийства', 'Победа', 'Выжил'], rows.map(function (row) {
      return [row.round, '1v' + row.vs, row.kills, row.won ? 'Да' : 'Нет', row.survived ? 'Да' : 'Нет'];
    }));
  }

  function simpleTableSection(title, heads, rows) {
    return el('section', { class: 'section' }, [el('h2', { text: title }), rows.length ? el('div', { class: 'table-wrap', 'aria-label': 'Таблица ' + title + ': прокрутите по горизонтали' }, el('table', { class: 'data', 'aria-label': title }, [
      el('thead', {}, el('tr', {}, heads.map(function (head) { return el('th', { text: head }); }))),
      el('tbody', {}, rows.map(function (row) { return el('tr', {}, row.map(function (cell) { return el('td', { text: text(cell) }); })); }))
    ])) : el('p', { text: 'Нет данных' })]);
  }

  function matchView(data, route, manifest) {
    var source = findBy(data.matches, 'matchId', route.matchId);
    return source ? sourceMatchView(source, manifest) : emptyView('Исходный матч не найден');
  }

  function simpleList(rows) { return rows.length ? el('ul', { class: 'stats-list' }, rows.map(function (row) { return el('li', { text: text(row) }); })) : el('p', { text: 'Нет данных' }); }

  function sourceMatchView(source, manifest) {
    var detailHosts = [el('div'), el('div'), el('div')];
    var host = el('div', { id: 'stats-source-match-detail', class: 'stats-directory', 'data-detail-readonly': 'true' }, detailHosts);
    var load = el('button', { type: 'button', class: 'stats-detail-button', text: 'Загрузить детали матча' });
    var status;
    load.addEventListener('click', async function () {
      load.disabled = true; load.textContent = 'Загрузка деталей матча…';
      detailHosts.forEach(function (detailHost) { detailHost.textContent = 'Загрузка…'; });
      var loaders = [
        { dataset: 'matchPlayers', label: 'игроки', render: function (rows) {
          return simpleTableSection('Игроки матча', ['Игрок', 'Rating', 'Результат'], rows.map(function (row) {
            return [row.name, number(row.rating2), row.matchResult];
          }));
        } },
        { dataset: 'matchRounds', label: 'раунды', render: function (rows) {
          return simpleTableSection('Раунды матча', ['Раунд', 'Победитель', 'Причина', 'Бомба'], rows.map(function (row) {
            return [row.round, row.winner, row.reason, row.bombPlanted ? 'Установлена' : 'Нет'];
          }));
        } },
        { dataset: 'matchPlayerWeapons', label: 'оружие', render: function (rows) {
          return simpleTableSection('Оружие матча', ['Оружие', 'Убийства', 'Урон', 'Выстрелы'], rows.map(function (row) {
            return [weaponName(row.weapon), row.kills, row.damage, row.shots];
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
    var view = shell('Исходный матч · ' + mapName(source.map), U.fmtFull(source.startedAt), el('div', { class: 'stats-stack' }, [
      card('Матч', el('dl', { class: 'stats-dl' }, [el('dt', { text: 'Раунды' }), el('dd', { text: String(source.roundsPlayed) }), el('dt', { text: 'Режим' }), el('dd', { text: text(source.mode) }), el('dt', { text: 'Сервер' }), el('dd', { text: text(source.serverName) })])),
      load, host, technicalDetails(manifest, el('p', { class: 'stats-mono', text: 'matchId: ' + source.matchId }))
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
    rows = Core.canonicalMapRows(rows, canonicalMaps, false);
    return sortableView('Карты', rows.length + ' карт / текущий пул', rows, { defaultKey: 'n', search: function (row) { return row.canonicalName; }, name: function (row) { return row.canonicalName; }, columns: [
      { key: 'canonicalName', label: 'Карта', value: function (row) { return row.canonicalName; } }, { key: 'n', label: 'Матчам', value: function (row) { return row.n; } }
    ] }, async function (row, host, button, status) {
      button.disabled = true; host.textContent = 'Загрузка…';
      try {
        var details = (await client.datasetForKey('playerMapStats', 'map', row.map)).slice(0, 10);
        U.mount(host, simpleList(details.map(function (item, index) { return 'Игрок ' + (index + 1) + ' · Rating ' + number(item.rating2 || item.rating); })));
        status.textContent = 'Детали карты ' + mapName(row.map) + ' загружены';
      } catch (error) {
        host.textContent = 'Нет данных: ' + error.message; button.disabled = false;
        status.textContent = 'Ошибка деталей карты ' + mapName(row.map) + '. Можно повторить.';
      }
    });
  }

  function weaponsView(rows) {
    return sortableView('Оружие', '39 видов оружия / агрегат', rows, { defaultKey: 'kills', search: function (row) { return weaponName(row.weapon); }, name: function (row) { return weaponName(row.weapon); }, columns: [
      { key: 'weapon', label: 'Оружие', value: function (row) { return weaponName(row.weapon); } }, { key: 'kills', label: 'Убийствам', value: function (row) { return row.kills; } }, { key: 'shots', label: 'Выстрелам', value: function (row) { return row.shots; } }, { key: 'players', label: 'Игрокам', value: function (row) { return row.players; } }
    ] }, async function (row, host, button, status) {
      button.disabled = true; host.textContent = 'Загрузка…';
      try {
        var details = (await client.datasetForKey('playerWeaponStats', 'weapon', row.weapon)).slice(0, 10);
        U.mount(host, simpleList(details.map(function (item) { return text(item.name || item.steamid) + ' · ' + text(item.kills) + ' убийств'; })));
        status.textContent = 'Детали оружия ' + weaponName(row.weapon) + ' загружены';
      } catch (error) {
        host.textContent = 'Нет данных: ' + error.message; button.disabled = false;
        status.textContent = 'Ошибка деталей оружия ' + weaponName(row.weapon) + '. Можно повторить.';
      }
    });
  }

  function trendsView(rows) {
    return sortableView('Тренды', '20 профилей / динамика', rows, { defaultKey: 'roundsTotal', search: function (row) { return row.name; }, name: function (row) { return row.name; }, columns: [
      { key: 'name', label: 'Игроку', value: function (row) { return row.name; } }, { key: 'roundsTotal', label: 'Раундам', value: function (row) { return row.roundsTotal; } }
    ] }, function (row) { window.location.hash = Core.href('player', row.steamid); });
  }

  function qualityView(rows, manifest) {
    var quality = rows[0] || {};
    var body = el('div', { class: 'stats-stack' }, [
      el('div', { class: 'stats-hero-grid' }, [
        card('Целостность', el('div', {}, [chip(quality.integrity === 'ok' ? 'Проверена' : 'Есть ошибки', quality.integrity === 'ok' ? 'ok' : 'signal'), el('p', { text: quality.foreignKeyViolations + ' нарушений связей · ' + quality.sourceDiscrepancies + ' расхождений источника' })])),
        card('Окно', el('p', { text: manifest.window.recentStart + ' — ' + manifest.window.recentEnd })),
        card('Объём', el('p', { class: 'stats-big', text: String(manifest.assets.length) + ' файлов' }))
      ]),
      technicalDetails(manifest, el('div', {}, [
        simpleTableSection('Покрытие', ['Набор', 'Строк', 'Файлов'], Object.keys(manifest.counts).map(function (key) { return [key, manifest.counts[key], manifest.assets.filter(function (asset) { return asset.dataset === key; }).length || '—']; })),
        simpleTableSection('Проверенные файлы', ['Набор', 'Путь', 'Строк', 'SHA-256'], manifest.assets.map(function (asset) { return [asset.dataset, asset.path, asset.count, asset.sha256.slice(0, 12) + '…']; }))
      ]))
    ]);
    return shell('Качество данных', 'Проверка снимка', body, 'Готово: целостность снимка проверена');
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
    if (route.view === 'player') return playerView(data, route, state.manifest);
    if (route.view === 'match') return matchView(data, route, state.manifest);
    if (route.view === 'maps') return mapsView(data.maps);
    if (route.view === 'weapons') return weaponsView(data.weapons);
    if (route.view === 'trends') return trendsView(data.trendPlayers);
    if (route.view === 'quality') return qualityView(data.quality, state.manifest);
    return emptyView(route.reason);
  }

  async function open(route, options) {
    currentRoute = route;
    if (options && Array.isArray(options.canonicalMaps)) canonicalMaps = options.canonicalMaps.slice();
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
