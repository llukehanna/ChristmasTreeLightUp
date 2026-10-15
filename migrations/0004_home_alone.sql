-- Home Alone mode (2026-10-14): 1 while the player has typed "kevin" into the McCallister house. A display preference
-- like star_head: the account's value follows the player across devices; the board, the ranking and the replay never read it.
ALTER TABLE users ADD COLUMN home_alone INTEGER NOT NULL DEFAULT 0 CHECK (home_alone IN (0, 1));
