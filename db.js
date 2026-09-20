'use strict';

const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS areas (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  x       REAL NOT NULL DEFAULT 0,
  y       REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edges (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  a       INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  b       INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  seconds REAL NOT NULL CHECK (seconds > 0)
);

CREATE TABLE IF NOT EXISTS scenes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transitions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id          INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  from_seq         INTEGER NOT NULL,
  to_seq           INTEGER NOT NULL,
  duration_seconds REAL NOT NULL DEFAULT 30 CHECK (duration_seconds >= 0),
  blocked_area_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS actor_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transition_id INTEGER NOT NULL REFERENCES transitions(id) ON DELETE CASCADE,
  actor         TEXT NOT NULL,
  from_area_id  INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  to_area_id    INTEGER REFERENCES areas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_areas_play       ON areas(play_id);
CREATE INDEX IF NOT EXISTS idx_edges_play       ON edges(play_id);
CREATE INDEX IF NOT EXISTS idx_scenes_play      ON scenes(play_id, seq);
CREATE INDEX IF NOT EXISTS idx_transitions_play ON transitions(play_id, from_seq);
CREATE INDEX IF NOT EXISTS idx_moves_transition ON actor_moves(transition_id);
`;

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
