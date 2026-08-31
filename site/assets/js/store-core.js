(function (root) {
  'use strict';

  var ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null;
  }

  function exactKeys(value, keys) {
    if (!plainObject(value)) return false;
    var actual = Object.keys(value).sort();
    var expected = keys.slice().sort();
    return actual.length === expected.length && actual.every(function (key, index) { return key === expected[index]; });
  }

  function score(value) {
    var number = function (entry) { return entry === null || (Number.isInteger(entry) && entry >= 0 && entry <= 99); };
    if (!exactKeys(value, ['ours', 'theirs', 'played']) || !number(value.ours) || !number(value.theirs) || typeof value.played !== 'boolean') {
      throw new Error('invalid score');
    }
    return { ours: value.ours, theirs: value.theirs, played: value.played };
  }

  function deriveAllowedKeys(operations) {
    var allowed = { checks: new Set(), notes: new Set(), scores: new Set() };
    ['matches', 'training', 'maps', 'opponents'].forEach(function (collection) {
      (operations[collection] || []).forEach(function (entity) {
        (entity.cards || []).forEach(function (card) {
          if (card.type === 'action') allowed.checks.add(card.id);
        });
      });
    });
    (operations.matches || []).forEach(function (match) {
      allowed.notes.add('match-' + match.id + '-note');
      allowed.scores.add('match-' + match.id + '-score');
    });
    (operations.opponents || []).forEach(function (opponent) { allowed.notes.add('opponent-' + opponent.id + '-note'); });
    (operations.maps || []).forEach(function (map) { allowed.notes.add('map-' + map.id + '-note'); });
    (operations.training || []).forEach(function (training) {
      allowed.notes.add('training-' + training.mapId + '-report');
      allowed.checks.add('training-' + training.mapId + '-report-complete');
    });
    return allowed;
  }

  function validateMutation(value, allowed) {
    if (!exactKeys(value, ['mutationId', 'operations']) || typeof value.mutationId !== 'string' || !ID_PATTERN.test(value.mutationId) ||
        !Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 50) throw new Error('invalid mutation');
    return {
      mutationId: value.mutationId,
      operations: value.operations.map(function (operation) {
        if (!exactKeys(operation, ['type', 'key', 'value']) || typeof operation.key !== 'string' || operation.key.length > 128) {
          throw new Error('invalid operation key (max 128)');
        }
        if (operation.type === 'check.set') {
          if (!allowed.checks.has(operation.key) || typeof operation.value !== 'boolean') throw new Error('invalid check');
          return { type: operation.type, key: operation.key, value: operation.value };
        }
        if (operation.type === 'note.set') {
          if (!allowed.notes.has(operation.key) || typeof operation.value !== 'string' || Array.from(operation.value).length > 2000) throw new Error('invalid note');
          return { type: operation.type, key: operation.key, value: operation.value };
        }
        if (operation.type === 'score.set') {
          if (!allowed.scores.has(operation.key)) throw new Error('invalid score key');
          return { type: operation.type, key: operation.key, value: score(operation.value) };
        }
        throw new Error('invalid operation type');
      })
    };
  }

  function copyState(state) {
    var next = { checks: {}, notes: {}, scores: {} };
    Object.keys(state.checks || {}).forEach(function (key) { next.checks[key] = state.checks[key]; });
    Object.keys(state.notes || {}).forEach(function (key) { next.notes[key] = state.notes[key]; });
    Object.keys(state.scores || {}).forEach(function (key) { next.scores[key] = score(state.scores[key]); });
    return next;
  }

  function applyOperations(state, operations) {
    var next = copyState(state);
    operations.forEach(function (operation) {
      if (operation.type === 'check.set') {
        if (operation.value) next.checks[operation.key] = true;
        else delete next.checks[operation.key];
      } else if (operation.type === 'note.set') {
        if (operation.value) next.notes[operation.key] = operation.value;
        else delete next.notes[operation.key];
      } else if (operation.type === 'score.set') next.scores[operation.key] = score(operation.value);
    });
    return next;
  }

  function cloneMutation(mutation) {
    return {
      mutationId: mutation.mutationId,
      operations: mutation.operations.map(function (operation) {
        return {
          type: operation.type,
          key: operation.key,
          value: operation.type === 'score.set' ? score(operation.value) : operation.value
        };
      })
    };
  }

  function appendMutation(outbox, mutation) {
    return outbox.map(cloneMutation).concat([cloneMutation(mutation)]);
  }

  function replay(base, outbox) {
    return outbox.reduce(function (state, mutation) { return applyOperations(state, mutation.operations); }, copyState(base));
  }

  function acknowledge(model, mutationId, revision) {
    if (!model.outbox.length || model.outbox[0].mutationId !== mutationId) throw new Error('ack must match first FIFO mutation');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid revision');
    return {
      base: applyOperations(model.base, model.outbox[0].operations),
      outbox: model.outbox.slice(1).map(cloneMutation),
      revision: Math.max(model.revision, revision)
    };
  }

  function selectUserOutbox(input) {
    var current = (input.current || []).map(cloneMutation);
    var restored = (input.restored || []).map(cloneMutation);
    var result = { active: restored, archive: null, quarantine: [] };
    if (!current.length) return result;
    if (input.ownerId === input.userId) {
      result.active = current;
      return result;
    }
    if (typeof input.ownerId === 'string' && input.ownerId) {
      result.archive = { userId: input.ownerId, outbox: current };
      return result;
    }
    result.quarantine = current;
    return result;
  }

  function validateServerSnapshot(value, allowed) {
    if (!exactKeys(value, ['me', 'state', 'revision']) || !exactKeys(value.me, ['id', 'nick']) ||
        typeof value.me.id !== 'string' || typeof value.me.nick !== 'string' ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 || !exactKeys(value.state, ['checks', 'notes', 'scores']) ||
        !plainObject(value.state.checks) || !plainObject(value.state.notes) || !plainObject(value.state.scores)) throw new Error('invalid server state');
    var state = { checks: {}, notes: {}, scores: {} };
    Object.keys(value.state.checks).forEach(function (key) {
      if (!allowed.checks.has(key) || value.state.checks[key] !== true) throw new Error('invalid server check');
      state.checks[key] = true;
    });
    Object.keys(value.state.notes).forEach(function (key) {
      var note = value.state.notes[key];
      if (!allowed.notes.has(key) || typeof note !== 'string' || note === '' || Array.from(note).length > 2000) throw new Error('invalid server note');
      state.notes[key] = note;
    });
    Object.keys(value.state.scores).forEach(function (key) {
      if (!allowed.scores.has(key)) throw new Error('invalid server score key');
      state.scores[key] = score(value.state.scores[key]);
    });
    return { me: { id: value.me.id, nick: value.me.nick }, state: state, revision: value.revision };
  }

  root.StoreCore = {
    deriveAllowedKeys: deriveAllowedKeys,
    validateMutation: validateMutation,
    validateServerSnapshot: validateServerSnapshot,
    appendMutation: appendMutation,
    applyOperations: applyOperations,
    replay: replay,
    acknowledge: acknowledge,
    selectUserOutbox: selectUserOutbox,
    copyState: copyState
  };
})(typeof window !== 'undefined' ? window : globalThis);
