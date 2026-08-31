import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_ROOT, RECENT_WINDOW } from './web-data.mjs';

const SUM_FIELDS = [
  'rounds', 'ratingRoundSum', 'damage', 'kills', 'deaths', 'kastRounds', 'roundWins',
  'openingKills', 'openingDeaths', 'flashAssists', 'utilityDamage', 'tradeKills',
  'deathsTraded', 'retakeAttempts', 'retakeWins', 'postplantRounds', 'postplantWins',
  'clutchAttempts', 'clutchWins',
];
const BUY_TYPES = ['eco', 'force', 'full', 'pistol'];
const SIDES = ['T', 'CT'];
const TEAM_METRIC_KEYS = [
  'rating', 'roundWinRate', 'openingDiffPer100', 'retakeWinRate', 'postplantWinRate',
  'clutchWinRate', 'forceWinRate', 'fullWinRate', 'tRoundWinRate', 'ctRoundWinRate',
  'utilityDamagePerRound', 'tradeRate',
];
// Активный пул сезона — /03_wiki/map-pool-2026.md. mapEdges покрывают 32 карты,
// включая коммьюнити- и воркшоп-карты; зеркальное вето считаем только по пулу.
const SUFFICIENT_SAMPLE_ROUNDS = 200;
const ACTIVE_MAP_POOL = [
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke',
];
const REVIEWED_SCHEDULE = [
  { matchId: 'm01', date: '2026-09-30', opponentTeamId: 'pocelui' },
  { matchId: 'm02', date: '2026-10-01', opponentTeamId: 'takahuli' },
  { matchId: 'm09', date: '2026-10-21', opponentTeamId: 'rassadnik' },
  { matchId: 'm10', date: '2026-10-22', opponentTeamId: 'smoke' },
];

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function emptySide() {
  return {
    rounds: 0, roundWins: 0, kills: 0, deaths: 0, assists: 0, kastRounds: 0,
    damage: 0, openingKills: 0, openingDeaths: 0, flashAssists: 0,
    utilityDamage: 0, tradeKills: 0,
  };
}

function emptySums() {
  return {
    ...Object.fromEntries(SUM_FIELDS.map((field) => [field, 0])),
    roundsByBuy: Object.fromEntries(BUY_TYPES.map((type) => [type, 0])),
    winsByBuy: Object.fromEntries(BUY_TYPES.map((type) => [type, 0])),
    sides: { T: emptySide(), CT: emptySide() },
  };
}

function addSums(target, source) {
  for (const field of SUM_FIELDS) target[field] += source[field] ?? 0;
  for (const type of BUY_TYPES) {
    target.roundsByBuy[type] += source.roundsByBuy?.[type] ?? 0;
    target.winsByBuy[type] += source.winsByBuy?.[type] ?? 0;
  }
  for (const side of SIDES) {
    for (const field of Object.keys(target.sides[side])) {
      target.sides[side][field] += source.sides?.[side]?.[field] ?? 0;
    }
  }
  return target;
}

function matchSums(match) {
  const rounds = match.roundsPlayed ?? 0;
  const sums = emptySums();
  Object.assign(sums, {
    rounds,
    ratingRoundSum: (match.rating2 ?? 0) * rounds,
    damage: match.damage ?? 0,
    kills: match.kills ?? 0,
    deaths: match.deaths ?? 0,
    kastRounds: Math.round((match.kastPercent ?? 0) * rounds / 100),
    roundWins: match.roundsWon ?? 0,
    openingKills: match.openingKills ?? 0,
    openingDeaths: match.openingDeaths ?? 0,
    flashAssists: match.flashAssists ?? 0,
    utilityDamage: match.utilityDamage ?? 0,
    tradeKills: match.tradeKills ?? 0,
    deathsTraded: match.deathsTraded ?? 0,
    retakeAttempts: match.retakeAttempts ?? 0,
    retakeWins: match.retakeWins ?? 0,
    postplantRounds: match.postplantRounds ?? 0,
    postplantWins: match.postplantWins ?? 0,
    clutchAttempts: SIDES.reduce((total, side) => total + (match.bySide?.[side]?.clutchAttempts ?? 0), 0),
    clutchWins: SIDES.reduce((total, side) => total + (match.bySide?.[side]?.clutchWins ?? 0), 0),
  });
  for (const type of BUY_TYPES) {
    sums.roundsByBuy[type] = match.roundsByBuy?.[type] ?? 0;
    sums.winsByBuy[type] = match.winsByBuy?.[type] ?? 0;
  }
  for (const side of SIDES) {
    const value = match.bySide?.[side] ?? {};
    sums.sides[side] = {
      rounds: value.rounds ?? 0,
      roundWins: value.roundsWon ?? 0,
      kills: value.kills ?? 0,
      deaths: value.deaths ?? 0,
      assists: value.assists ?? 0,
      kastRounds: value.kastRounds ?? 0,
      damage: value.damage ?? 0,
      openingKills: value.openingKills ?? 0,
      openingDeaths: value.openingDeaths ?? 0,
      flashAssists: value.flashAssists ?? 0,
      utilityDamage: value.utilityDamage ?? 0,
      tradeKills: value.tradeKills ?? 0,
    };
  }
  return sums;
}

function sideMetrics(sums) {
  const kpr = ratio(sums.kills, sums.rounds) ?? 0;
  const dpr = ratio(sums.deaths, sums.rounds) ?? 0;
  const apr = ratio(sums.assists, sums.rounds) ?? 0;
  const kastPct = (ratio(sums.kastRounds, sums.rounds) ?? 0) * 100;
  const adr = ratio(sums.damage, sums.rounds) ?? 0;
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  return {
    rating: sums.rounds
      ? 0.0073 * kastPct + 0.3591 * kpr - 0.5329 * dpr
        + 0.2372 * impact + 0.0032 * adr + 0.1587
      : null,
    adr: ratio(sums.damage, sums.rounds),
    roundWinRate: ratio(sums.roundWins, sums.rounds),
    openingDiffPer100: sums.rounds
      ? ((sums.openingKills - sums.openingDeaths) / sums.rounds) * 100
      : null,
  };
}

function derivedMetrics(sums) {
  return {
    rating: ratio(sums.ratingRoundSum, sums.rounds),
    adr: ratio(sums.damage, sums.rounds),
    kd: ratio(sums.kills, sums.deaths),
    kast: ratio(sums.kastRounds, sums.rounds),
    roundWinRate: ratio(sums.roundWins, sums.rounds),
    openingDiffPer100: sums.rounds
      ? ((sums.openingKills - sums.openingDeaths) / sums.rounds) * 100
      : null,
    flashAssistsPer100: sums.rounds ? (sums.flashAssists / sums.rounds) * 100 : null,
    utilityDamagePerRound: ratio(sums.utilityDamage, sums.rounds),
    tradeRate: ratio(sums.deathsTraded, sums.deaths),
    retakeWinRate: ratio(sums.retakeWins, sums.retakeAttempts),
    postplantWinRate: ratio(sums.postplantWins, sums.postplantRounds),
    clutchWinRate: ratio(sums.clutchWins, sums.clutchAttempts),
    ecoWinRate: ratio(sums.winsByBuy.eco, sums.roundsByBuy.eco),
    forceWinRate: ratio(sums.winsByBuy.force, sums.roundsByBuy.force),
    fullWinRate: ratio(sums.winsByBuy.full, sums.roundsByBuy.full),
    pistolWinRate: ratio(sums.winsByBuy.pistol, sums.roundsByBuy.pistol),
    tRoundWinRate: ratio(sums.sides.T.roundWins, sums.sides.T.rounds),
    ctRoundWinRate: ratio(sums.sides.CT.roundWins, sums.sides.CT.rounds),
    sides: { T: sideMetrics(sums.sides.T), CT: sideMetrics(sums.sides.CT) },
  };
}

function windowResult(matches) {
  const sums = matches.reduce((total, match) => addSums(total, matchSums(match)), emptySums());
  return { sums, metrics: derivedMetrics(sums) };
}

function median(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadRosterPlayers(db, config) {
  const draft = new Map(db.prepare(`select steamid, source_json from draft_players`).all()
    .map(({ steamid, source_json: sourceJson }) => {
      const source = JSON.parse(sourceJson);
      return [source.name.normalize('NFKC'), {
        steamid, publishedDraftName: source.name, draftRating: source.rating,
      }];
    }));
  const displayNames = new Map(db.prepare('select steamid, display_name from players').all()
    .map(({ steamid, display_name: displayName }) => [steamid, displayName]));
  const teams = config.teams.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    players: team.players.map((draftName) => {
      const player = draft.get(draftName.normalize('NFKC'));
      if (!player) throw new Error(`unmapped roster player: ${team.teamId}/${draftName}`);
      return {
        ...player, draftName, displayName: displayNames.get(player.steamid), mapped: true,
      };
    }),
  }));
  const all = teams.flatMap(({ players }) => players);
  if (all.length !== 30 || new Set(all.map(({ steamid }) => steamid)).size !== 30) {
    throw new Error('roster mapping must resolve 30 unique players');
  }
  return teams;
}

function playerMatches(db, steamid) {
  return db.prepare(`
    select m.map, m.started_at startedAt, mp.source_json sourceJson
    from match_players mp join matches m on m.match_id = mp.match_id
    where mp.steamid = ? order by m.started_at, m.match_id`).all(steamid)
    .map(({ map, startedAt, sourceJson }) => ({ map, startedAt, ...JSON.parse(sourceJson) }));
}

function mapWindows(matches, cutoff) {
  const grouped = new Map();
  for (const match of matches.filter(({ startedAt }) => startedAt.slice(0, 10) >= cutoff)) {
    if (!grouped.has(match.map)) grouped.set(match.map, []);
    grouped.get(match.map).push(match);
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([map, rows]) => [map, windowResult(rows)]));
}

function confirmedLineup(db, roster) {
  const placeholders = roster.players.map(() => '?').join(',');
  const rows = db.prepare(`
    select rr.match_id matchId, rr.round, rr.side, count(distinct rr.steamid) rosterPlayers
    from round_rosters rr
    where rr.steamid in (${placeholders})
    group by rr.match_id, rr.round, rr.side
    order by rr.match_id, rr.round, rr.side`).all(...roster.players.map(({ steamid }) => steamid));
  const byMatch = new Map();
  for (const row of rows) {
    if (!byMatch.has(row.matchId)) byMatch.set(row.matchId, new Map());
    const rounds = byMatch.get(row.matchId);
    rounds.set(row.round, Math.max(rounds.get(row.round) ?? 0, row.rosterPlayers));
  }
  const roundCounts = new Map(db.prepare('select match_id matchId, count(*) rounds from match_rounds group by match_id').all()
    .map(({ matchId, rounds }) => [matchId, rounds]));
  const matches = [];
  for (const [matchId, rounds] of byMatch) {
    const totalRounds = roundCounts.get(matchId);
    const qualifyingRounds = [...rounds.values()].filter((count) => count >= 5).length;
    const roundShare = qualifyingRounds / totalRounds;
    if (roundShare >= 0.8) matches.push({ matchId, qualifyingRounds, totalRounds, roundShare });
  }
  return {
    criterion: { minRosterPlayers: 5, minRoundShare: 0.8, unit: 'competitive_rounds' },
    confirmedMatches: matches.sort((left, right) => left.matchId.localeCompare(right.matchId)),
    confirmed: matches.length > 0,
  };
}

function buildEvidence(players, teams, mapEdges) {
  const evidence = [
    { id: 'limitation:cohesion', kind: 'limitation', value: 'not_measured', source: 'canonical-v2-round-rosters' },
    { id: 'limitation:positions', kind: 'limitation', value: 'unavailable', source: 'CONTRACT-1.1.0' },
  ];
  for (const player of players) {
    evidence.push(
      { id: `player:${player.steamid}:recent:rating`, kind: 'player_metric', steamid: player.steamid, metric: 'rating', value: player.recent.metrics.rating, sampleRounds: player.recent.sums.rounds },
      { id: `player:${player.steamid}:recent:opening`, kind: 'player_metric', steamid: player.steamid, metric: 'openingDiffPer100', value: player.recent.metrics.openingDiffPer100, sampleRounds: player.recent.sums.rounds },
      { id: `player:${player.steamid}:recent:utility`, kind: 'player_metric', steamid: player.steamid, metric: 'utilityDamagePerRound', value: player.recent.metrics.utilityDamagePerRound, sampleRounds: player.recent.sums.rounds },
    );
  }
  for (const team of teams) {
    for (const metric of TEAM_METRIC_KEYS) {
      const deviation = [...team.scouting.exploits, ...team.scouting.risks]
        .find((item) => item.metric === metric);
      evidence.push({
        id: `team:${team.teamId}:recent:${metric}`,
        kind: 'team_projection_metric',
        teamId: team.teamId,
        metric,
        value: team.recent.metrics[metric],
        samplePlayerRounds: team.recent.sums.rounds,
        ...(deviation ? {
          median: deviation.median,
          delta: deviation.delta,
          classification: team.scouting.exploits.includes(deviation) ? 'exploit' : 'risk',
        } : {}),
      });
    }
    evidence.push({
      id: `confirmed-lineup:${team.teamId}`,
      kind: 'confirmed_lineup',
      teamId: team.teamId,
      value: team.confirmedLineup.confirmed,
      matches: team.confirmedLineup.confirmedMatches.length,
    });
  }
  for (const opponent of mapEdges) {
    for (const map of opponent.maps) {
      evidence.push({
        id: `map-edge:${opponent.opponentTeamId}:${map.map}`,
        kind: 'map_edge',
        opponentTeamId: opponent.opponentTeamId,
        ...map,
      });
    }
  }
  return evidence.sort((left, right) => left.id.localeCompare(right.id));
}

function leagueRanks(teams) {
  const ranks = new Map(teams.map(({ teamId }) => [teamId, {}]));
  for (const metric of TEAM_METRIC_KEYS) {
    const scored = teams.filter((team) => team.recent.metrics[metric] !== null);
    for (const team of scored) {
      const value = team.recent.metrics[metric];
      const better = scored.filter((other) => other.recent.metrics[metric] > value).length;
      ranks.get(team.teamId)[metric] = { rank: better + 1, of: scored.length };
    }
  }
  return ranks;
}

function rankBy(players, metric, direction) {
  return [...players].sort((left, right) => {
    const delta = right.recent.metrics[metric] - left.recent.metrics[metric];
    return (direction === 'asc' ? -delta : delta) || left.steamid.localeCompare(right.steamid);
  });
}

function target(player, kind, metric) {
  return {
    steamid: player.steamid,
    kind,
    metric,
    value: player.recent.metrics[metric],
    sampleRounds: player.recent.sums.rounds,
    evidenceId: `player:${player.steamid}:recent:${kind}`,
  };
}

// Зеркальный скаутинг: как наш профиль выглядит со стороны каждого соперника.
// Переиспользует уже выпущенные evidence-ID, новых свидетельств не вводит.
function buildMirrorScouting(teams, playersByTeam, mapEdges, recommendations) {
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const us = teamById.get('us');
  const eligible = playersByTeam.get('us')
    .filter((player) => player.recent.sums.rounds >= SUFFICIENT_SAMPLE_ROUNDS);
  if (eligible.length === 0) throw new Error('mirror scouting needs at least one eligible player');
  const byRating = rankBy(eligible, 'rating', 'desc');
  const byOpening = rankBy(eligible, 'openingDiffPer100', 'desc');
  const byUtility = rankBy(eligible, 'utilityDamagePerRound', 'desc');
  // Соперник видит те же публичные цифры, что и мы: топ-2 по рейтингу плюс лидеров
  // по открытиям и утилите. Один игрок может попасть в несколько векторов угрозы.
  const focusTargets = [
    ...byRating.slice(0, 2).map((player) => target(player, 'rating', 'rating')),
    target(byOpening[0], 'opening', 'openingDiffPer100'),
    target(byUtility[0], 'utility', 'utilityDamagePerRound'),
  ];
  const softTargets = [
    target(byRating[byRating.length - 1], 'rating', 'rating'),
    target(byOpening[byOpening.length - 1], 'opening', 'openingDiffPer100'),
  ];
  const planByOpponent = new Map(recommendations.map((plan) => [plan.opponentTeamId, plan]));

  return mapEdges.map(({ opponentTeamId, maps }) => {
    const opponent = teamById.get(opponentTeamId);
    const pool = ACTIVE_MAP_POOL.map((map) => {
      const edge = maps.find((item) => item.map === map);
      if (!edge) throw new Error(`mirror scouting missing map edge: ${opponentTeamId}/${map}`);
      return {
        map,
        edge: edge.edge,
        mirrorEdge: -edge.edge,
        significant: edge.significant,
        confidence: edge.confidence,
        usAdjustedRating: edge.us.adjustedRating,
        opponentAdjustedRating: edge.opponent.adjustedRating,
        usPlayerRounds: edge.us.playerRounds,
        opponentPlayerRounds: edge.opponent.playerRounds,
        evidenceId: `map-edge:${opponentTeamId}:${map}`,
      };
    }).sort((left, right) => right.mirrorEdge - left.mirrorEdge
      || left.map.localeCompare(right.map));
    // Вето соперников ни разу не наблюдалось (/04_synthesis/open-questions.md Q2):
    // это проекция силы на карте, а не история пиков.
    const decisive = pool.filter((item) => item.significant);
    const likelyPick = decisive.find((item) => item.mirrorEdge > 0)?.map ?? null;
    const likelyBan = [...decisive].reverse().find((item) => item.mirrorEdge < 0)?.map ?? null;
    const plan = planByOpponent.get(opponentTeamId) ?? null;
    const metricEdges = TEAM_METRIC_KEYS.map((metric) => ({
      metric,
      usValue: us.recent.metrics[metric],
      opponentValue: opponent.recent.metrics[metric],
      delta: us.recent.metrics[metric] === null || opponent.recent.metrics[metric] === null
        ? null : us.recent.metrics[metric] - opponent.recent.metrics[metric],
      usEvidenceId: `team:us:recent:${metric}`,
      opponentEvidenceId: `team:${opponentTeamId}:recent:${metric}`,
    })).filter(({ delta }) => delta !== null).sort((left, right) => left.delta - right.delta);

    return {
      opponentTeamId,
      opponentName: opponent.name,
      sufficientSampleRounds: SUFFICIENT_SAMPLE_ROUNDS,
      sample: {
        usPlayerRounds: us.recent.sums.rounds,
        opponentPlayerRounds: opponent.recent.sums.rounds,
      },
      maps: pool,
      metricEdges,
      likelyPick,
      likelyBan,
      ourPlan: plan ? {
        matchId: plan.matchId, date: plan.date, pick: plan.pick, ban: plan.ban,
      } : null,
      clash: {
        pickContested: Boolean(plan) && likelyBan === plan.pick,
        banConfirmed: Boolean(plan) && likelyPick === plan.ban,
        ourPickMirrorEdge: plan
          ? pool.find((item) => item.map === plan.pick)?.mirrorEdge ?? null
          : null,
      },
      focusTargets,
      softTargets,
      caveatEvidenceIds: ['limitation:cohesion', 'limitation:positions', 'confirmed-lineup:us'],
    };
  });
}

export function validateReviewedRecommendations(config, evidenceIndex, rosters, teams) {
  if (config.snapshotRoot !== CANONICAL_ROOT) throw new Error('recommendations root mismatch');
  if (config.reviewed !== true) throw new Error('recommendations must be reviewed');
  if (config.dataThrough !== RECENT_WINDOW.recentEnd) throw new Error('recommendations are stale');
  if (!Array.isArray(config.plans) || config.plans.length !== 4) throw new Error('exactly four plans required');
  const rosterById = new Map(rosters.map((roster) => [roster.teamId, roster]));
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const ourPlayers = new Map(rosterById.get('us').players.map((player) => [player.draftName, player]));
  const matchIds = config.plans.map(({ matchId }) => matchId);
  if (new Set(matchIds).size !== matchIds.length) throw new Error('duplicate matchId');
  return config.plans.map((plan, index) => {
    const expected = REVIEWED_SCHEDULE[index];
    if (plan.matchId !== expected.matchId) throw new Error(`unknown matchId: ${plan.matchId}`);
    if (plan.date !== expected.date || plan.opponentTeamId !== expected.opponentTeamId) {
      throw new Error(`schedule mismatch for ${plan.matchId}`);
    }
    if (!rosterById.has(plan.opponentTeamId) || plan.opponentTeamId === 'us') {
      throw new Error(`unknown opponent: ${plan.opponentTeamId}`);
    }
    for (const field of ['pick', 'ban', 'contingency', 'confidence']) {
      if (!plan[field]) throw new Error(`${plan.opponentTeamId} missing ${field}`);
    }
    for (const field of ['backup', 'threatEvidence', 'weaknessEvidence', 'mapEvidence', 'do', 'dont', 'trainingChecklist', 'matchdayChecklist', 'caveats']) {
      if (!Array.isArray(plan[field]) || plan[field].length === 0) throw new Error(`${plan.opponentTeamId} missing ${field}`);
    }
    const scouting = teamById.get(plan.opponentTeamId).scouting;
    const requiredThreats = [
      ...scouting.ratingThreats.map(({ evidenceId }) => evidenceId),
      scouting.openingLeader?.evidenceId,
      scouting.utilityLeader?.evidenceId,
    ].filter(Boolean);
    if (new Set(plan.threatEvidence).size !== plan.threatEvidence.length
      || plan.threatEvidence.length !== requiredThreats.length
      || requiredThreats.some((id) => !plan.threatEvidence.includes(id))) {
      throw new Error(`${plan.opponentTeamId} threat evidence mismatch`);
    }
    const exploits = new Map(scouting.exploits.map((item) => [item.evidenceId, item]));
    if (new Set(plan.weaknessEvidence).size !== plan.weaknessEvidence.length) {
      throw new Error(`${plan.opponentTeamId} duplicate weakness evidence`);
    }
    if (plan.weaknessEvidence.some((id) => !(exploits.get(id)?.delta < 0))) {
      throw new Error(`${plan.opponentTeamId} weakness is not an exploit`);
    }
    const overrides = plan.mapOverrides ?? [];
    for (const [action, expectedSign] of [['pick', 1], ['ban', -1]]) {
      const mapEvidenceId = `map-edge:${plan.opponentTeamId}:${plan[action]}`;
      if (!plan.mapEvidence.includes(mapEvidenceId)) {
        throw new Error(`${plan.opponentTeamId} missing evidence: ${mapEvidenceId}`);
      }
      const mapEvidence = evidenceIndex.get(mapEvidenceId);
      const override = overrides.find((item) => item.action === action && item.map === plan[action]);
      if (!(mapEvidence.edge * expectedSign > 0)) {
        if (!override || typeof override.rationale !== 'string' || override.rationale.length < 20
          || !Array.isArray(override.evidenceIds) || override.evidenceIds.length === 0) {
          throw new Error(`${plan.opponentTeamId} map direction requires override`);
        }
        if (!override.evidenceIds.includes(mapEvidenceId)) {
          throw new Error(`${plan.opponentTeamId} map override must cite its map evidence`);
        }
      }
    }
    const references = [
      ...plan.threatEvidence, ...plan.weaknessEvidence, ...plan.mapEvidence,
      ...plan.caveats.map(({ evidenceId }) => evidenceId),
      ...overrides.flatMap(({ evidenceIds = [] }) => evidenceIds),
    ];
    const missing = references.filter((id) => !evidenceIndex.has(id));
    if (missing.length) throw new Error(`${plan.opponentTeamId} missing evidence: ${missing.join(', ')}`);
    if (plan.personalTasks.length !== 6) throw new Error(`${plan.opponentTeamId} needs six personal tasks`);
    const personalTasks = plan.personalTasks.map((task) => {
      const player = ourPlayers.get(task.draftName);
      if (!player) throw new Error(`${plan.opponentTeamId} unknown personal task player: ${task.draftName}`);
      return { ...task, steamid: player.steamid };
    });
    return {
      ...plan,
      snapshotRoot: config.snapshotRoot,
      dataThrough: config.dataThrough,
      reviewed: config.reviewed,
      reviewedAt: config.reviewedAt,
      personalTasks,
      threats: plan.threatEvidence.map((id) => evidenceIndex.get(id)),
      weaknesses: plan.weaknessEvidence.map((id) => evidenceIndex.get(id)),
      maps: plan.mapEvidence.map((id) => evidenceIndex.get(id)),
    };
  });
}

export async function buildCalculatedDatasets(db, configDir, recommendationPath) {
  const rosterConfig = JSON.parse(await readFile(join(configDir, 'team-rosters.json'), 'utf8'));
  const recommendationConfig = JSON.parse(await readFile(
    recommendationPath ?? join(configDir, 'match-recommendations.json'),
    'utf8',
  ));
  const rosters = loadRosterPlayers(db, rosterConfig);
  const playerMetrics = [];
  for (const roster of rosters) {
    for (const player of roster.players) {
      const matches = playerMatches(db, player.steamid);
      const recentMatches = matches.filter(({ startedAt }) => startedAt.slice(0, 10) >= RECENT_WINDOW.recentStart
        && startedAt.slice(0, 10) <= RECENT_WINDOW.recentEnd);
      playerMetrics.push({
        teamId: roster.teamId,
        ...player,
        recent: windowResult(recentMatches),
        allTime: windowResult(matches),
        maps: {
          recent: mapWindows(matches.filter(({ startedAt }) => startedAt.slice(0, 10) <= RECENT_WINDOW.recentEnd), RECENT_WINDOW.recentStart),
          allTime: mapWindows(matches, '0000-00-00'),
        },
      });
    }
  }
  const playersByTeam = new Map(rosters.map(({ teamId }) => [
    teamId, playerMetrics.filter((player) => player.teamId === teamId),
  ]));
  const teamMetrics = rosters.map((roster) => {
    const players = playersByTeam.get(roster.teamId);
    const recentSums = players.reduce((sum, player) => addSums(sum, player.recent.sums), emptySums());
    const allTimeSums = players.reduce((sum, player) => addSums(sum, player.allTime.sums), emptySums());
    const top5 = [...roster.players].sort((left, right) => right.draftRating - left.draftRating
      || left.steamid.localeCompare(right.steamid)).slice(0, 5);
    return {
      teamId: roster.teamId,
      name: roster.name,
      projectionPlayerCount: 6,
      methodology: { aggregation: 'numerator_denominator_sums', cohesion: 'not_measured' },
      publishedDraftAverage: roster.players.reduce((sum, player) => sum + player.draftRating, 0) / 6,
      publishedDraftTop5Average: top5.reduce((sum, player) => sum + player.draftRating, 0) / 5,
      top5,
      recent: { sums: recentSums, metrics: derivedMetrics(recentSums) },
      allTime: { sums: allTimeSums, metrics: derivedMetrics(allTimeSums) },
      confirmedLineup: confirmedLineup(db, roster),
    };
  });
  const teamById = new Map(teamMetrics.map((team) => [team.teamId, team]));
  const mapTeam = (teamId) => {
    const maps = new Map();
    for (const player of playersByTeam.get(teamId)) {
      for (const [map, result] of Object.entries(player.maps.recent)) {
        if (!maps.has(map)) maps.set(map, emptySums());
        addSums(maps.get(map), result.sums);
      }
    }
    return maps;
  };
  const usMaps = mapTeam('us');
  const mapEdges = rosters.filter(({ teamId }) => teamId !== 'us').map((roster) => {
    const opponentMaps = mapTeam(roster.teamId);
    const maps = [...new Set([...usMaps.keys(), ...opponentMaps.keys()])].sort().map((map) => {
      const usSums = usMaps.get(map) ?? emptySums();
      const opponentSums = opponentMaps.get(map) ?? emptySums();
      const usOverall = teamById.get('us').recent.metrics.rating;
      const opponentOverall = teamById.get(roster.teamId).recent.metrics.rating;
      const usRaw = ratio(usSums.ratingRoundSum, usSums.rounds) ?? usOverall;
      const opponentRaw = ratio(opponentSums.ratingRoundSum, opponentSums.rounds) ?? opponentOverall;
      const usAdjusted = (usRaw * usSums.rounds + usOverall * 250) / (usSums.rounds + 250);
      const opponentAdjusted = (opponentRaw * opponentSums.rounds + opponentOverall * 250) / (opponentSums.rounds + 250);
      const edge = usAdjusted - opponentAdjusted;
      const low = usSums.rounds < 200 || opponentSums.rounds < 200;
      return {
        map,
        us: { rawRating: usRaw, adjustedRating: usAdjusted, overallRating: usOverall, playerRounds: usSums.rounds },
        opponent: { rawRating: opponentRaw, adjustedRating: opponentAdjusted, overallRating: opponentOverall, playerRounds: opponentSums.rounds },
        edge,
        significant: Math.abs(edge) >= 0.03,
        confidence: low ? 'low' : (usSums.rounds >= 500 && opponentSums.rounds >= 500 ? 'high' : 'medium'),
      };
    });
    return { opponentTeamId: roster.teamId, maps };
  });
  const medians = Object.fromEntries(TEAM_METRIC_KEYS.map((metric) => [
    metric, median(teamMetrics.map((team) => team.recent.metrics[metric])),
  ]));
  const ranks = leagueRanks(teamMetrics);
  for (const team of teamMetrics) {
    const deviations = TEAM_METRIC_KEYS.map((metric) => ({
      metric,
      value: team.recent.metrics[metric],
      median: medians[metric],
      delta: team.recent.metrics[metric] === null || medians[metric] === null
        ? null : team.recent.metrics[metric] - medians[metric],
      evidenceId: `team:${team.teamId}:recent:${metric}`,
    })).filter(({ delta }) => delta !== null);
    const eligible = playersByTeam.get(team.teamId)
      .filter((player) => player.recent.sums.rounds >= SUFFICIENT_SAMPLE_ROUNDS);
    const ratingRank = [...eligible].sort((left, right) => right.recent.metrics.rating - left.recent.metrics.rating);
    const openingRank = [...eligible].sort((left, right) => right.recent.metrics.openingDiffPer100 - left.recent.metrics.openingDiffPer100);
    const utilityRank = [...eligible].sort((left, right) => right.recent.metrics.utilityDamagePerRound - left.recent.metrics.utilityDamagePerRound);
    const ratingThreatIds = new Set(ratingRank.slice(0, 2).map(({ steamid }) => steamid));
    team.scouting = {
      sufficientSampleRounds: SUFFICIENT_SAMPLE_ROUNDS,
      leagueRanks: ranks.get(team.teamId),
      ratingThreats: ratingRank.slice(0, 2).map((player) => ({ steamid: player.steamid, evidenceId: `player:${player.steamid}:recent:rating` })),
      openingLeader: openingRank[0] && !ratingThreatIds.has(openingRank[0].steamid)
        ? { steamid: openingRank[0].steamid, evidenceId: `player:${openingRank[0].steamid}:recent:opening` }
        : null,
      utilityLeader: utilityRank[0] && !ratingThreatIds.has(utilityRank[0].steamid)
        ? { steamid: utilityRank[0].steamid, evidenceId: `player:${utilityRank[0].steamid}:recent:utility` }
        : null,
      exploits: [...deviations].sort((left, right) => left.delta - right.delta).slice(0, 3),
      risks: [...deviations].sort((left, right) => right.delta - left.delta).slice(0, 3),
    };
  }
  const evidence = buildEvidence(playerMetrics, teamMetrics, mapEdges);
  const recommendations = validateReviewedRecommendations(
    recommendationConfig,
    new Map(evidence.map((item) => [item.id, item])),
    rosters,
    teamMetrics,
  );
  const mirrorScouting = buildMirrorScouting(
    teamMetrics,
    playersByTeam,
    mapEdges,
    recommendations,
  );
  return {
    rosters, playerMetrics, teamMetrics, mapEdges, evidence, recommendations, mirrorScouting,
  };
}
