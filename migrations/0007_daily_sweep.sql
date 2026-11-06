-- The stale-game sweep in two kinds (C1 final fix, 2026-11-06), each on its own partial index, so neither delete walks
-- rows it won't delete. Abandoned after one day: a random game, or a guest's Daily (it can never be claimed: a claim
-- needs a finished run). Kept for three days: a signed-in player's unfinished Daily, their forfeited first attempt.
-- games_abandoned was read by the old one-index sweep only.
DROP INDEX games_abandoned;
CREATE INDEX games_stale ON games (started_at) WHERE finished_at IS NULL AND (daily_day IS NULL OR user_id IS NULL);
CREATE INDEX games_stale_daily ON games (started_at) WHERE finished_at IS NULL AND daily_day IS NOT NULL AND user_id IS NOT NULL;
