/* Вето-движок veto-1: чистые функции над агрегированными player-round суммами.
   Комфорт команды (голоса, тренировки) в скоринг не входит — только цифры;
   см. /05_decisions/veto-framework.md. */

export const MAP_POOL_2026 = Object.freeze([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke',
]);

export const MAP_LABELS = Object.freeze({
  de_ancient: 'Ancient', de_anubis: 'Anubis', de_cache: 'Cache', de_dust2: 'Dust 2',
  de_inferno: 'Inferno', de_mirage: 'Mirage', de_nuke: 'Nuke',
});

export const VETO_MODEL = Object.freeze({
  version: 'veto-1',
  priorRounds: 250,
  // 0.03 — шумовой пол rating из /03_wiki/metric-estimated-strength.md; 0.05 для winrate — ASSUMPTION.
  noiseFloor: Object.freeze({ rating: 0.03, winRate: 0.05 }),
  weights: Object.freeze({ ratingEdge: 0.5, rwrEdge: 0.3, sideEdge: 0.2 }),
});

export function shrink(raw, rounds, overall, prior = VETO_MODEL.priorRounds) {
  return (raw * rounds + overall * prior) / (rounds + prior);
}

function sideRate(side, overallRate) {
  const raw = side.rounds ? side.roundWins / side.rounds : 0;
  return shrink(raw, side.rounds, overallRate);
}

export function mapSignals(usSums, oppSums, usTeam, oppTeam) {
  if (!usSums.rounds || !oppSums.rounds) {
    return { ratingEdge: null, rwrEdge: null, sideEdge: null, expT: null, expCT: null, sideRates: null };
  }
  const ratingEdge = shrink(usSums.ratingRoundSum / usSums.rounds, usSums.rounds, usTeam.rating)
    - shrink(oppSums.ratingRoundSum / oppSums.rounds, oppSums.rounds, oppTeam.rating);
  const rwrEdge = shrink(usSums.roundWins / usSums.rounds, usSums.rounds, usTeam.roundWinRate)
    - shrink(oppSums.roundWins / oppSums.rounds, oppSums.rounds, oppTeam.roundWinRate);
  const sideRates = {
    usT: sideRate(usSums.sides.T, usTeam.tRoundWinRate),
    usCT: sideRate(usSums.sides.CT, usTeam.ctRoundWinRate),
    oppT: sideRate(oppSums.sides.T, oppTeam.tRoundWinRate),
    oppCT: sideRate(oppSums.sides.CT, oppTeam.ctRoundWinRate),
  };
  const expT = (sideRates.usT + 1 - sideRates.oppCT) / 2;
  const expCT = (sideRates.usCT + 1 - sideRates.oppT) / 2;
  return { ratingEdge, rwrEdge, sideEdge: (expT + expCT) / 2 - 0.5, expT, expCT, sideRates };
}

export function scoreMap(signals, usRounds, oppRounds) {
  if (signals.ratingEdge === null || signals.rwrEdge === null || signals.sideEdge === null) {
    return { score: null, band: 'no-data' };
  }
  const { weights, noiseFloor, priorRounds } = VETO_MODEL;
  const effectiveRounds = Math.min(usRounds, oppRounds);
  const sampleWeight = effectiveRounds / (effectiveRounds + priorRounds);
  const score = sampleWeight * (
    weights.ratingEdge * (signals.ratingEdge / noiseFloor.rating)
    + weights.rwrEdge * (signals.rwrEdge / noiseFloor.winRate)
    + weights.sideEdge * (signals.sideEdge / noiseFloor.winRate)
  );
  const band = score >= 1 ? 'pick-candidate' : score <= -1 ? 'ban-candidate' : 'neutral';
  return { score, band };
}

export function rankMaps(rows) {
  return rows.map((row) => {
    const { score, band } = scoreMap(row.signals, row.usRounds, row.oppRounds);
    return {
      map: row.map,
      score,
      band,
      components: row.signals,
      sample: { usRounds: row.usRounds, oppRounds: row.oppRounds },
      ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
      ...(row.comfort !== undefined ? { comfort: row.comfort } : {}),
    };
  }).sort((left, right) => {
    if (left.score === null && right.score === null) return left.map.localeCompare(right.map);
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score || left.map.localeCompare(right.map);
  });
}

export function suggestVerdict(ranking) {
  const scored = ranking.filter(({ score }) => score !== null);
  const pick = scored[0]?.map ?? null;
  const banCandidates = ranking.filter(({ map }) => map !== pick);
  const scoredBans = banCandidates.filter(({ score }) => score !== null)
    .sort((left, right) => left.score - right.score
      || right.sample.oppRounds - left.sample.oppRounds
      || left.map.localeCompare(right.map));
  const ban = scoredBans[0]?.map ?? banCandidates[0]?.map ?? null;
  const backup = ranking
    .filter(({ map, score }) => score !== null && map !== pick && map !== ban)
    .slice(0, 2)
    .map(({ map }) => map);
  return { pick, ban, backup };
}

export function buildDecisionTree(ranking, verdict, context) {
  const branches = ranking.filter(({ map }) => map !== verdict.ban).map(({ map }) => {
    const response = ranking.find((candidate) => candidate.score !== null
      && candidate.map !== verdict.ban && candidate.map !== map);
    return {
      trigger: { actor: 'opponent', action: 'ban', map },
      response: {
        action: 'pick',
        map: response?.map ?? null,
        why: response
          ? (response.map === verdict.pick
            ? `${MAP_LABELS[response.map] ?? response.map} остаётся лучшим по score`
            : `следующий по score после ${MAP_LABELS[map] ?? map}`)
          : 'нет карт с данными — решать по месту',
      },
    };
  });
  return {
    format: context.format,
    assumedOrder: [...context.assumedVetoOrder],
    orderConfirmed: context.vetoOrderConfirmed === true,
    branches,
  };
}

function signed(value, digits) {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;
}

export function formatRationale(row) {
  const label = MAP_LABELS[row.map] ?? row.map;
  if (row.score === null) {
    return `${label}: нет данных за окно (выборка ${row.sample.usRounds}/${row.sample.oppRounds} раундов).`;
  }
  const { ratingEdge, rwrEdge, sideRates } = row.components;
  return `${label}: rating ${signed(ratingEdge, 2)}, WR ${signed(rwrEdge * 100, 0)} п.п., `
    + `наши T ${(sideRates.usT * 100).toFixed(1)}% против их CT ${(sideRates.oppCT * 100).toFixed(1)}%; `
    + `выборка ${row.sample.usRounds}/${row.sample.oppRounds} раундов.`;
}
