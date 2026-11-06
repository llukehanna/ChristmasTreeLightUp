-- Looks earned by goals (season two C2+C3, 2026-11-06). The facts of a finished run from its replay (turns, the tree's
-- minimum turns, the FEAT bits), the context the browser reports at the win (the zone as UTC minus local in minutes,
-- the station, the world), and when a guest's run was claimed, so a closed day's Daily board never changes.
ALTER TABLE games ADD COLUMN turns INTEGER;
ALTER TABLE games ADD COLUMN min_turns INTEGER;
ALTER TABLE games ADD COLUMN feats INTEGER;
ALTER TABLE games ADD COLUMN tz INTEGER;
ALTER TABLE games ADD COLUMN station TEXT;
ALTER TABLE games ADD COLUMN world TEXT CHECK (world IN ('secret', 'home-alone'));
ALTER TABLE games ADD COLUMN claimed_at INTEGER;
-- A signed-in player's unfinished games are kept (they break a run of trees and forfeit a Daily): only a guest's are
-- swept, after a day, on games_stale's new predicate. games_stale_daily was read by 0007's three-day sweep only.
DROP INDEX games_stale_daily;
DROP INDEX games_stale;
CREATE INDEX games_stale ON games (started_at) WHERE finished_at IS NULL AND user_id IS NULL;
