function addString(set, value) {
  if (typeof value === 'string' && value.length > 0) set.add(value);
}

function addRows(set, rows, field) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) addString(set, row?.[field]);
}

export function discoverPlayers(payloads = {}) {
  const players = new Set();
  addRows(players, payloads.leaderboard, 'steamid');
  addRows(players, payloads.draftConfig?.players, 'steamid');

  for (const detail of payloads.matchDetails ?? []) {
    addRows(players, detail?.players, 'steamid');
    for (const round of detail?.rounds ?? []) {
      for (const steamid of round?.tSteamids ?? []) addString(players, steamid);
      for (const steamid of round?.ctSteamids ?? []) addString(players, steamid);
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
