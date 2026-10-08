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
- **After a deploy,** check that the admin is protected: signed out, `curl -i https://aglow.lukeghanna.com/api/admin/stations` must answer 401, not 503 (`AUTH_SECRET` missing).
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
- **Vars** in `wrangler.jsonc`: `AUTH_MODE` (`google`) and `GOOGLE_CLIENT_ID` (public). The D1 `database_id` there comes from `npx wrangler d1 create aglow`.

### Deploy

1. Fill in the `wrangler.jsonc` placeholders (`database_id`, `GOOGLE_CLIENT_ID`) and set the three secrets above.
2. `npm run deploy`. It runs `node scripts/deploy-check.ts` first (refuses a zero or missing `database_id`, a placeholder or missing `GOOGLE_CLIENT_ID`, or an `AUTH_MODE` of `fake`), then typecheck, tests and build, then `wrangler d1 migrations apply aglow --remote`, then `wrangler deploy`.

### After a deploy

1. `curl https://aglow.lukeghanna.com/api/me` answers `{"user":null}`.
2. Signed out, `curl -i https://aglow.lukeghanna.com/api/admin/session` and `/api/admin/stations` both answer 401 (a 503 means `AUTH_SECRET` is missing).
3. Win a game signed out: the result is unranked ("anonymous"). Sign in with Google, pick a name and save: the run is claimed and shows on the board. `/admin` opens for the admin account and shows "Not authorized" for any other.
4. Cascade check, with a throwaway Google account: sign in, claim a run, then delete the account from the account menu. Then `npx wrangler d1 execute aglow --remote --command "SELECT (SELECT count(*) FROM users WHERE email = '<test email>') AS users, (SELECT count(*) FROM games WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)) AS orphan_games, (SELECT count(*) FROM sessions WHERE user_id NOT IN (SELECT id FROM users)) AS orphan_sessions"` must show 0, 0, 0.

### Moderation

List the board with `npx wrangler d1 execute aglow --remote --command "SELECT g.id, u.name, g.ms FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 ORDER BY g.ms LIMIT 50"` and remove a run with the same command and `DELETE FROM games WHERE id = '<id>'`.
