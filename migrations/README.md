# D1 migrations

Applied in filename order by `wrangler d1 migrations apply` and, for the Worker tests, by `tests/worker/harness.ts`.
The harness's splitter strips every `--` comment and splits statements on a `;` at the end of a line, so migrations must
not contain triggers (their bodies hold inner `;` line endings) or `--` / a line-ending `;` inside string literals.
