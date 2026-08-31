/* ============================================================
   Состояние с синхронизацией на сервер.

   Читается один раз при загрузке (/api/state), дальше все изменения
   применяются локально сразу, а на сервер уходят пачкой с задержкой.
   Неотправленное переживает перезагрузку в localStorage, так что
   отметки не теряются, даже если связь отвалилась.

   Личное (гранаты, правила, лестница) и командное (заметки, вето,
   роли, счёт, цели тренировок) разделяет сервер — здесь всё лежит
   одной плоской картой, пространства ключей не пересекаются.
   ============================================================ */

window.Store = (function () {
  'use strict';

  var QUEUE_KEY = 'ushibu.cs2.queue.v3';
  var FLUSH_DELAY = 700;

  var state = { checks: {}, notes: {} };
  var me = null;
  var queue = { checks: {}, notes: {} };
  var flushTimer = null;
  var retryTimer = null;
  var status = 'idle';           // idle | saving | saved | error
  var changeListeners = [];
  var statusListeners = [];

  /* ---------------- Очередь неотправленного ---------------- */

  function loadQueue() {
    try {
      var raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        queue.checks = raw.checks && typeof raw.checks === 'object' ? raw.checks : {};
        queue.notes = raw.notes && typeof raw.notes === 'object' ? raw.notes : {};
      }
    } catch (e) { /* localStorage может быть запрещён — работаем без него */ }
  }

  function saveQueue() {
    try {
      if (!Object.keys(queue.checks).length && !Object.keys(queue.notes).length) {
        localStorage.removeItem(QUEUE_KEY);
      } else {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (e) { /* не критично */ }
  }

  function queueSize() {
    return Object.keys(queue.checks).length + Object.keys(queue.notes).length;
  }

  /* ---------------- Статус сохранения ---------------- */

  function setStatus(next) {
    status = next;
    statusListeners.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }

  function emitChange() {
    changeListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* ---------------- Отправка ---------------- */

  function schedule() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DELAY);
  }

  function flush() {
    clearTimeout(flushTimer);
    if (!queueSize()) return Promise.resolve();

    var payload = { checks: queue.checks, notes: queue.notes };
    queue = { checks: {}, notes: {} };
    saveQueue();
    setStatus('saving');

    return fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (res.status === 401) {
          // Сессия истекла — перезагрузка выкинет на форму входа.
          window.location.reload();
          throw new Error('unauthorized');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        setStatus('saved');
      })
      .catch(function () {
        // Возвращаем в очередь: то, что успело накопиться позже, важнее.
        queue.checks = Object.assign({}, payload.checks, queue.checks);
        queue.notes = Object.assign({}, payload.notes, queue.notes);
        saveQueue();
        setStatus('error');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, 5000);
      });
  }

  /* Последняя попытка при уходе со страницы — beacon переживает выгрузку. */
  function flushBeacon() {
    if (!queueSize() || !navigator.sendBeacon) return;
    try {
      var blob = new Blob([JSON.stringify({ checks: queue.checks, notes: queue.notes })],
        { type: 'application/json' });
      if (navigator.sendBeacon('/api/state', blob)) {
        queue = { checks: {}, notes: {} };
        saveQueue();
      }
    } catch (e) { /* не вышло — останется в очереди до следующего захода */ }
  }

  /* ---------------- Загрузка ---------------- */

  function init() {
    loadQueue();

    return fetch('/api/state', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { window.location.reload(); throw new Error('unauthorized'); }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        me = data.me || null;
        var team = data.team || {};
        var personal = data.personal || {};
        // Пространства ключей не пересекаются, поэтому можно объединить.
        state.checks = Object.assign({}, team.checks || {}, personal.checks || {});
        state.notes = Object.assign({}, team.notes || {});

        // Накатываем то, что не успело уйти в прошлый раз
        Object.keys(queue.checks).forEach(function (k) {
          if (queue.checks[k]) state.checks[k] = true; else delete state.checks[k];
        });
        Object.keys(queue.notes).forEach(function (k) {
          if (queue.notes[k]) state.notes[k] = queue.notes[k]; else delete state.notes[k];
        });
        if (queueSize()) schedule();

        window.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') flushBeacon();
        });
        window.addEventListener('pagehide', flushBeacon);
        window.addEventListener('online', flush);

        return me;
      });
  }

  /* ---------------- Публичный API ---------------- */

  return {
    init: init,
    me: function () { return me; },

    getCheck: function (id) { return state.checks[id] === true; },
    setCheck: function (id, value) {
      if (value) state.checks[id] = true; else delete state.checks[id];
      queue.checks[id] = !!value;
      saveQueue();
      schedule();
      emitChange();
    },

    getNote: function (id) { return typeof state.notes[id] === 'string' ? state.notes[id] : ''; },
    setNote: function (id, value) {
      if (value) state.notes[id] = value; else delete state.notes[id];
      queue.notes[id] = value || '';
      saveQueue();
      schedule();
      emitChange();
    },

    countChecked: function (ids) {
      var n = 0;
      ids.forEach(function (id) { if (state.checks[id] === true) n++; });
      return n;
    },

    /* Сколько отмечено в группе ключей: 'nade-', 'rule-', 'lad-'.
       Тем же способом считает и сервер в /api/team, поэтому свою строку
       в командной сводке можно пересчитать локально. */
    countByPrefix: function (prefix) {
      var n = 0;
      Object.keys(state.checks).forEach(function (k) {
        if (state.checks[k] === true && k.indexOf(prefix) === 0) n++;
      });
      return n;
    },

    /* Сбрасываем только своё: командные заметки чужой кнопкой не трогаем. */
    resetPersonal: function () {
      var removed = 0;
      Object.keys(state.checks).forEach(function (k) {
        if (/^(nade-|rule-|lad-)/.test(k)) {
          delete state.checks[k];
          queue.checks[k] = false;
          removed++;
        }
      });
      saveQueue();
      emitChange();
      return flush().then(function () { return removed; });
    },

    exportJSON: function () {
      return JSON.stringify({
        app: 'ushibu-cs2-hq',
        version: 3,
        user: me ? me.nick : null,
        exportedAt: new Date().toISOString(),
        checks: state.checks,
        notes: state.notes
      }, null, 2);
    },

    status: function () { return status; },
    pendingCount: queueSize,
    flush: flush,
    onChange: function (fn) { changeListeners.push(fn); },
    onStatus: function (fn) { statusListeners.push(fn); }
  };
})();
