import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_LABELS, MAP_POOL_2026, VETO_MODEL, buildDecisionTree, formatRationale,
  mapSignals, rankMaps, scoreMap, shrink, suggestVerdict,
} from '../lib/veto-model.mjs';

const approx = (actual, expected, label) => {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) < 1e-9,
    `${label}: expected ~${expected}, got ${actual}`,
  );
};

function sums({ rounds = 0, ratingPerRound = 0, roundWins = 0, t = null, ct = null }) {
  return {
    rounds,
    ratingRoundSum: ratingPerRound * rounds,
    roundWins,
    sides: {
      T: { rounds: t?.rounds ?? 0, roundWins: t?.roundWins ?? 0 },
      CT: { rounds: ct?.rounds ?? 0, roundWins: ct?.roundWins ?? 0 },
    },
  };
}

const US_TEAM = { rating: 1.1, roundWinRate: 0.5, tRoundWinRate: 0.48, ctRoundWinRate: 0.52 };
const OPP_TEAM = { rating: 1.0, roundWinRate: 0.5, tRoundWinRate: 0.47, ctRoundWinRate: 0.53 };
const US_SUMS = sums({
  rounds: 250, ratingPerRound: 1.4, roundWins: 150,
  t: { rounds: 125, roundWins: 85 }, ct: { rounds: 125, roundWins: 65 },
});
const OPP_SUMS = sums({
  rounds: 250, ratingPerRound: 0.9, roundWins: 100,
  t: { rounds: 125, roundWins: 60 }, ct: { rounds: 125, roundWins: 40 },
});

test('model constants are frozen and declared', () => {
  assert.equal(VETO_MODEL.version, 'veto-1');
  assert.equal(VETO_MODEL.priorRounds, 250);
  assert.equal(VETO_MODEL.noiseFloor.rating, 0.03);
  assert.equal(VETO_MODEL.noiseFloor.winRate, 0.05);
  approx(VETO_MODEL.weights.ratingEdge + VETO_MODEL.weights.rwrEdge + VETO_MODEL.weights.sideEdge, 1, 'weights sum');
  assert.ok(Object.isFrozen(VETO_MODEL) && Object.isFrozen(VETO_MODEL.weights));
  assert.deepEqual([...MAP_POOL_2026], [
    'de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke',
  ]);
  assert.equal(MAP_LABELS.de_dust2, 'Dust 2');
});

test('shrink pulls toward overall with prior rounds and falls back to overall on empty sample', () => {
  approx(shrink(1.4, 250, 1.0, 250), 1.2, 'balanced shrink');
  approx(shrink(0.7, 0, 1.1, 250), 1.1, 'empty sample equals overall');
});

test('mapSignals returns nulls when either side has zero rounds on the map', () => {
  const empty = sums({});
  for (const [us, opp] of [[empty, OPP_SUMS], [US_SUMS, empty], [empty, empty]]) {
    const signals = mapSignals(us, opp, US_TEAM, OPP_TEAM);
    assert.equal(signals.ratingEdge, null);
    assert.equal(signals.rwrEdge, null);
    assert.equal(signals.sideEdge, null);
    assert.equal(signals.expT, null);
    assert.equal(signals.expCT, null);
    assert.equal(signals.sideRates, null);
  }
});

test('mapSignals computes shrunk rating, winrate and side-matchup edges', () => {
  const signals = mapSignals(US_SUMS, OPP_SUMS, US_TEAM, OPP_TEAM);
  approx(signals.ratingEdge, 0.3, 'ratingEdge');           // 1.25 - 0.95
  approx(signals.rwrEdge, 0.1, 'rwrEdge');                 // 0.55 - 0.45
  approx(signals.sideRates.usT, 205 / 375, 'usT');
  approx(signals.sideRates.oppCT, 172.5 / 375, 'oppCT');
  approx(signals.expT, (205 / 375 + 1 - 172.5 / 375) / 2, 'expT');
  approx(signals.expCT, (0.52 + 1 - 177.5 / 375) / 2, 'expCT');
  approx(signals.sideEdge, (signals.expT + signals.expCT) / 2 - 0.5, 'sideEdge');
});

test('scoreMap normalizes by noise floor, discounts by sample and assigns bands', () => {
  const strong = scoreMap(mapSignals(US_SUMS, OPP_SUMS, US_TEAM, OPP_TEAM), 250, 250);
  approx(strong.score, 0.5 * (0.5 * (0.3 / 0.03) + 0.3 * (0.1 / 0.05) + 0.2 * ((1 / 30) / 0.05)), 'score');
  assert.equal(strong.band, 'pick-candidate');

  const weakSignals = { ratingEdge: 0.01, rwrEdge: 0.01, sideEdge: 0.005 };
  const weak = scoreMap(weakSignals, 50, 50);
  assert.equal(weak.band, 'neutral');
  assert.ok(Math.abs(weak.score) < 1);

  const negative = scoreMap({ ratingEdge: -0.3, rwrEdge: -0.1, sideEdge: -0.03 }, 250, 250);
  assert.equal(negative.band, 'ban-candidate');
  assert.ok(negative.score <= -1);

  const noData = scoreMap({ ratingEdge: null, rwrEdge: null, sideEdge: null }, 0, 250);
  assert.equal(noData.score, null);
  assert.equal(noData.band, 'no-data');
});

function rankedFixture() {
  const mk = (ratingEdge, rwrEdge, sideEdge) => ({ ratingEdge, rwrEdge, sideEdge });
  const none = mk(null, null, null);
  return rankMaps([
    { map: 'de_ancient', signals: none, usRounds: 0, oppRounds: 40 },
    { map: 'de_anubis', signals: mk(0.3, 0.1, 0.03), usRounds: 250, oppRounds: 250 },
    { map: 'de_dust2', signals: mk(-0.18, -0.06, -0.02), usRounds: 250, oppRounds: 250 },
    { map: 'de_mirage', signals: mk(0.005, 0.004, 0.001), usRounds: 250, oppRounds: 250 },
    { map: 'de_nuke', signals: mk(-0.18, -0.06, -0.02), usRounds: 250, oppRounds: 500 },
    { map: 'de_cache', signals: none, usRounds: 12, oppRounds: 0 },
  ]);
}

test('rankMaps sorts by score descending with no-data rows last by name', () => {
  const ranking = rankedFixture();
  assert.deepEqual(
    ranking.map(({ map }) => map),
    ['de_anubis', 'de_mirage', 'de_dust2', 'de_nuke', 'de_ancient', 'de_cache'],
  );
  assert.equal(ranking[0].band, 'pick-candidate');
  assert.equal(ranking[4].band, 'no-data');
  assert.deepEqual(ranking[3].sample, { usRounds: 250, oppRounds: 500 });
  approx(ranking[2].score, ranking[3].score, 'equal scores preserved');
});

test('suggestVerdict picks top score and bans lowest score with opponent-experience tie-break', () => {
  const verdict = suggestVerdict(rankedFixture());
  assert.equal(verdict.pick, 'de_anubis');
  assert.equal(verdict.ban, 'de_nuke'); // same score as dust2, opponent has more rounds there
  assert.deepEqual(verdict.backup, ['de_mirage', 'de_dust2']);
});

test('comfort input never changes scores or ordering', () => {
  const base = rankedFixture();
  const withComfort = rankMaps(rankedFixture().map((row) => ({
    map: row.map,
    signals: row.components,
    usRounds: row.sample.usRounds,
    oppRounds: row.sample.oppRounds,
    comfort: { votes: 5, pct: 83, practiced: true },
  })));
  assert.deepEqual(withComfort.map(({ map, score }) => [map, score]), base.map(({ map, score }) => [map, score]));
  assert.deepEqual(withComfort[0].comfort, { votes: 5, pct: 83, practiced: true });
});

test('buildDecisionTree answers every possible opponent removal with our next-best pick', () => {
  const ranking = rankedFixture();
  const verdict = suggestVerdict(ranking);
  const tree = buildDecisionTree(ranking, verdict, {
    format: 'BO1',
    assumedVetoOrder: ['ban-us', 'ban-opp', 'pick-us'],
    vetoOrderConfirmed: false,
  });
  assert.equal(tree.format, 'BO1');
  assert.equal(tree.orderConfirmed, false);
  assert.deepEqual(tree.assumedOrder, ['ban-us', 'ban-opp', 'pick-us']);
  const triggers = tree.branches.map(({ trigger }) => trigger.map);
  assert.deepEqual(triggers, ['de_anubis', 'de_mirage', 'de_dust2', 'de_ancient', 'de_cache']);
  for (const branch of tree.branches) {
    assert.deepEqual(Object.keys(branch.trigger).sort(), ['action', 'actor', 'map']);
    assert.equal(branch.trigger.actor, 'opponent');
    assert.equal(branch.trigger.action, 'ban');
    assert.equal(branch.response.action, 'pick');
    assert.ok(typeof branch.response.why === 'string' && branch.response.why.length > 0);
  }
  assert.equal(tree.branches[0].response.map, 'de_mirage'); // anubis banned -> next best
  assert.equal(tree.branches[1].response.map, 'de_anubis'); // mirage banned -> top stays
  assert.equal(tree.branches.some(({ trigger }) => trigger.map === verdict.ban), false);
});

test('formatRationale renders deterministic Russian summaries', () => {
  const ranking = rankedFixture();
  const anubis = ranking.find(({ map }) => map === 'de_anubis');
  const withRates = {
    ...anubis,
    components: {
      ...anubis.components,
      sideRates: { usT: 0.689, usCT: 0.545, oppT: 0.501, oppCT: 0.39 },
    },
  };
  assert.equal(
    formatRationale(withRates),
    'Anubis: rating +0.30, WR +10 п.п., наши T 68.9% против их CT 39.0%; выборка 250/250 раундов.',
  );
  const cache = ranking.find(({ map }) => map === 'de_cache');
  assert.equal(formatRationale(cache), 'Cache: нет данных за окно (выборка 12/0 раундов).');
});
