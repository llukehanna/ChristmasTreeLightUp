-- Board windows (2026-10-14): today's and this week's board read the ranked runs finished since the window's start.
-- games_board orders by time, so a window scanned it all; this one seeks straight to the window's first finish.
CREATE INDEX games_recent ON games (finished_at, ms) WHERE ranked = 1;
