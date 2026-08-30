import assert from 'node:assert/strict';

const PLAYER_IDS = [
  '76561198000000001',
  '76561198000000002',
  '76561198000000003',
];

function matchRow(id, index) {
  return {
    id,
    map: index % 2 === 0 ? 'de_mirage' : 'de_inferno',
    server_name: 'Whoajor fixture',
    started_at: `2026-08-${String(28 - index).padStart(2, '0')}T18:00:00Z`,
    rounds_played: 2,
    team_a_rounds: 1,
    team_b_rounds: 1,
    mixed_teams: 0,
    tags: null,
  };
}

function matchDetail(row, players, roundPlayers) {
  return {
    matchId: row.id,
    file: `${row.id}.dem`,
    map: row.map,
    serverName: row.server_name,
    startedAt: row.started_at,
    durationSeconds: 300,
    tickrate: 128,
    roundsPlayed: 2,
    knifeRounds: 0,
    workshopMap: false,
    mode: 'competitive',
    scoreByRoster: { a: 1, b: 1 },
    mixedTeams: false,
    voiceRecorded: false,
    tags: [],
    rounds: [
      {
        round: 1,
        winner: 'T',
        reason: 'target_bombed',
        bombPlanted: true,
        tSteamids: [roundPlayers[0]],
        ctSteamids: [roundPlayers[1] ?? roundPlayers[0]],
      },
      {
        round: 2,
        winner: 'CT',
        reason: 'ct_killed',
        bombPlanted: false,
        tSteamids: [roundPlayers[0]],
        ctSteamids: [roundPlayers[1] ?? roundPlayers[0]],
      },
    ],
    players: players.map((steamid) => ({
      steamid,
      name: `Player ${steamid.slice(-2)}`,
      bySide: {},
      weapons: [{ weapon: 'ak47', kills: 1 }],
      perRound: [
        { round: 1, side: 'T', kills: 1, deaths: 0, won: true },
        { round: 2, side: 'CT', kills: 0, deaths: 1, won: true },
      ],
    })),
  };
}

function leaderboardRow(steamid) {
  return {
    steamid,
    name: `Player ${steamid.slice(-2)}`,
    matches: 2,
    rounds_played: 4,
    rating2: 1.05,
  };
}

function playerPayloads(steamid) {
  return {
    summary: [leaderboardRow(steamid)],
    maps: [{
      map: 'de_mirage', matches: 1, rounds_played: 2, rounds_won: 1,
      kills: 2, deaths: 1, rating2: 1.05,
    }],
    weapons: [{ weapon: 'ak47', shots: 20, hits: 6, kills: 2, rounds_with: 2 }],
    weaponsByDay: [{
      weapon: 'ak47', day: '2026-08-28', shots: 20, hits: 6, kills: 2, rounds_with: 2,
    }],
    matches: [{
      match_id: 'match-1', map: 'de_mirage', started_at: '2026-08-28T18:00:00Z',
      rounds_played: 2, rounds_won: 1, kills: 2, deaths: 1, rating2: 1.05,
    }],
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function keyOf(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function createFixtureApi({
  pageSize = 1,
  matchIds = ['match-2', 'match-1'],
  leaderboardPlayers = PLAYER_IDS,
  draftPlayers = [PLAYER_IDS[2]],
  detailPlayers = [PLAYER_IDS[0]],
  roundPlayers = [PLAYER_IDS[0], PLAYER_IDS[1]],
  weapons = ['ak47', 'awp'],
  totalDriftAtOffset = null,
  boundaryDrift = false,
  malformedPath = null,
  malformedBoundaryPath = null,
  drawRound = false,
  legacyOptionalMatchFields = false,
  legacyClutchWithoutStartTick = false,
} = {}) {
  const baseUrl = 'https://fixture.whoajor.test';
  const calls = [];
  const unexpected = [];
  const routeCounts = new Map();
  const rows = matchIds.map(matchRow);
  const details = new Map(rows.map((row) => [
    row.id,
    matchDetail(row, detailPlayers, roundPlayers),
  ]));
  if (drawRound) {
    const firstDetail = details.get(rows[0].id);
    firstDetail.rounds[0].winner = null;
    firstDetail.rounds[0].reason = 'draw';
  }
  if (legacyOptionalMatchFields) {
    const firstDetail = details.get(rows[0].id);
    delete firstDetail.workshopMap;
    delete firstDetail.voiceRecorded;
  }
  if (legacyClutchWithoutStartTick) {
    const firstDetail = details.get(rows[0].id);
    firstDetail.players[0].clutches = [
      { round: 1, vs: 1, won: false, kills: 0, survived: false },
      { round: 1, startTick: 256, vs: 1, won: true, kills: 1, survived: true },
    ];
  }
  const expectedPlayers = [...new Set([
    ...leaderboardPlayers, ...draftPlayers, ...detailPlayers, ...roundPlayers,
  ])].sort();

  function count(key) {
    const next = (routeCounts.get(key) ?? 0) + 1;
    routeCounts.set(key, next);
    return next;
  }

  function payloadFor(key, callNumber) {
    if (key === '/api/meta') {
      return {
        min_date: '2026-08-01', max_date: '2026-08-29', matches: rows.length,
        maps: [{ map: 'de_mirage', n: rows.length }],
        standard_matches: rows.length, community_matches: 0,
      };
    }
    if (key === '/api/tags') return [{ tag: 'official', matches: rows.length }];
    if (key === '/api/draft-config') {
      return {
        v: 1, teams: 2, metric: 'rating2', igls: [],
        players: draftPlayers.map((steamid) => ({
          steamid, name: `Player ${steamid.slice(-2)}`, cost: 10, rating: 1.05,
        })),
        publishedAt: '2026-08-29T06:00:00Z',
      };
    }
    if (key === `/api/trends?top=${expectedPlayers.length}`) {
      return expectedPlayers.slice(0, 2).map((steamid, index) => ({
        steamid,
        name: `Player ${steamid.slice(-2)}`,
        roundsTotal: 2,
        matches: [{
          steamid,
          started_at: `2026-08-${String(28 - index).padStart(2, '0')}T18:00:00Z`,
          map: index === 0 ? 'de_mirage' : 'de_inferno',
          match_name: `match-${index + 1}`,
          adr: 75 + index,
          assists: 1,
          cs_good: 2,
          cs_graded: 2,
          cs_stop_fast: 1,
          cs_stop_slow: 1,
          damage: 150 + index,
          deaths: 1,
          dpr: 0.5,
          flash_assists: 0,
          hs_kills: 1,
          impact: 1.1,
          kast_pct: 100,
          kast_rounds: 2,
          kills: 2,
          kpr: 1,
          opening_deaths: 0,
          opening_kills: 1,
          ping_n: 1,
          ping_sum: 40,
          rating2: 1.05,
          rounds_played: 2,
          rounds_won: 1,
          rws_sum: 20,
          stop_ms_n: 2,
          stop_ms_sum: 300,
          ttd_adj_sum: 180,
          ttd_sum: 200,
          ttd_n: 1,
        }],
      }));
    }

    const matchPage = key.match(/^\/api\/matches\?limit=(\d+)&offset=(\d+)$/);
    if (matchPage) {
      const limit = Number(matchPage[1]);
      const offset = Number(matchPage[2]);
      const total = offset === totalDriftAtOffset ? rows.length + 1 : rows.length;
      const pageRows = boundaryDrift && offset === 0 && callNumber > 1
        ? [matchRow('match-new', 0), ...rows].slice(0, limit)
        : rows.slice(offset, offset + limit);
      return { matches: pageRows, total };
    }

    const detailMatch = key.match(/^\/api\/matches\/([^?]+)$/);
    if (detailMatch && details.has(decodeURIComponent(detailMatch[1]))) {
      return details.get(decodeURIComponent(detailMatch[1]));
    }
    if (key === '/api/leaderboard') return leaderboardPlayers.map(leaderboardRow);

    const playerMatch = key.match(/^\/api\/players\/(\d+)\/(summary|maps|weapons|matches)(\?by=day)?$/);
    if (playerMatch && expectedPlayers.includes(playerMatch[1])) {
      const payloads = playerPayloads(playerMatch[1]);
      if (playerMatch[2] === 'weapons' && playerMatch[3]) return payloads.weaponsByDay;
      return payloads[playerMatch[2]];
    }

    if (key === '/api/weapons') {
      return weapons.map((weapon) => ({ weapon, kills: 2, shots: 20, players: 1 }));
    }
    const weaponMatch = key.match(/^\/api\/weapons\/([^?]+)(\?by=day)?$/);
    if (weaponMatch && weapons.includes(decodeURIComponent(weaponMatch[1]))) {
      const weapon = decodeURIComponent(weaponMatch[1]);
      if (weaponMatch[2]) {
        return [{
          steamid: expectedPlayers[0], weapon, day: '2026-08-28', rounds_with: 2, kills: 2,
        }];
      }
      return [{
        steamid: expectedPlayers[0], name: 'Player 01', kills: 2, shots: 20,
        matches: 1, rounds_played: 2, matches_total: 2,
      }];
    }
    if (key === '/api/weapon-splits') {
      return [{
        steamid: expectedPlayers[0], weapon: weapons[0], kills: 2, rounds_with: 2, hs_kills: 1,
      }];
    }
    return undefined;
  }

  async function fetch(url, options = {}) {
    const key = keyOf(url);
    calls.push({ key, method: options.method });
    if (options.method !== 'GET') {
      unexpected.push(`${options.method ?? 'undefined'} ${key}`);
      throw new Error(`fixture rejects non-GET request: ${options.method ?? 'undefined'} ${key}`);
    }
    const callNumber = count(key);
    const payload = payloadFor(key, callNumber);
    if (payload === undefined) {
      unexpected.push(`GET ${key}`);
      throw new Error(`fixture has no planned endpoint: GET ${key}`);
    }
    if (malformedPath === key || (malformedBoundaryPath === key && callNumber > 1)) {
      return new Response('{"broken":', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return jsonResponse(payload);
  }

  function assertNoUnexpectedCalls() {
    assert.deepEqual(unexpected, []);
    assert.ok(calls.every(({ method }) => method === 'GET'), 'fixture must see GET requests only');
    assert.equal(routeCounts.get('/api/meta'), 2, 'meta must be checked at both boundaries');
    assert.equal(routeCounts.get('/api/tags'), 1);
    assert.equal(routeCounts.get('/api/draft-config'), 1);
    assert.equal(routeCounts.get(`/api/trends?top=${expectedPlayers.length}`), 1);
    assert.equal(routeCounts.get('/api/leaderboard'), 1);
    assert.equal(routeCounts.get('/api/weapons'), 1);
    assert.equal(routeCounts.get('/api/weapon-splits'), 1);
    assert.equal(routeCounts.get(`/api/matches?limit=${pageSize}&offset=0`), 2,
      'match head must be checked at both boundaries');
    const expectedPageOffsets = [];
    const seenMatches = new Set();
    let pageOffset = 0;
    while (seenMatches.size < rows.length) {
      expectedPageOffsets.push(pageOffset);
      for (const row of rows.slice(pageOffset, pageOffset + pageSize)) seenMatches.add(row.id);
      pageOffset += Math.max(1, pageSize - 1);
    }
    for (const expectedOffset of expectedPageOffsets.slice(1)) {
      assert.equal(routeCounts.get(`/api/matches?limit=${pageSize}&offset=${expectedOffset}`), 1);
    }
    for (const matchId of matchIds) assert.equal(routeCounts.get(`/api/matches/${matchId}`), 1);
    for (const steamid of expectedPlayers) {
      assert.equal(routeCounts.get(`/api/players/${steamid}/summary`), 1);
      assert.equal(routeCounts.get(`/api/players/${steamid}/maps`), 1);
      assert.equal(routeCounts.get(`/api/players/${steamid}/weapons`), 1);
      assert.equal(routeCounts.get(`/api/players/${steamid}/weapons?by=day`), 1);
      assert.equal(routeCounts.get(`/api/players/${steamid}/matches`), 1);
    }
    for (const weapon of weapons) {
      assert.equal(routeCounts.get(`/api/weapons/${weapon}`), 1);
      assert.equal(routeCounts.get(`/api/weapons/${weapon}?by=day`), 1);
    }
    const expectedRouteCount = 7 + expectedPageOffsets.length
      + matchIds.length + (expectedPlayers.length * 5) + (weapons.length * 2);
    assert.equal(routeCounts.size, expectedRouteCount, 'every known URL must be expected exactly');
  }

  return Object.freeze({
    baseUrl, fetch, calls, routeCounts, expectedPlayers, assertNoUnexpectedCalls,
  });
}
