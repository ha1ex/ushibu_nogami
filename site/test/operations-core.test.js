import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/operations-core.js', import.meta.url), 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'operations-core.js' });
const Core = sandbox.OperationsCore;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('operational routes are canonical and legacy aliases redirect', () => {
  assert.deepEqual(plain(Core.parseHash('#/seichas')), { section: 'seichas', view: 'now', path: '#/seichas' });
  assert.deepEqual(plain(Core.parseHash('#/match/m01')), { section: 'matchi', view: 'match', id: 'm01', path: '#/match/m01' });
  assert.deepEqual(plain(Core.parseHash('#/karty/inferno')), { section: 'karty', view: 'map', id: 'inferno', path: '#/karty/inferno' });
  assert.deepEqual(plain(Core.parseHash('#/soperniki/pocelui')), { section: 'soperniki', view: 'opponent', id: 'pocelui', path: '#/soperniki/pocelui' });
  for (const [legacy, canonical] of [
    ['#/obzor', '#/seichas'], ['#/taktiki', '#/karty'], ['#/reglament', '#/trenirovki'], ['#/golosovanie', '#/seichas']
  ]) assert.equal(Core.parseHash(legacy).redirect, canonical);
});

test('planned statistics routes and old opponent routes redirect without loading data', () => {
  for (const id of ['m01', 'm02', 'm09', 'm10']) {
    assert.equal(Core.parseHash(`#/statistika/match/${id}`).redirect, `#/match/${id}`);
  }
  assert.equal(Core.parseHash('#/statistika/sopernik/pocelui').redirect, '#/soperniki/pocelui');
  assert.deepEqual(plain(Core.parseHash('#/statistika/match/auto-20231116-1908-de_anubis-Whoajor')), {
    section: 'statistika', view: 'statistics', path: '#/statistika/match/auto-20231116-1908-de_anubis-Whoajor',
    rawHash: '#/statistika/match/auto-20231116-1908-de_anubis-Whoajor'
  });
});

test('malformed identifiers resolve to an honest not-found route', () => {
  for (const hash of ['#/match/m01/extra', '#/karty/../secret', '#/soperniki/pocelui%2Fextra', '#/nope']) {
    assert.equal(Core.parseHash(hash).view, 'not-found');
  }
});

test('match selection uses the real date and falls back to the last scheduled match', () => {
  const matches = [
    { id: 'm09', date: '2026-10-21' }, { id: 'm01', date: '2026-09-30' },
    { id: 'm10', date: '2026-10-22' }, { id: 'm02', date: '2026-10-01' }
  ];
  assert.deepEqual(plain(Core.selectMatch(matches, '2026-10-01')), { match: matches[3], completedFallback: false });
  assert.deepEqual(plain(Core.selectMatch(matches, '2026-10-23')), { match: matches[2], completedFallback: true });
});
