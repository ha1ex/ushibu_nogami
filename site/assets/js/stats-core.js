/* Pure route and data-contract helpers for the lazy statistics dashboard. */
(function (root) {
  'use strict';

  var LEGACY = {
    obzor: 'overview', trenirovki: 'training', taktiki: 'tactics',
    soperniki: 'opponents', matchi: 'matches', reglament: 'regulations',
    golosovanie: 'polls'
  };
  var LIST_VIEWS = ['maps', 'weapons', 'trends', 'quality'];
  var TASK_IDS = ['brief-read', 'veto-confirmed', 'anti-threat', 'matchday'];
  var TEAM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var PLAYER_RE = /^\d{17}$/;
  var MATCH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var DATASET_RE = /^[A-Za-z][A-Za-z0-9]*$/;
  var ASSET_RE = /^data\/[A-Za-z][A-Za-z0-9]*-\d{3}\.json$/;
  var SHA_RE = /^[a-f0-9]{64}$/;
  var DETAIL_INDEX_FIELDS = {
    matchPlayers: ['matchId'], matchRounds: ['matchId'], matchPlayerWeapons: ['matchId'],
    playerClutches: ['steamid'], playerMapStats: ['steamid', 'map'],
    playerWeaponStats: ['steamid', 'weapon'], trendMatches: ['steamid']
  };

  function invalid(reason) {
    return { tab: 'statistics', view: 'invalid', path: '#/statistika', reason: 'Нет данных: ' + reason };
  }

  function decode(segment) {
    try {
      var value = decodeURIComponent(segment);
      if (/%[0-9a-f]{2}/i.test(value) || value.indexOf('/') !== -1 || value.indexOf('\\') !== -1) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function parseHash(hash) {
    var raw = typeof hash === 'string' ? hash : '';
    var parts = raw.replace(/^#\/?/, '').split('/');
    if (parts.length === 1 && LEGACY[parts[0]]) return { tab: LEGACY[parts[0]], path: '#/' + parts[0] };
    if (parts[0] !== 'statistika') return { tab: 'overview', path: '#/obzor' };
    if (parts.length === 1) return { tab: 'statistics', view: 'overview', path: '#/statistika' };
    if (parts.length === 2 && LIST_VIEWS.indexOf(parts[1]) !== -1) {
      return { tab: 'statistics', view: parts[1], path: '#/statistika/' + parts[1] };
    }
    if (parts.length !== 3) return invalid('неверный адрес раздела');
    var id = decode(parts[2]);
    if (!id) return invalid('неверный идентификатор');
    if (parts[1] === 'sopernik' && TEAM_RE.test(id)) {
      return { tab: 'statistics', view: 'team', teamId: id, path: '#/statistika/sopernik/' + encodeURIComponent(id) };
    }
    if (parts[1] === 'igrok' && PLAYER_RE.test(id)) {
      return { tab: 'statistics', view: 'player', steamid: id, path: '#/statistika/igrok/' + id };
    }
    if (parts[1] === 'match' && MATCH_RE.test(id)) {
      return { tab: 'statistics', view: 'match', matchId: id, path: '#/statistika/match/' + encodeURIComponent(id) };
    }
    return invalid('неизвестный или неверный идентификатор');
  }

  function assertId(kind, id) {
    if (kind === 'player' && typeof id !== 'string') throw new Error('SteamID должен оставаться строкой');
    var value = String(id);
    var valid = kind === 'team' ? TEAM_RE.test(value) : kind === 'player' ? PLAYER_RE.test(value) : kind === 'match' ? MATCH_RE.test(value) : false;
    if (!valid) throw new Error('Неверный идентификатор маршрута');
    return value;
  }

  function href(kind, id) {
    var value = assertId(kind, id);
    if (kind === 'team') return '#/statistika/sopernik/' + encodeURIComponent(value);
    if (kind === 'player') return '#/statistika/igrok/' + value;
    return '#/statistika/match/' + encodeURIComponent(value);
  }

  function validatePointer(pointer) {
    if (!pointer || pointer.schemaVersion !== 1) throw new Error('Неподдерживаемая схема pointer');
    if (!/^v1-[a-f0-9]{16}$/.test(pointer.version || '')) throw new Error('Неверная version pointer');
    if (!SHA_RE.test(pointer.root || '')) throw new Error('Неверный root pointer');
    if (pointer.manifest !== pointer.version + '/manifest.json') throw new Error('Неверный путь manifest');
    if (!SHA_RE.test(pointer.manifestSha256 || '')) throw new Error('Неверный SHA-256 manifest');
    return pointer;
  }

  function validateManifest(pointer, manifest) {
    validatePointer(pointer);
    if (!manifest || manifest.schemaVersion !== 1 || manifest.contractVersion !== '1.1.0') throw new Error('Неподдерживаемая схема manifest');
    if (manifest.version !== pointer.version || manifest.root !== pointer.root) throw new Error('Manifest root/version не совпадает с pointer');
    if (!manifest.window || typeof manifest.window.recentEnd !== 'string') throw new Error('Manifest не содержит окно данных');
    if (!Array.isArray(manifest.assets)) throw new Error('Manifest не содержит assets');
    var seen = Object.create(null);
    manifest.assets.forEach(function (asset) {
      if (!asset || !DATASET_RE.test(asset.dataset || '')) throw new Error('Неверный dataset в manifest');
      if (!ASSET_RE.test(asset.path || '')) throw new Error('Небезопасный путь asset в manifest');
      if (seen[asset.path]) throw new Error('Повтор пути asset в manifest');
      seen[asset.path] = asset.dataset;
      if (!Number.isInteger(asset.count) || asset.count < 0 || !SHA_RE.test(asset.sha256 || '')) throw new Error('Неверные метаданные asset');
    });
    if (!manifest.detailIndexes || Array.isArray(manifest.detailIndexes) || typeof manifest.detailIndexes !== 'object') {
      throw new Error('Manifest не содержит detail indexes');
    }
    var expectedDatasets = Object.keys(DETAIL_INDEX_FIELDS).sort();
    var actualDatasets = Object.keys(manifest.detailIndexes).sort();
    if (JSON.stringify(actualDatasets) !== JSON.stringify(expectedDatasets)) throw new Error('Detail index dataset allowlist не совпадает');
    Object.keys(manifest.detailIndexes).forEach(function (dataset) {
      if (!DETAIL_INDEX_FIELDS[dataset]) throw new Error('Неизвестный detail index dataset');
      var fields = manifest.detailIndexes[dataset];
      if (!fields || Array.isArray(fields) || typeof fields !== 'object') throw new Error('Неверный detail index');
      var expectedFields = DETAIL_INDEX_FIELDS[dataset].slice().sort();
      var actualFields = Object.keys(fields).sort();
      if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) throw new Error('Detail index field allowlist не совпадает');
      Object.keys(fields).forEach(function (field) {
        if (DETAIL_INDEX_FIELDS[dataset].indexOf(field) === -1) throw new Error('Неизвестное поле detail index');
        var keys = fields[field];
        if (!keys || Array.isArray(keys) || typeof keys !== 'object') throw new Error('Неверный detail index mapping');
        Object.keys(keys).forEach(function (key) {
          var validKey = field === 'steamid' ? PLAYER_RE.test(key) : MATCH_RE.test(key);
          var paths = keys[key];
          if (!validKey || !Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length) throw new Error('Неверный ключ detail index');
          paths.forEach(function (path) {
            if (seen[path] !== dataset) throw new Error('Detail index ссылается на неверный asset');
          });
        });
      });
    });
    return manifest;
  }

  function bytesToHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function verifyBytes(bytes, expected, subtleOverride) {
    var subtle = arguments.length >= 3 ? subtleOverride : (root.crypto && root.crypto.subtle);
    if (!subtle || typeof subtle.digest !== 'function') throw new Error('Web Crypto API недоступен; проверка закрыта');
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var actual = bytesToHex(await subtle.digest('SHA-256', view));
    if (actual !== expected) throw new Error('SHA-256 не совпадает');
    return true;
  }

  function assetsFor(manifest, dataset) {
    if (!DATASET_RE.test(dataset || '')) throw new Error('Неверный dataset');
    return manifest.assets.filter(function (asset) { return asset.dataset === dataset; });
  }

  function recommendationEvidenceIds(rec) {
    var ids = [];
    ['mapEvidence', 'threatEvidence', 'weaknessEvidence'].forEach(function (key) {
      if (Array.isArray(rec[key])) ids = ids.concat(rec[key]);
    });
    ['maps', 'threats', 'weaknesses'].forEach(function (key) {
      (rec[key] || []).forEach(function (item) { if (item && item.id) ids.push(item.id); });
    });
    (rec.caveats || []).forEach(function (item) { if (item && item.evidenceId) ids.push(item.evidenceId); });
    return ids;
  }

  var NOISE_FLOOR = 0.03;

  function edgeBand(edge) {
    if (edge === null || edge === undefined) return 'no-data';
    if (Math.abs(edge) < NOISE_FLOOR) return 'noise';
    return edge > 0 ? 'us' : 'them';
  }

  function mapKey(map) {
    return String(map || '').replace(/^de_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function validateRecommendation(rec, manifest, evidenceIds) {
    if (!rec || rec.reviewed !== true) throw new Error('Recommendation reviewed !== true');
    if (rec.snapshotRoot !== manifest.root) throw new Error('Recommendation root не совпадает');
    if (rec.dataThrough !== manifest.window.recentEnd) throw new Error('Recommendation устарел');
    var missing = recommendationEvidenceIds(rec).filter(function (id) { return !evidenceIds.has(id); });
    if (missing.length) throw new Error('Recommendation ссылается на отсутствующий evidence: ' + missing[0]);
    return rec;
  }

  function scoutKey(matchId, taskId) {
    assertId('match', matchId);
    if (TASK_IDS.indexOf(taskId) === -1) throw new Error('Неконтролируемый task ID');
    return 'scout-v1-' + matchId + '-' + taskId;
  }

  function sortRows(rows, key, direction) {
    var sign = direction === 'descending' ? -1 : 1;
    return rows.map(function (row, index) { return { row: row, index: index }; }).sort(function (a, b) {
      var av = a.row[key], bv = b.row[key];
      var cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv), 'ru');
      return cmp === 0 ? a.index - b.index : cmp * sign;
    }).map(function (item) { return item.row; });
  }

  function selectSchedulePlan(plans, today) {
    var sorted = (plans || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].date >= today) return { plan: sorted[i], completedFallback: false };
    }
    return { plan: sorted.length ? sorted[sorted.length - 1] : null, completedFallback: sorted.length > 0 };
  }

  function datasetsForRoute(route) {
    var view = route && route.view;
    if (view === 'overview') return ['rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence', 'teamMapStats', 'vetoAdvice'];
    if (view === 'team') return ['rosters', 'teamMetrics', 'mapEdges', 'recommendations', 'evidence', 'teamMapStats', 'vetoAdvice', 'playerMetrics'];
    if (view === 'player') return ['players', 'playerMetrics', 'rosters'];
    if (view === 'match') return ['recommendations', 'evidence', 'rosters', 'matches', 'teamMetrics', 'mapEdges', 'teamMapStats', 'vetoAdvice'];
    if (view === 'maps') return ['maps'];
    if (view === 'weapons') return ['weapons'];
    if (view === 'trends') return ['trendPlayers'];
    if (view === 'quality') return ['quality'];
    return [];
  }

  function createClient(fetchFn) {
    var base = '/assets/data/whoajor/';
    var opened = null;
    var datasetCache = Object.create(null);

    async function responseBytes(url, revalidate) {
      var options = { credentials: 'same-origin' };
      if (revalidate) options.cache = 'no-cache';
      var response = await fetchFn(url, options);
      if (!response || !response.ok) throw new Error('Не удалось загрузить ' + url + ': ' + (response ? response.status : 'network'));
      return new Uint8Array(await response.arrayBuffer());
    }

    async function open() {
      if (opened) return opened;
      opened = (async function () {
        var pointerBytes = await responseBytes(base + 'current.json', true);
        var pointer = validatePointer(JSON.parse(new TextDecoder().decode(pointerBytes)));
        var manifestBytes = await responseBytes(base + pointer.manifest);
        await verifyBytes(manifestBytes, pointer.manifestSha256);
        var manifest = validateManifest(pointer, JSON.parse(new TextDecoder().decode(manifestBytes)));
        return { pointer: pointer, manifest: manifest };
      })().catch(function (error) { opened = null; throw error; });
      return opened;
    }

    async function loadEntries(name, entries) {
      var state = await open();
      var key = entries.map(function (entry) { return entry.path; }).join('|');
      if (!datasetCache[key]) datasetCache[key] = Promise.all(entries.map(async function (entry) {
        var bytes = await responseBytes(base + state.manifest.version + '/' + entry.path);
        await verifyBytes(bytes, entry.sha256);
        var payload = JSON.parse(new TextDecoder().decode(bytes));
        if (!payload || payload.schemaVersion !== 1 || payload.dataset !== name || payload.root !== state.manifest.root || !Array.isArray(payload.rows) || payload.rows.length !== entry.count) {
          throw new Error('Asset не прошёл проверку: ' + entry.path);
        }
        return payload.rows;
      })).then(function (shards) { return [].concat.apply([], shards); }).catch(function (error) { delete datasetCache[key]; throw error; });
      return datasetCache[key];
    }

    async function dataset(name) {
      var state = await open();
      if (state.manifest.detailIndexes[name]) throw new Error('Keyed detail dataset требует ключ');
      var entries = assetsFor(state.manifest, name);
      if (!entries.length) throw new Error('Нет dataset: ' + name);
      return loadEntries(name, entries);
    }

    async function datasetForKey(name, field, value) {
      var state = await open();
      var index = state.manifest.detailIndexes[name] && state.manifest.detailIndexes[name][field];
      var key = String(value);
      if (!index || (field === 'steamid' && typeof value !== 'string')) throw new Error('Нет keyed detail index');
      var paths = index[key];
      if (!paths) return [];
      var entries = paths.map(function (path) {
        return state.manifest.assets.filter(function (asset) { return asset.dataset === name && asset.path === path; })[0];
      });
      if (entries.some(function (entry) { return !entry; })) throw new Error('Detail index не прошёл allowlist');
      var rows = await loadEntries(name, entries);
      return rows.filter(function (row) { return String(row[field]) === key; });
    }

    function clear() { opened = null; datasetCache = Object.create(null); }
    return { open: open, dataset: dataset, datasetForKey: datasetForKey, clear: clear };
  }

  root.StatsCore = {
    parseHash: parseHash,
    href: href,
    validatePointer: validatePointer,
    validateManifest: validateManifest,
    verifyBytes: verifyBytes,
    assetsFor: assetsFor,
    validateRecommendation: validateRecommendation,
    recommendationEvidenceIds: recommendationEvidenceIds,
    scoutKey: scoutKey,
    sortRows: sortRows,
    selectSchedulePlan: selectSchedulePlan,
    datasetsForRoute: datasetsForRoute,
    createClient: createClient,
    taskIds: TASK_IDS.slice(),
    NOISE_FLOOR: NOISE_FLOOR,
    edgeBand: edgeBand,
    mapKey: mapKey
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
