function addString(set, value) {
  if (typeof value === 'string' && value.length > 0) set.add(value);
}

export function isSteamId64(value) {
  return typeof value === 'string' && /^\d{17}$/.test(value);
}

function addSteamid(set, value) {
  if (isSteamId64(value)) set.add(value);
}

function addRows(set, rows, field) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) addString(set, row?.[field]);
}

function addPlayerRows(set, rows) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) addSteamid(set, row?.steamid);
}

export function discoverPlayers(payloads = {}) {
  const players = new Set();
  addPlayerRows(players, payloads.leaderboard);
  addPlayerRows(players, payloads.draftConfig?.players);

  for (const detail of payloads.matchDetails ?? []) {
    addPlayerRows(players, detail?.players);
    for (const round of detail?.rounds ?? []) {
      for (const steamid of round?.tSteamids ?? []) addSteamid(players, steamid);
      for (const steamid of round?.ctSteamids ?? []) addSteamid(players, steamid);
    }
  }

  return [...players].sort();
}

export function discoverWeapons(payloads = {}) {
  const weapons = new Set();
  addRows(weapons, payloads.weapons, 'weapon');
  for (const rows of payloads.playerWeapons ?? []) addRows(weapons, rows, 'weapon');
  for (const detail of payloads.matchDetails ?? []) {
    for (const player of detail?.players ?? []) addRows(weapons, player?.weapons, 'weapon');
  }
  return [...weapons].sort();
}
