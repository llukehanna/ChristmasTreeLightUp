# Aglow

A premium remake of the classic Christmas Tree Light Up puzzle. Turn the wires, light the tree.
Live at https://aglow.lukeghanna.com

![Aglow, a lit Christmas tree in the fireside scene](.github/screenshot.webp)

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest)
npm run e2e     # browser smoke tests (Playwright)
npm run build   # typecheck + production build
```

Design spec: `docs/superpowers/specs/2026-09-29-aglow-design.md`

## Radio admin

Luke's Christmas Jazz and Christmas Classics stations are managed at `/admin` (a Cloudflare Worker on `/api/*` plus the R2 bucket `aglow-music`; see spec section 7).

- **Sign-in:** `/admin` signs in with Google. Only the accounts in `ADMIN_EMAILS` get the editor; any other account sees "Not authorized".
- **Run it locally:** see Accounts below: `npm run dev:full`, then `http://localhost:8787/admin`, with fake sign-in as an address in `ADMIN_EMAILS`.
- **Deploy:** `npm run deploy` (see Accounts below for what it checks first).
- **After a deploy,** check that the admin is protected: signed out, `curl -i https://aglow.lukeghanna.com/api/admin/stations` must answer 401. Whether `AUTH_SECRET` is set is a separate check (see Accounts, After a deploy).
- **Uploads that were never saved** stay in R2. They are harmless (no station refers to them); delete them in the Cloudflare dashboard if you want the space back.
- A saved change is live in the game within about a minute. Files removed from a station may stay cached at the edge for up to a week.

## Accounts

Players can sign in with Google, pick a display name and post server-verified times to one all-time leaderboard. Playing never needs an account. Spec: `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md`.

- **Stack:** the same Worker on `/api/*` plus the D1 database `aglow` (`migrations/`). Sign-in is server-side OpenID Connect with PKCE; the browser never loads Google's scripts.
- **Verified times:** the Worker picks each tree's seed, stamps its start and finish, replays the tap log through the game's own code (`src/core/replay.ts`, `src/core/judge.ts`) and anchors the result to its own clock.

### Run it locally

- `cp .dev.vars.example .dev.vars` (git-ignored) and put a random value in `AUTH_SECRET` (`openssl rand -hex 32`). The example also sets `AUTH_MODE=fake` and `ADMIN_EMAILS`.
- `npm run dev:full` builds, applies the local D1 migrations and runs the real Worker on `http://localhost:8787`. Fake sign-in: open `/api/auth/google?as=<email>` (or set the `aglow_fake_as` cookie). An address in `ADMIN_EMAILS` also opens `/admin`.
- `npm run dev` (Vite only) still plays the game, offline and unranked.
- `npm run e2e` runs Playwright on `http://localhost:4173` against `npm run serve:e2e` (a fresh local D1 in `.wrangler/e2e`, `wrangler dev` with fake sign-in). It covers desktop plus the phone-size account flows and takes about 10 minutes.

### Secrets and config

- **Secrets** (`npx wrangler secret put <NAME>`; never in the repo): `AUTH_SECRET` (256 random bits, piped from `openssl rand -hex 32` so it is never shown), `GOOGLE_CLIENT_SECRET` (from the Google console) and `ADMIN_EMAILS` (the radio admin's Google email(s), comma-separated, lower-case). Check with `npx wrangler secret list`.
- **Vars** in `wrangler.jsonc`: `AUTH_MODE` (`google`) and `GOOGLE_CLIENT_ID` (public). The D1 `database_id` there (also public) is the `aglow` database's, from `npx wrangler d1 create aglow`.

### Deploy

1. `wrangler.jsonc` carries the real `database_id` and `GOOGLE_CLIENT_ID`. Set the three secrets above, then run `npx wrangler secret list`: it must show `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAILS` (names only; values are never shown).
2. `npm run deploy`. It runs `node scripts/deploy-check.ts` first (refuses a zero or missing `database_id`, a placeholder or missing `GOOGLE_CLIENT_ID`, or an `AUTH_MODE` of `fake`), then typecheck, tests and build, then `wrangler d1 migrations apply aglow --remote`, then `wrangler deploy`.

### After a deploy

1. `AUTH_SECRET` is set: `curl -i https://aglow.lukeghanna.com/api/me -H 'Cookie: __Host-aglow_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'` (a well-formed 43-character token that matches no session) answers `{"user":null}`. A 503 `not_configured` means `AUTH_SECRET` is missing. (Without a cookie the Worker never needs the secret, so a bare `curl` proves nothing.)
2. Signed out, `curl -i https://aglow.lukeghanna.com/api/admin/session` and `/api/admin/stations` both answer 401.
3. Win a game signed out: the result is unranked ("anonymous"). Sign in with Google, pick a name and save: the run is claimed and shows on the board. `/admin` opens for the admin account and shows "Not authorized" for any other.
4. Cascade check, with a throwaway Google account: sign in, claim a run, then delete the account from the account menu. Then `npx wrangler d1 execute aglow --remote --command "SELECT (SELECT count(*) FROM users WHERE email = '<test email>') AS users, (SELECT count(*) FROM games WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)) AS orphan_games, (SELECT count(*) FROM sessions WHERE user_id NOT IN (SELECT id FROM users)) AS orphan_sessions"` must show 0, 0, 0.

### History import and account stats

Spec: `docs/superpowers/specs/2026-10-08-aglow-history-import-design.md`.

- **Account stats:** signed in, the Your games totals come from `GET /api/me/stats` (every finished game on the account, imported ones included; streaks in the player's time zone), so they match on every device. The results tag's Solved, Average and Day streak show the same numbers as the totals, with this device's pre-accounts history added so nothing drops on signing in: the first time a browser shows a signed-in tag for an account it saves its `{solved, totalSeconds}` (`aglow.statsBaseline`, one entry per account, never overwritten, at most 10), and Solved is the account's plus that, the average covers both, and the streak is the larger of the device's live streak and the account's (Longest likewise). An account that has imported (the admin) shows its own numbers, with no baseline; so does a browser whose storage is blocked. A few signed-out wins claimed at first sign-in can be counted in both, which is accepted. Signed out or offline, the device's own `aglow.stats` shows, and it keeps recording either way.
- **Import (admin only):** `/admin` → "Import this device's history" reads this browser's `aglow.stats`. Check the numbers (subtract games played on this device since accounts launched, as the card suggests); every field can be edited, and the card shows what it will create (runs, best, average, streaks) before you import. The Worker fabricates that many runs for your own account (`worker/lib/history.ts`: exactly the best, exactly the total, the streaks, dated from 2026-09-29) and stores them as ordinary ranked games with `source = 'import'`. Once per device: the browser keeps `aglow.historyImport`, and resending the same import adds nothing. The card's account line shows the account's current and longest streak. **Several devices merge their days:** each import adds its own days to the account, and the account's streaks come from all of them together, so they can be longer than any one device's (two devices that both end on the same day gave 9 / 9 from a 3 / 5 and a 1 / 2 in testing).
- **Undo an import (every device at once):** find your user id with `npx wrangler d1 execute aglow --remote --command "SELECT id, name FROM users WHERE email = '<your email>'"`, then `npx wrangler d1 execute aglow --remote --command "DELETE FROM games WHERE source = 'import' AND user_id = <id>"`. To import again from that browser, remove `aglow.historyImport` from its localStorage (DevTools, Application).
- **Undo one device only:** its runs share the id prefix `imp_<importId>_`, and the `importId` is in that browser's localStorage under `aglow.historyImport` (DevTools, Application). Then `npx wrangler d1 execute aglow --remote --command "DELETE FROM games WHERE id GLOB 'imp_<importId>_*'"` (GLOB, not LIKE: `_` is a LIKE wildcard), and remove `aglow.historyImport` from that browser to import it again.
- **Deploy with `npm run deploy` every time.** It applies migration 0002 (the `source` column) before it deploys the Worker. A bare `wrangler deploy` on a database without the column would answer 503 on Your games, the stats and the import (the board, finishing, claiming and sign-in would still work). Rolling the Worker back (`wrangler rollback`) is schema-safe: the old code never names `source`, and its inserts list their columns, so the migration stays applied.
- **First real import:** keep the total imported in the hundreds unless the D1 dashboard shows room (the numbers are under "Watch in December"). The card's account line shows how many runs are already imported (the total is the sum over devices). Before importing, see how the public top 50 would change: imported runs rank like any run, so a few hundred fast ones can fill most of it with runs dated before accounts launched.

### Moderation

- **List the board,** with what each run's log says about it: `npx wrangler d1 execute aglow --remote --command "SELECT g.id, u.id AS user_id, u.name, g.ms, g.source, g.paused_ms, g.pauses, json_array_length(g.log) AS entries FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 ORDER BY g.ms LIMIT 50"`. Imported runs (`source = 'import'`) have no log.
- **Remove a run** with the same command and `DELETE FROM games WHERE id = '<id>'`.
- **Reset an offensive name** with `UPDATE users SET name = NULL, name_key = NULL WHERE id = <user_id>`: the player's runs leave the board and they are asked to pick a name again.
- Changes made this way reach the board within about 20 seconds (each Worker isolate keeps the top 50 and the total that long).

### Watch in December

- **D1 rows read** (Cloudflare dashboard, D1, `aglow`, Metrics; the Free plan allows 5 million a day). Check them the day after an import. The board's top 50 and total are cached per isolate for 20 s (`worker/lib/board-cache.ts`). Measured on the local D1:
  - `rankOf` reads **2 rows per run ahead**. Every finish and claim runs it, as does a pinned "Your best" outside the top 50 and every Your games open. Imported runs count like any run, so each imported run faster than a player's run adds 2 rows to every one of those for that player.
  - The board total reads **2 rows per board run, per isolate refresh** (at most once every 20 s per isolate).
  - `GET /api/me/stats` reads **about 2 rows per game on the account, per call**: it runs on every signed-in finish, claim and Your games open (about 4,000 rows for 2,000 games).
  - Example: 2,000 imported runs with a median of 1:15, and 1,000 placed finishes or rank reads a day from players slower than most of them, is about +4 million rows a day, 80% of the allowance. At 300 imported runs it is about +0.6 million. **Keep the total imported in the hundreds unless the dashboard shows room.** If reads climb toward the limit, cache more or keep a running count.
- **D1 rows written:** about **5 per imported run** (the row, its primary-key index and the `games_board`, `games_user` and `games_best` entries): a 2,000-run import writes about 10,000 rows; the Free plan allows 100,000 a day.
- **Import CPU:** after the first real import, open the `POST /api/admin/import` request in Workers Logs (Cloudflare dashboard, Workers, aglow, Logs) and read its CPU time. The Free plan allows 10 ms; the estimate is 1 to 2.5 ms for 2,000 runs (measured in Node). If it is over, import in smaller batches. A kill after the insert is harmless: a resend answers `already`.
