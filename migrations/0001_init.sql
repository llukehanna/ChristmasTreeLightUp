-- Aglow accounts (spec 2026-10-07 section 2). Times are epoch ms on the server's clock.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  name_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  claim_hash TEXT,
  gen_version INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ms INTEGER,
  paused_ms INTEGER,
  pauses INTEGER,
  ranked INTEGER NOT NULL DEFAULT 0,
  unranked_reason TEXT,
  log TEXT
);
CREATE INDEX games_board ON games (ms, finished_at) WHERE ranked = 1;
CREATE INDEX games_user ON games (user_id, finished_at DESC);
CREATE INDEX games_abandoned ON games (started_at) WHERE finished_at IS NULL;

-- One row per game start, for the start rate limit (200 per IP hash per hour). Kept apart from games so a start whose
-- game a 422 deleted still counts. Rows older than an hour are pruned, a few at a time, on each start.
CREATE TABLE starts (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX starts_ip ON starts (ip_hash, at);
-- The prune finds old rows by time alone; without this it would read every start, every start.
CREATE INDEX starts_at ON starts (at);
