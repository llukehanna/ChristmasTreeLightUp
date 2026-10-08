-- A display preference for the tree (2026-10-08): 1 puts Luke's star-head sticker on top in place of the star. The
-- account's value follows the player across devices; the board, the ranking and the replay never read it.
ALTER TABLE users ADD COLUMN star_head INTEGER NOT NULL DEFAULT 0 CHECK (star_head IN (0, 1));
