# D1 migrations

Applied in filename order by `wrangler d1 migrations apply` and, for the Worker tests, by `tests/worker/harness.ts`.
The harness's splitter strips every `--` comment and splits statements on a `;` at the end of a line, so migrations must
not contain triggers (their bodies hold inner `;` line endings) or `--` / a line-ending `;` inside string literals.

Apply migrations before the Worker that reads them goes out: `npm run deploy` does (`wrangler d1 migrations apply aglow
--remote`, then `wrangler deploy`). A bare `wrangler deploy` ahead of 0003 would break every signed-in request, since
the session lookup reads `users.star_head`. Rolling a Worker back past a migration is safe: an extra column is ignored.
