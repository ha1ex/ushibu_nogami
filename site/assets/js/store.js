window.Store = (function (Core) {
  'use strict';

  var OUTBOX_KEY = 'ushibu.cs2.outbox.v4';
  var OUTBOX_OWNER_KEY = 'ushibu.cs2.outbox.v4.owner';
  var QUARANTINE_KEY = 'ushibu.cs2.outbox.v4.quarantine';
  var MAX_OUTBOX_COUNT = 512;
  var MAX_OUTBOX_BYTES = 256 * 1024;
  var FLUSH_DELAY = 700;
  var RETRY_DELAY = 5000;

  var allowed = null;
  var me = null;
  var base = { checks: {}, notes: {}, scores: {} };
  var visible = { checks: {}, notes: {}, scores: {} };
  var revision = 0;
  var outbox = [];
  var quarantine = [];
  var status = 'pending';
  var flushTimer = null;
  var retryTimer = null;
  var inFlight = null;
  var listenersAttached = false;
  var changeListeners = [];
  var statusListeners = [];

  function emitChange() {
    changeListeners.forEach(function (listener) { try { listener(); } catch (error) {} });
  }

  function setStatus(next) {
    status = next;
    statusListeners.forEach(function (listener) { try { listener(status); } catch (error) {} });
  }

  function persist() {
    if (!me) return;
    try {
      if (outbox.length) {
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
        localStorage.setItem(OUTBOX_OWNER_KEY, me.id);
      } else {
        localStorage.removeItem(OUTBOX_KEY);
        localStorage.removeItem(OUTBOX_OWNER_KEY);
      }
      if (quarantine.length) localStorage.setItem(QUARANTINE_KEY, JSON.stringify(quarantine));
      else localStorage.removeItem(QUARANTINE_KEY);
    } catch (error) {
      setStatus('error');
    }
  }

  function archiveKey(userId) {
    return OUTBOX_KEY + '.user.' + encodeURIComponent(userId);
  }

  function parseStoredOutbox(serialized) {
    var parsedOutbox = [];
    var invalid = [];
    if (!serialized) return { outbox: parsedOutbox, quarantine: invalid };
    if (serialized.length > MAX_OUTBOX_BYTES) {
      invalid.push({ reason: 'outbox_too_large', serialized: serialized.slice(0, MAX_OUTBOX_BYTES) });
      return { outbox: parsedOutbox, quarantine: invalid };
    }
    try {
      var parsed = JSON.parse(serialized);
      if (!Array.isArray(parsed)) throw new Error('outbox is not an array');
      parsed.forEach(function (entry, index) {
        if (index >= MAX_OUTBOX_COUNT) {
          invalid.push({ reason: 'outbox_count_limit', value: entry });
          return;
        }
        try { parsedOutbox.push(Core.validateMutation(entry, allowed)); }
        catch (error) { invalid.push({ reason: 'invalid_mutation', value: entry }); }
      });
    } catch (error) {
      invalid.push({ reason: 'invalid_outbox_json', serialized: serialized });
    }
    return { outbox: parsedOutbox, quarantine: invalid };
  }

  function loadOutbox(userId) {
    outbox = [];
    quarantine = [];
    try {
      var current = parseStoredOutbox(localStorage.getItem(OUTBOX_KEY));
      var restored = parseStoredOutbox(localStorage.getItem(archiveKey(userId)));
      var ownerId = localStorage.getItem(OUTBOX_OWNER_KEY);
      var selected = Core.selectUserOutbox({
        current: current.outbox, ownerId: ownerId, userId: userId, restored: restored.outbox
      });
      if (selected.archive) {
        localStorage.setItem(archiveKey(selected.archive.userId), JSON.stringify(selected.archive.outbox));
      }
      if (restored.outbox.length) localStorage.removeItem(archiveKey(userId));
      outbox = selected.active;
      quarantine = current.quarantine.concat(restored.quarantine).concat(
        selected.quarantine.map(function (entry) { return { reason: 'unowned_mutation', value: entry }; })
      );
      try {
        var priorQuarantine = JSON.parse(localStorage.getItem(QUARANTINE_KEY) || '[]');
        if (Array.isArray(priorQuarantine)) quarantine = priorQuarantine.concat(quarantine);
      } catch (error) {}
      persist();
    } catch (error) {
      quarantine.push({ reason: 'local_storage_unavailable' });
    }
  }

  function recompute() {
    visible = Core.replay(base, outbox);
  }

  function mutationId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var bytes = crypto.getRandomValues(new Uint8Array(18));
    return 'mutation_' + Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function appendOperation(operation) {
    var mutation = Core.validateMutation({ mutationId: mutationId(), operations: [operation] }, allowed);
    outbox = Core.appendMutation(outbox, mutation);
    persist();
    recompute();
    setStatus('pending');
    emitChange();
    schedule();
    return mutation.mutationId;
  }

  function schedule() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DELAY);
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, RETRY_DELAY);
  }

  function failure(autoRetry) {
    persist();
    setStatus('error');
    if (autoRetry) scheduleRetry();
  }

  function validAck(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && value.ok === true &&
      Number.isSafeInteger(value.revision) && value.revision >= 0;
  }

  function flush() {
    clearTimeout(flushTimer);
    if (inFlight) return inFlight;
    if (!outbox.length) {
      setStatus(quarantine.length ? 'error' : 'saved');
      return Promise.resolve();
    }
    var sent = outbox[0];
    setStatus('saving');
    inFlight = fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(sent)
    }).then(function (response) {
      if (response.status === 401) {
        persist();
        window.location.reload();
        return null;
      }
      if (!response.ok) {
        failure(response.status === 409 || response.status >= 500);
        return null;
      }
      return response.json().then(function (ack) {
        if (!validAck(ack)) {
          failure(false);
          return;
        }
        var model = Core.acknowledge({ base: base, outbox: outbox, revision: revision }, sent.mutationId, ack.revision);
        base = model.base;
        outbox = model.outbox;
        revision = model.revision;
        persist();
        recompute();
        emitChange();
        if (outbox.length) {
          setStatus('pending');
          schedule();
        } else setStatus(quarantine.length ? 'error' : 'saved');
      }, function () { failure(false); });
    }).catch(function () { failure(true); }).finally(function () { inFlight = null; });
    return inFlight;
  }

  function retry() {
    clearTimeout(retryTimer);
    clearTimeout(flushTimer);
    return flush();
  }

  function flushBeacon() {
    if (!outbox.length || !navigator.sendBeacon) return false;
    try {
      var copy = JSON.stringify(outbox[0]);
      return navigator.sendBeacon('/api/state', new Blob([copy], { type: 'application/json' }));
    } catch (error) {
      return false;
    }
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushBeacon();
    });
    window.addEventListener('pagehide', flushBeacon);
    window.addEventListener('online', retry);
  }

  function init(operations) {
    allowed = Core.deriveAllowedKeys(operations);
    return fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (response.status === 401) {
          window.location.reload();
          throw new Error('unauthorized');
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        var snapshot = Core.validateServerSnapshot(payload, allowed);
        me = snapshot.me;
        base = snapshot.state;
        revision = snapshot.revision;
        loadOutbox(me.id);
        recompute();
        attachListeners();
        emitChange();
        if (quarantine.length) setStatus('error');
        else if (outbox.length) {
          setStatus('pending');
          schedule();
        } else setStatus('saved');
        return me;
      });
  }

  function pendingFor(type, key) {
    return outbox.some(function (mutation) {
      return mutation.operations.some(function (operation) { return operation.type === type && operation.key === key; });
    });
  }

  return {
    init: init,
    me: function () { return me; },
    getCheck: function (key) { return visible.checks[key] === true; },
    setCheck: function (key, value) {
      if (typeof value !== 'boolean') throw new Error('check value must be boolean');
      return appendOperation({ type: 'check.set', key: key, value: value });
    },
    getNote: function (key) { return typeof visible.notes[key] === 'string' ? visible.notes[key] : ''; },
    setNote: function (key, value) {
      if (typeof value !== 'string') throw new Error('note value must be string');
      return appendOperation({ type: 'note.set', key: key, value: value });
    },
    getScore: function (key) {
      var current = visible.scores[key];
      return current ? { ours: current.ours, theirs: current.theirs, played: current.played }
        : { ours: null, theirs: null, played: false };
    },
    setScore: function (key, value) { return appendOperation({ type: 'score.set', key: key, value: value }); },
    countChecked: function (ids) { return ids.filter(function (id) { return visible.checks[id] === true; }).length; },
    exportJSON: function () {
      return JSON.stringify({
        app: 'ushibu-cs2-hq', version: 4, user: me ? me.nick : null,
        exportedAt: new Date().toISOString(), revision: revision,
        state: Core.copyState(visible), pendingMutations: outbox, quarantinedMutations: quarantine
      }, null, 2);
    },
    status: function () { return status; },
    pendingCount: function () { return outbox.length; },
    pendingFor: pendingFor,
    flush: flush,
    retry: retry,
    onChange: function (listener) { changeListeners.push(listener); },
    onStatus: function (listener) { statusListeners.push(listener); }
  };
})(window.StoreCore);
