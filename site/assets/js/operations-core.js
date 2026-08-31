/* Pure routing and date selection helpers for the operational headquarters. */
(function (root) {
  'use strict';

  var PLANNED_MATCHES = ['m01', 'm02', 'm09', 'm10'];
  var ALIASES = { obzor: 'seichas', taktiki: 'karty', reglament: 'trenirovki', golosovanie: 'seichas' };
  var SECTIONS = ['seichas', 'matchi', 'trenirovki', 'karty', 'soperniki'];
  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function notFound(path) {
    return { section: 'seichas', view: 'not-found', path: path || '#/seichas' };
  }

  function decoded(value) {
    try {
      var result = decodeURIComponent(value);
      return ID_RE.test(result) ? result : null;
    } catch (_) {
      return null;
    }
  }

  function parseHash(hash) {
    var raw = typeof hash === 'string' && hash ? hash : '#/seichas';
    var parts = raw.replace(/^#\/?/, '').split('/');
    if (parts.length === 1 && ALIASES[parts[0]]) return { redirect: '#/' + ALIASES[parts[0]] };
    if (parts.length === 1 && SECTIONS.indexOf(parts[0]) !== -1) {
      return { section: parts[0], view: parts[0] === 'seichas' ? 'now' : parts[0], path: '#/' + parts[0] };
    }
    if (parts[0] === 'match' && parts.length === 2) {
      var matchId = decoded(parts[1]);
      return matchId ? { section: 'matchi', view: 'match', id: matchId, path: '#/match/' + matchId } : notFound(raw);
    }
    if (parts[0] === 'karty' && parts.length === 2) {
      var mapId = decoded(parts[1]);
      return mapId ? { section: 'karty', view: 'map', id: mapId, path: '#/karty/' + mapId } : notFound(raw);
    }
    if (parts[0] === 'soperniki' && parts.length === 2) {
      var teamId = decoded(parts[1]);
      return teamId ? { section: 'soperniki', view: 'opponent', id: teamId, path: '#/soperniki/' + teamId } : notFound(raw);
    }
    if (parts[0] === 'statistika') {
      if (parts[1] === 'match' && parts.length === 3 && PLANNED_MATCHES.indexOf(parts[2]) !== -1) return { redirect: '#/match/' + parts[2] };
      if (parts[1] === 'sopernik' && parts.length === 3 && decoded(parts[2])) return { redirect: '#/soperniki/' + decoded(parts[2]) };
      return { section: 'statistika', view: 'statistics', path: raw, rawHash: raw };
    }
    return notFound(raw);
  }

  function selectMatch(matches, today) {
    var sorted = (matches || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].date >= today) return { match: sorted[i], completedFallback: false };
    }
    return { match: sorted.length ? sorted[sorted.length - 1] : null, completedFallback: sorted.length > 0 };
  }

  function todayIso(now) {
    var date = now || new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  root.OperationsCore = { parseHash: parseHash, selectMatch: selectMatch, todayIso: todayIso };
})(typeof globalThis !== 'undefined' ? globalThis : window);
