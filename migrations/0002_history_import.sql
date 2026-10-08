-- History import (spec 2026-10-08 section 2): where a game came from. 'play' for games played on Aglow (every row so
-- far), 'import' for runs the admin imported from a device's pre-accounts stats.
ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'play' CHECK (source IN ('play', 'import'));
