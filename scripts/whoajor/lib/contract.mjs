import { CONTRACT_VERSION } from '../config.mjs';
import { normalizeQuery } from './canonical-json.mjs';

const leaderboardFields = {
  steamid: 'string',
  name: 'string',
  matches: 'number',
  rounds_played: 'number',
  rating2: 'number',
};

function deepFreeze(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  return Object.freeze(value);
}

function encodePathIdentifier(identifier) {
  try {
    return encodeURIComponent(decodeURIComponent(identifier));
  } catch {
    return encodeURIComponent(identifier);
  }
}

function encodeDynamicPathSegments(path) {
  const segments = path.split('/');
  if (segments[1] === 'api' && segments[2] === 'matches' && segments.length >= 4) {
    return `/api/matches/${encodePathIdentifier(segments.slice(3).join('/'))}`;
  }
  if (segments[1] === 'api' && segments[2] === 'players' && segments.length >= 5) {
    segments[3] = encodePathIdentifier(segments[3]);
  }
  if (segments[1] === 'api' && segments[2] === 'weapons' && segments.length >= 4) {
    return `/api/weapons/${encodePathIdentifier(segments.slice(3).join('/'))}`;
  }
  return segments.join('/');
}

export function buildUrl(baseUrl, path, query = {}) {
  if (!path.startsWith('/api/')) throw new Error('only /api/ paths are allowed');

  const url = new URL(encodeDynamicPathSegments(path), baseUrl);
  if (!url.pathname.startsWith('/api/')) throw new Error('only /api/ paths are allowed');
  url.search = normalizeQuery(Object.entries(query));
  return url;
}

export const CONTRACT = deepFreeze({
  version: CONTRACT_VERSION,
  endpoints: {
    meta: {
      path: '/api/meta',
      responseKind: 'object',
      required: {
        min_date: 'string',
        max_date: 'string',
        matches: 'number',
        maps: 'array',
        standard_matches: 'number',
        community_matches: 'number',
      },
      primaryKey: () => 'meta',
    },
    tags: {
      path: '/api/tags',
      responseKind: 'array',
      required: { tag: 'string', matches: 'number' },
      primaryKey: (row) => row.tag,
    },
    draftConfig: {
      path: '/api/draft-config',
      responseKind: 'object',
      required: {
        v: 'number',
        teams: 'number',
        metric: 'string',
        igls: 'array',
        players: 'array',
        publishedAt: 'string',
      },
      primaryKey: (row) => String(row.v),
    },
    matches: {
      path: '/api/matches',
      responseKind: 'envelope',
      required: { matches: 'array', total: 'number' },
      itemRequired: {
        id: 'string',
        map: 'string',
        server_name: 'string',
        started_at: 'string',
        rounds_played: 'number',
        team_a_rounds: 'number',
        team_b_rounds: 'number',
        mixed_teams: 'number',
        tags: 'string|null',
      },
      itemsField: 'matches',
      totalField: 'total',
      limitParam: 'limit',
      offsetParam: 'offset',
      primaryKey: (row) => row.id,
    },
    matchDetail: {
      path: '/api/matches/{matchId}',
      responseKind: 'object',
      required: {
        matchId: 'string',
        file: 'string',
        map: 'string',
        serverName: 'string',
        startedAt: 'string',
        durationSeconds: 'number',
        tickrate: 'number',
        roundsPlayed: 'number',
        knifeRounds: 'number',
        workshopMap: 'boolean|undefined',
        mode: 'string',
        scoreByRoster: 'object',
        mixedTeams: 'boolean',
        voiceRecorded: 'boolean|undefined',
        tags: 'array',
        rounds: 'array',
        players: 'array',
      },
      primaryKey: (row) => row.matchId,
    },
    leaderboard: {
      path: '/api/leaderboard',
      responseKind: 'array',
      required: leaderboardFields,
      primaryKey: (row) => row.steamid,
    },
    playerSummary: {
      path: '/api/players/{steamid}/summary',
      responseKind: 'array',
      required: leaderboardFields,
      primaryKey: (row) => row.steamid,
    },
    playerMaps: {
      path: '/api/players/{steamid}/maps',
      responseKind: 'array',
      required: {
        map: 'string',
        matches: 'number',
        rounds_played: 'number',
        rounds_won: 'number',
        kills: 'number',
        deaths: 'number',
        rating2: 'number',
      },
      primaryKey: (row, context = {}) => `${context.steamid}\0${row.map}`,
    },
    playerWeapons: {
      path: '/api/players/{steamid}/weapons',
      responseKind: 'array',
      required: {
        weapon: 'string',
        shots: 'number',
        hits: 'number',
        kills: 'number',
        rounds_with: 'number',
      },
      primaryKey: (row, context = {}) => `${context.steamid}\0${row.weapon}`,
    },
    playerWeaponsByDay: {
      path: '/api/players/{steamid}/weapons',
      fixedQuery: { by: 'day' },
      responseKind: 'array',
      required: {
        weapon: 'string',
        day: 'string',
        shots: 'number',
        hits: 'number',
        kills: 'number',
        rounds_with: 'number',
      },
      primaryKey: (row, context = {}) => `${context.steamid}\0${row.weapon}\0${row.day}`,
    },
    playerMatches: {
      path: '/api/players/{steamid}/matches',
      responseKind: 'array',
      required: {
        match_id: 'string',
        map: 'string',
        started_at: 'string',
        rounds_played: 'number',
        rounds_won: 'number',
        kills: 'number',
        deaths: 'number',
        rating2: 'number',
      },
      primaryKey: (row, context = {}) => `${context.steamid}\0${row.match_id}`,
    },
    weapons: {
      path: '/api/weapons',
      responseKind: 'array',
      required: { weapon: 'string', kills: 'number', shots: 'number', players: 'number' },
      primaryKey: (row) => row.weapon,
    },
    weaponDetail: {
      path: '/api/weapons/{weapon}',
      responseKind: 'array',
      required: {
        steamid: 'string',
        name: 'string',
        kills: 'number',
        shots: 'number',
        matches: 'number',
        rounds_played: 'number',
        matches_total: 'number',
      },
      primaryKey: (row, context = {}) => `${context.weapon}\0${row.steamid}`,
    },
    weaponDetailByDay: {
      path: '/api/weapons/{weapon}',
      fixedQuery: { by: 'day' },
      responseKind: 'array',
      required: {
        steamid: 'string',
        weapon: 'string',
        day: 'string',
        rounds_with: 'number',
        kills: 'number',
      },
      primaryKey: (row, context = {}) => `${context.weapon}\0${row.steamid}\0${row.day}`,
    },
    weaponSplits: {
      path: '/api/weapon-splits',
      responseKind: 'array',
      required: {
        steamid: 'string',
        weapon: 'string',
        kills: 'number',
        rounds_with: 'number',
        hs_kills: 'number',
      },
      primaryKey: (row) => `${row.steamid}\0${row.weapon}`,
    },
  },
  entities: {
    draftPlayer: {
      required: { steamid: 'string', name: 'string', cost: 'number', rating: 'number' },
      primaryKey: (row) => row.steamid,
    },
    metaMap: {
      required: { map: 'string', n: 'number' },
      primaryKey: (row) => row.map,
    },
    matchRound: {
      required: {
        round: 'number',
        winner: 'string|null',
        reason: 'string',
        bombPlanted: 'boolean',
        tSteamids: 'array',
        ctSteamids: 'array',
      },
      primaryKey: (row, context = {}) => `${context.matchId}\0${row.round}`,
    },
    matchPlayer: {
      required: {
        steamid: 'string',
        name: 'string',
        bySide: 'object',
        weapons: 'array',
        perRound: 'array',
      },
      primaryKey: (row, context = {}) => `${context.matchId}\0${row.steamid}`,
    },
    playerRound: {
      required: {
        round: 'number',
        side: 'string',
        kills: 'number',
        deaths: 'number',
        won: 'boolean',
      },
      primaryKey: (row, context = {}) => `${context.matchId}\0${context.steamid}\0${row.round}`,
    },
  },
});
