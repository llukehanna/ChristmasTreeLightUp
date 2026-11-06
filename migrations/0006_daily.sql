-- The Daily Tree (2026-11-06): which day's tree a game was, and whether that day was already over for the player.
ALTER TABLE games ADD COLUMN daily_day INTEGER;
ALTER TABLE games ADD COLUMN daily_past INTEGER NOT NULL DEFAULT 0;
CREATE INDEX games_daily ON games (daily_day, user_id, started_at) WHERE daily_day IS NOT NULL;
