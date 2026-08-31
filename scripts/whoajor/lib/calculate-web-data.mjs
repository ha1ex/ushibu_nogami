import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_ROOT, RECENT_WINDOW } from './web-data.mjs';
import {
  MAP_POOL_2026, VETO_MODEL, buildDecisionTree, formatRationale,
  mapSignals, rankMaps, shrink, suggestVerdict,
} from './veto-model.mjs';

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
const LEGACY_PLAN_FIELDS = ['pick', 'ban', 'backup', 'mapEvidence', 'mapOverrides', 'confidence'];

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

export function validateReviewedRecommendations(config, evidenceIndex, rosters, teams, schedule, adviceByOpponent) {
  if (config.snapshotRoot !== CANONICAL_ROOT) throw new Error('recommendations root mismatch');
  if (config.reviewed !== true) throw new Error('recommendations must be reviewed');
  if (config.dataThrough !== RECENT_WINDOW.recentEnd) throw new Error('recommendations are stale');
  if (!Array.isArray(schedule) || schedule.length === 0) throw new Error('season schedule is empty');
  if (!Array.isArray(config.plans) || config.plans.length !== schedule.length) {
    throw new Error(`exactly ${schedule.length} plans required`);
  }
  const rosterById = new Map(rosters.map((roster) => [roster.teamId, roster]));
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const ourPlayers = new Map(rosterById.get('us').players.map((player) => [player.draftName, player]));
  const matchIds = config.plans.map(({ matchId }) => matchId);
  if (new Set(matchIds).size !== matchIds.length) throw new Error('duplicate matchId');
  return config.plans.map((plan, index) => {
    const expected = schedule[index];
    if (plan.matchId !== expected.matchId) throw new Error(`unknown matchId: ${plan.matchId}`);
    if (plan.date !== expected.date || plan.opponentTeamId !== expected.opponentTeamId) {
      throw new Error(`schedule mismatch for ${plan.matchId}`);
    }
    if (!rosterById.has(plan.opponentTeamId) || plan.opponentTeamId === 'us') {
      throw new Error(`unknown opponent: ${plan.opponentTeamId}`);
    }
    const legacy = LEGACY_PLAN_FIELDS.filter((field) => field in plan);
    if (legacy.length) {
      throw new Error(`${plan.opponentTeamId} verdict is computed by veto-1; remove ${legacy.join(', ')} from config`);
    }
    if (!plan.contingency) throw new Error(`${plan.opponentTeamId} missing contingency`);
    for (const field of ['threatEvidence', 'weaknessEvidence', 'do', 'dont', 'trainingChecklist', 'matchdayChecklist', 'caveats']) {
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
    const advice = adviceByOpponent.get(plan.opponentTeamId);
    if (!advice) throw new Error(`${plan.opponentTeamId} has no veto advice`);
    const verdict = {
      pick: advice.suggestedPick,
      ban: advice.suggestedBan,
      backup: advice.suggestedBackup,
      source: advice.model.version,
    };
    if (!verdict.pick || !verdict.ban) throw new Error(`${plan.opponentTeamId} veto advice is incomplete`);
    const mapEvidence = MAP_POOL_2026.map((map) => `map-edge:${plan.opponentTeamId}:${map}`);
    const comfortConflict = advice.ranking
      .filter((row) => (row.comfort.practiced || row.comfort.pct >= 50)
        && (row.map === verdict.ban || row.band === 'ban-candidate'))
      .map((row) => ({
        map: row.map,
        votes: row.comfort.votes,
        pct: row.comfort.pct,
        practiced: row.comfort.practiced,
        verdictAction: row.map === verdict.ban ? 'ban' : 'negative-signal',
      }));
    const references = [
      ...plan.threatEvidence, ...plan.weaknessEvidence, ...mapEvidence,
      ...plan.caveats.map(({ evidenceId }) => evidenceId),
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
      verdict,
      confidence: advice.ranking.find(({ map }) => map === verdict.pick)?.confidence ?? 'none',
      comfortConflict,
      mapEvidence,
      personalTasks,
      threats: plan.threatEvidence.map((id) => evidenceIndex.get(id)),
      weaknesses: plan.weaknessEvidence.map((id) => evidenceIndex.get(id)),
      maps: mapEvidence.map((id) => evidenceIndex.get(id)),
    };
  });
}

export async function buildCalculatedDatasets(db, configDir, recommendationPath) {
  const rosterConfig = JSON.parse(await readFile(join(configDir, 'team-rosters.json'), 'utf8'));
  const recommendationConfig = JSON.parse(await readFile(
    recommendationPath ?? join(configDir, 'match-recommendations.json'),
    'utf8',
  ));
  const teamContext = JSON.parse(await readFile(join(configDir, 'team-context.json'), 'utf8'));
  const seasonSchedule = JSON.parse(await readFile(join(configDir, 'season-schedule.json'), 'utf8'));
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
  const teamMapSums = (teamId) => {
    const maps = new Map();
    for (const player of playersByTeam.get(teamId)) {
      for (const [map, result] of Object.entries(player.maps.recent)) {
        if (!maps.has(map)) maps.set(map, emptySums());
        addSums(maps.get(map), result.sums);
      }
    }
    return maps;
  };
  const mapSumsByTeam = new Map(rosters.map(({ teamId }) => [teamId, teamMapSums(teamId)]));
  const teamRates = (teamId) => {
    const metrics = teamById.get(teamId).recent.metrics;
    return {
      rating: metrics.rating,
      roundWinRate: metrics.roundWinRate,
      tRoundWinRate: metrics.tRoundWinRate,
      ctRoundWinRate: metrics.ctRoundWinRate,
    };
  };
  const sampleConfidence = (usRounds, opponentRounds) => {
    if (!usRounds || !opponentRounds) return 'none';
    if (usRounds < 200 || opponentRounds < 200) return 'low';
    return usRounds >= 500 && opponentRounds >= 500 ? 'high' : 'medium';
  };
  const teamMapStats = rosters.flatMap(({ teamId }) => {
    const played = mapSumsByTeam.get(teamId);
    return [...new Set([...MAP_POOL_2026, ...played.keys()])].sort().map((map) => {
      const sums = played.get(map) ?? emptySums();
      return {
        teamId,
        map,
        inPool: MAP_POOL_2026.includes(map),
        recent: { sums, metrics: derivedMetrics(sums) },
        sampleUnit: 'player_rounds',
      };
    });
  });
  const usTeam = teamRates('us');
  const usMaps = mapSumsByTeam.get('us');
  const mapEdges = rosters.filter(({ teamId }) => teamId !== 'us').map((roster) => {
    const opponentMaps = mapSumsByTeam.get(roster.teamId);
    const opponentTeam = teamRates(roster.teamId);
    const mapSide = (sums, overall) => ({
      playerRounds: sums.rounds,
      rawRating: ratio(sums.ratingRoundSum, sums.rounds),
      adjustedRating: sums.rounds
        ? shrink(sums.ratingRoundSum / sums.rounds, sums.rounds, overall.rating)
        : null,
      overallRating: overall.rating,
      roundWinRate: ratio(sums.roundWins, sums.rounds),
      tRoundWinRate: ratio(sums.sides.T.roundWins, sums.sides.T.rounds),
      ctRoundWinRate: ratio(sums.sides.CT.roundWins, sums.sides.CT.rounds),
    });
    const maps = MAP_POOL_2026.map((map) => {
      const usSums = usMaps.get(map) ?? emptySums();
      const opponentSums = opponentMaps.get(map) ?? emptySums();
      const signals = mapSignals(usSums, opponentSums, usTeam, opponentTeam);
      return {
        map,
        inPool: true,
        us: mapSide(usSums, usTeam),
        opponent: mapSide(opponentSums, opponentTeam),
        edge: signals.ratingEdge,
        signals,
        signal: signals.ratingEdge === null ? 'no-data'
          : Math.abs(signals.ratingEdge) < VETO_MODEL.noiseFloor.rating ? 'noise'
            : signals.ratingEdge > 0 ? 'edge-us' : 'edge-them',
        confidence: sampleConfidence(usSums.rounds, opponentSums.rounds),
      };
    });
    return { opponentTeamId: roster.teamId, maps };
  });
  const medians = Object.fromEntries(TEAM_METRIC_KEYS.map((metric) => [
    metric, median(teamMetrics.map((team) => team.recent.metrics[metric])),
  ]));
  for (const team of teamMetrics) {
    const deviations = TEAM_METRIC_KEYS.map((metric) => ({
      metric,
      value: team.recent.metrics[metric],
      median: medians[metric],
      delta: team.recent.metrics[metric] === null || medians[metric] === null
        ? null : team.recent.metrics[metric] - medians[metric],
      evidenceId: `team:${team.teamId}:recent:${metric}`,
    })).filter(({ delta }) => delta !== null);
    const eligible = playersByTeam.get(team.teamId).filter((player) => player.recent.sums.rounds >= 200);
    const ratingRank = [...eligible].sort((left, right) => right.recent.metrics.rating - left.recent.metrics.rating);
    const openingRank = [...eligible].sort((left, right) => right.recent.metrics.openingDiffPer100 - left.recent.metrics.openingDiffPer100);
    const utilityRank = [...eligible].sort((left, right) => right.recent.metrics.utilityDamagePerRound - left.recent.metrics.utilityDamagePerRound);
    const ratingThreatIds = new Set(ratingRank.slice(0, 2).map(({ steamid }) => steamid));
    team.scouting = {
      sufficientSampleRounds: 200,
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
  const comfortFor = (map) => ({
    votes: teamContext.mapVotes[map]?.votes ?? 0,
    pct: teamContext.mapVotes[map]?.pct ?? 0,
    practiced: teamContext.practiced.includes(map),
  });
  const crossModelDisagreement = (opponentTeamId, map, ratingEdge) => {
    const kbUs = teamContext.kbEstimatedStrength?.us?.[map];
    const kbOpponent = teamContext.kbEstimatedStrength?.[opponentTeamId]?.[map];
    if (typeof kbUs !== 'number' || typeof kbOpponent !== 'number' || ratingEdge === null) return false;
    const kbEdge = kbUs - kbOpponent;
    return Math.sign(kbEdge) !== Math.sign(ratingEdge)
      && (Math.abs(kbEdge) >= VETO_MODEL.noiseFloor.rating
        || Math.abs(ratingEdge) >= VETO_MODEL.noiseFloor.rating);
  };
  const vetoAdvice = mapEdges.map(({ opponentTeamId, maps }) => {
    const ranking = rankMaps(maps.map((row) => ({
      map: row.map,
      signals: row.signals,
      usRounds: row.us.playerRounds,
      oppRounds: row.opponent.playerRounds,
      confidence: row.confidence,
      comfort: comfortFor(row.map),
    }))).map((row) => ({
      ...row,
      crossModelDisagreement: crossModelDisagreement(opponentTeamId, row.map, row.components.ratingEdge),
      rationale: formatRationale(row),
    }));
    const verdict = suggestVerdict(ranking);
    return {
      opponentTeamId,
      model: {
        version: VETO_MODEL.version,
        priorRounds: VETO_MODEL.priorRounds,
        noiseFloor: VETO_MODEL.noiseFloor,
        weights: VETO_MODEL.weights,
        window: RECENT_WINDOW,
        comfortSource: teamContext.source,
      },
      ranking,
      suggestedPick: verdict.pick,
      suggestedBan: verdict.ban,
      suggestedBackup: verdict.backup,
      decisionTree: buildDecisionTree(ranking, verdict, teamContext),
    };
  });
  const evidence = buildEvidence(playerMetrics, teamMetrics, mapEdges);
  const recommendations = validateReviewedRecommendations(
    recommendationConfig,
    new Map(evidence.map((item) => [item.id, item])),
    rosters,
    teamMetrics,
    seasonSchedule.matches,
    new Map(vetoAdvice.map((advice) => [advice.opponentTeamId, advice])),
  );
  return {
    rosters, playerMetrics, teamMetrics, teamMapStats, mapEdges, vetoAdvice, evidence, recommendations,
  };
}
