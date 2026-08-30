PRAGMA foreign_keys = ON;

CREATE TABLE snapshots (
  snapshot_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  root_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'complete'),
  source_json TEXT NOT NULL
) STRICT;

CREATE TABLE requests (
  snapshot_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  observation_role TEXT NOT NULL CHECK (observation_role IN ('ordinary', 'start', 'end')),
  path TEXT NOT NULL,
  query_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  canonical_sha256 TEXT NOT NULL,
  source_body TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, request_key, observation_role),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
) STRICT;

CREATE TABLE source_discrepancies (
  snapshot_id TEXT NOT NULL,
  discrepancy_index INTEGER NOT NULL,
  code TEXT NOT NULL,
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, discrepancy_index),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
) STRICT;

CREATE TABLE matches (
  match_id TEXT PRIMARY KEY,
  map TEXT NOT NULL,
  server_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  rounds_played INTEGER NOT NULL,
  has_detail INTEGER NOT NULL CHECK (has_detail IN (0, 1)),
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL
) STRICT;

CREATE TABLE match_tags (
  match_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY (match_id, tag),
  FOREIGN KEY (match_id) REFERENCES matches(match_id)
) STRICT;

CREATE TABLE match_rounds (
  match_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  winner TEXT,
  reason TEXT NOT NULL,
  bomb_planted INTEGER NOT NULL CHECK (bomb_planted IN (0, 1)),
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, round),
  FOREIGN KEY (match_id) REFERENCES matches(match_id)
) STRICT;

CREATE TABLE players (
  steamid TEXT PRIMARY KEY,
  display_name TEXT,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL
) STRICT;

CREATE TABLE round_rosters (
  match_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  side TEXT NOT NULL,
  steamid TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY (match_id, round, side, steamid),
  FOREIGN KEY (match_id, round) REFERENCES match_rounds(match_id, round),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE player_aliases (
  snapshot_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  alias TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, steamid, alias, source_fingerprint),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE match_players (
  match_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  name TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, steamid),
  FOREIGN KEY (match_id) REFERENCES matches(match_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE player_rounds (
  match_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  round INTEGER NOT NULL,
  side TEXT NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, steamid, round),
  FOREIGN KEY (match_id, steamid) REFERENCES match_players(match_id, steamid),
  FOREIGN KEY (match_id, round) REFERENCES match_rounds(match_id, round)
) STRICT;

CREATE TABLE player_match_stats (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  steamid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, steamid, match_id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid),
  FOREIGN KEY (match_id) REFERENCES matches(match_id)
) STRICT;

CREATE TABLE player_side_stats (
  match_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  side TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, steamid, side),
  FOREIGN KEY (match_id, steamid) REFERENCES match_players(match_id, steamid)
) STRICT;

CREATE TABLE player_clutches (
  match_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  round INTEGER NOT NULL,
  start_tick INTEGER NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, steamid, round, start_tick),
  FOREIGN KEY (match_id, steamid) REFERENCES match_players(match_id, steamid),
  FOREIGN KEY (match_id, round) REFERENCES match_rounds(match_id, round)
) STRICT;

CREATE TABLE weapons (
  weapon TEXT PRIMARY KEY,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL
) STRICT;

CREATE TABLE match_player_weapons (
  match_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  weapon TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (match_id, steamid, weapon),
  FOREIGN KEY (match_id, steamid) REFERENCES match_players(match_id, steamid),
  FOREIGN KEY (weapon) REFERENCES weapons(weapon)
) STRICT;

CREATE TABLE player_weapon_stats (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  steamid TEXT NOT NULL,
  weapon TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, steamid, weapon),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid),
  FOREIGN KEY (weapon) REFERENCES weapons(weapon)
) STRICT;

CREATE TABLE player_weapon_daily_stats (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  steamid TEXT NOT NULL,
  weapon TEXT NOT NULL,
  day TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, steamid, weapon, day),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid),
  FOREIGN KEY (weapon) REFERENCES weapons(weapon)
) STRICT;

CREATE TABLE weapon_daily_stats (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  weapon TEXT NOT NULL,
  steamid TEXT NOT NULL,
  day TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, weapon, steamid, day),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (weapon) REFERENCES weapons(weapon),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE weapon_splits (
  snapshot_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  weapon TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, steamid, weapon),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid),
  FOREIGN KEY (weapon) REFERENCES weapons(weapon)
) STRICT;

CREATE TABLE leaderboard_snapshots (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  steamid TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, steamid),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE player_map_snapshots (
  snapshot_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  steamid TEXT NOT NULL,
  map TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, query_fingerprint, steamid, map),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE draft_config (
  snapshot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  teams INTEGER NOT NULL,
  metric TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, version),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
) STRICT;

CREATE TABLE draft_players (
  snapshot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  steamid TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, version, steamid),
  FOREIGN KEY (snapshot_id, version) REFERENCES draft_config(snapshot_id, version),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE draft_igls (
  snapshot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  igl_key TEXT NOT NULL,
  steamid TEXT,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, version, igl_key),
  FOREIGN KEY (snapshot_id, version) REFERENCES draft_config(snapshot_id, version),
  FOREIGN KEY (steamid) REFERENCES players(steamid)
) STRICT;

CREATE TABLE meta_maps (
  snapshot_id TEXT NOT NULL,
  map TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, map),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
) STRICT;

CREATE TABLE tags (
  snapshot_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, tag),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
) STRICT;
