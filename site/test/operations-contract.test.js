import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const validatorUrl = new URL('../scripts/validate-content.mjs', import.meta.url);
const operationsUrl = new URL('../assets/data/operations.json', import.meta.url);

async function load() {
  const [{ validateOperations }, source] = await Promise.all([
    import(validatorUrl.href),
    readFile(operationsUrl, 'utf8')
  ]);
  return { validateOperations, operations: JSON.parse(source) };
}

function clone(value) {
  return structuredClone(value);
}

test('canonical operations content satisfies the schema and reference contract', async () => {
  const { validateOperations, operations } = await load();
  const result = validateOperations(operations);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('validator rejects missing required card fields and forbidden managed fields', async () => {
  const { validateOperations, operations } = await load();
  const missing = clone(operations);
  delete missing.matches[0].cards[0].source;
  assert.equal(validateOperations(missing).valid, false);

  for (const field of ['insight', 'danger', 'ready', 'reviewed']) {
    const changed = clone(operations);
    changed.matches[0].cards[0][field] = true;
    const result = validateOperations(changed);
    assert.equal(result.valid, false, `${field} must be rejected`);
  }
});

test('validator rejects invalid dates, confidence and blank action responsibility', async () => {
  const { validateOperations, operations } = await load();
  const mutations = [
    (data) => { data.matches[0].date = '30.09.2026'; },
    (data) => { data.matches[0].cards[0].confidence = 'certain'; },
    (data) => { data.matches[0].cards.find((card) => card.type === 'action').owner = '  '; },
    (data) => { data.matches[0].cards.find((card) => card.type === 'action').verifyWith = ''; }
  ];
  for (const mutate of mutations) {
    const changed = clone(operations);
    mutate(changed);
    assert.equal(validateOperations(changed).valid, false);
  }
});

test('validator rejects unknown evidence and dependency IDs', async () => {
  const { validateOperations, operations } = await load();
  const decision = clone(operations);
  decision.matches[0].cards.push({
    id: 'decision-test', type: 'decision', title: 'Тест', body: 'Тестовое решение',
    owner: 'Капитан', decidedAt: '2026-08-31', rationale: 'Проверка ссылки',
    evidenceIds: ['missing-evidence']
  });
  assert.equal(validateOperations(decision).valid, false);

  const action = clone(operations);
  action.matches[0].cards.find((card) => card.type === 'action').dependsOn = ['missing-dependency'];
  assert.equal(validateOperations(action).valid, false);
});

test('content keeps operational truth bounded and explicit', async () => {
  const { operations } = await load();
  assert.equal(Object.hasOwn(operations.meta, 'today'), false);
  assert.deepEqual(operations.maps.map((map) => map.name), [
    'Dust 2', 'Inferno', 'Mirage', 'Nuke', 'Anubis', 'Ancient', 'Cache'
  ]);
  assert.ok(operations.maps.every((map) => map.protocol === null));
  assert.equal(operations.opponents.length, 4);
  assert.equal(operations.matches.length, 4);

  const m01 = operations.matches.find((match) => match.id === 'm01');
  assert.ok(m01.cards.some((card) => card.type === 'fact' && /30\.09\.2026/.test(card.body)));
  assert.deepEqual(m01.cards.filter((card) => card.type === 'unknown').map((card) => card.id), [
    'unknown-m01-time', 'unknown-m01-lineup', 'unknown-m01-veto'
  ]);
  assert.ok(m01.cards.filter((card) => card.type === 'action').length <= 3);

  const allowedSources = new Set([
    '/00_context/product.md',
    '/02_sources/2026-08-29-inferno-training-report.md',
    '/03_wiki/metric-equivalent-team-matches.md',
    '/04_synthesis/open-questions.md',
    '/04_synthesis/contradictions.md'
  ]);
  const cards = [...operations.matches, ...operations.training, ...operations.maps, ...operations.opponents]
    .flatMap((entity) => entity.cards);
  for (const card of cards.filter((item) => item.type === 'fact' || item.type === 'projection')) {
    assert.ok(allowedSources.has(card.source), `unexpected operational source: ${card.source}`);
  }
  assert.equal(cards.some((card) => card.type === 'decision' && /anubis|dust\s*2/i.test(card.title + card.body)), false);

  const inferno = operations.training.find((session) => session.mapId === 'inferno');
  assert.equal(inferno.date, '2026-08-29');
  assert.ok(inferno.cards.some((card) => card.type === 'unknown' && /результат/i.test(card.title + card.body)));
});
