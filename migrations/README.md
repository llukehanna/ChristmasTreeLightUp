# D1 migrations

Applied in filename order by `wrangler d1 migrations apply` and, for the Worker tests, by `tests/worker/harness.ts`.
The harness's splitter strips every `--` comment and splits statements on a `;` at the end of a line, so migrations must
not contain triggers (their bodies hold inner `;` line endings) or `--` / a line-ending `;` inside string literals.

Apply migrations before the Worker that reads them goes out: `npm run deploy` does (`wrangler d1 migrations apply aglow
--remote`, then `wrangler deploy`). A bare `wrangler deploy` ahead of 0003 would break every signed-in request, since
the session lookup reads `users.star_head`. Rolling a Worker back past a migration is safe: an extra column is ignored.

0004 adds `users.home_alone`, which the same session lookup reads: the same order applies.

0005 adds `games_recent`, a partial index on ranked runs by finish time, so today's and this week's boards seek to the
window's start instead of scanning every ranked run. No Worker needs it to run correctly (it only reads faster), so its
order against a deploy doesn't matter, and rolling back leaves an unused index.

0007 splits the stale-game sweep across two partial indexes, `games_stale` (a random game or a guest's Daily, swept
after a day) and `games_stale_daily` (a signed-in player's Daily, kept three days), and drops `games_abandoned`, which
only the old sweep read. Apply it before the Worker that reads it, as `npm run deploy` does. A Worker from before it
still runs correctly against it (never an error), but its sweep plans as `SCAN games` once `games_abandoned` is gone: it
reads the whole games table, finished games included, on every start. So the old Worker's few seconds between the
migration and the deploy are fine, but any rollback of the Worker past 0007 must be short: roll forward (or put back
`games_abandoned`) quickly.
