# Aglow: accounts and leaderboard

**Date:** 2026-10-07
**Status:** Draft for Luke's review
**Builds on:** [Aglow design](2026-09-29-aglow-design.md) (§3 hosting, §6 game flow, §7 admin)
**Reference implementation:** Mapped v2 (`/Users/luke/Claude Projects/Mapped`, spec `docs/superpowers/specs/2026-10-05-mapped-v2-accounts-design.md`). Reuse its code and lessons wherever this spec doesn't say otherwise.
**Mockups:** throwaway worktree `.claude/worktrees/agent-aeaddf57b5d538524` (`mockups.html`; local only, never merged).

Players can sign in with Google, pick a display name, and post verified times to one all-time leaderboard. Playing never needs an account. The radio admin moves from a password to Luke's Google account.

## Decisions

| Question | Decision |
| --- | --- |
| Sign-in | Google only. Server-side OpenID Connect: authorization code + PKCE. Scopes `openid email`. |
| When an account is needed | Never to play. A win offers "Save to leaderboard"; signing in claims that run and any other recent signed-out wins on this browser. |
| Boards | One all-time board over random trees (no daily or per-size boards). |
| What ranks | Time only: the server-computed active time in ms. Ties go to the earlier finish. |
| Runs per player | Unlimited. The board is the top 50 **runs**, so one player can hold several rows. |
| Anti-cheat | The server picks the seed and stamps start and finish. On finish it replays the tap log through the real game code and anchors the log to its own clock. |
| Pauses | Excluded from ranked time and trusted as reported by the client, within a cap (10 min total and 20 pauses). Beyond the cap, the run is "unranked: paused too long". |
| Identity | A unique display name, chosen once after the first sign-in. Google names and emails are never shown publicly. |
| Admin | `/admin` and `/api/admin/*` require a session whose verified Google email is in `ADMIN_EMAILS` (Luke's). The password admin is removed. |
| Extras | Claim signed-out wins (90 days); a "Your games" sheet; account delete; a privacy page. No import of old local bests, and no rank in the share image. |
| UI picks | 1A: HUD name chip. 2C: dark-glass sheets like the radio panel. 3B: a ribbon badge on the results tag. |
| Stack | The existing Worker `aglow` on `/api/*`, plus a D1 database `aglow`. |

## Non-goals

- Daily or seasonal boards, friends, other players' profiles, avatars.
- Passwords, email codes or any provider other than Google.
- Importing pre-accounts local stats. The existing `aglow.stats` stays as it is, local only.
- An in-app moderation UI. Moderation is `wrangler d1 execute`, deleting a game row.
- Bot detection beyond replay, the clock anchor and the speed floors.

## 1. Architecture

- **Worker.** The Worker stays limited to `/api/*` (`run_worker_first`). New route groups: `/api/auth/*`, `/api/me*`, `/api/games*` and `/api/board`.
  - The router gains Mapped-style regex routes for `:id` paths.
  - **Every** non-GET `/api/*` request needs a same-origin `Origin` and a JSON content type. This extends today's admin-only check.
  - The upload route is the one exception to the content-type rule: it streams raw audio.
- **Shared code.** The Worker imports the game's pure core (`src/core/*`: `Board`, `GRID`, `mulberry32`) to replay runs. It never imports UI or rendering code. The existing import guard test is extended to enforce this.
- **D1.** Bound as `DB`, database `aglow`, `migrations_dir: "migrations"`.
- **Secrets** (`wrangler secret put`):
  - `AUTH_SECRET`: 256 random bits, piped so no one sees it.
  - `GOOGLE_CLIENT_SECRET`: Luke pastes it himself from the Google console.
- **Vars:** `GOOGLE_CLIENT_ID`, `AUTH_MODE` (`google`, or `fake` on localhost only) and `ADMIN_EMAILS` (comma-separated, lower-cased).
- **Removed:**
  - `ADMIN_PASSWORD`, `SESSION_SECRET`, the `aglow_admin` cookie, `worker/lib/session.ts`'s password logic, the `LOGIN_LIMITER` binding, `POST /api/admin/login`, `POST /api/admin/logout` and the admin password screen.
  - After the deploy, Luke deletes the two old secrets with `wrangler secret delete`. Claude doesn't do it, because deleting is irreversible.
- **Free-plan fit:**
  - Workers Free allows 100k requests a day; one game is about 3 requests.
  - CPU is 10 ms per request. The finish handler's replay must stay inside that: a few hundred taps × a BFS over about 120 tiles.
  - D1 Free allows 5M reads and 100k writes a day.

## 2. Data model (`migrations/0001_init.sql`)

```sql
users(id INTEGER PK, google_sub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT, name_key TEXT UNIQUE, created_at INTEGER NOT NULL)
sessions(token_hash TEXT PK, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)
games(
  id TEXT PK,                       -- random, URL-safe
  user_id INTEGER REFERENCES users ON DELETE CASCADE,  -- null until claimed
  claim_hash TEXT,                  -- HMAC of the claim token, signed-out games only
  gen_version INTEGER NOT NULL,     -- generator/mask version, so later code changes never break stored replays
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,      -- server ms
  finished_at INTEGER,              -- server ms
  ms INTEGER,                       -- ranked time (active ms), server-computed
  paused_ms INTEGER, pauses INTEGER,
  ranked INTEGER NOT NULL DEFAULT 0,
  unranked_reason TEXT,             -- 'anonymous' | 'paused' | 'too_fast' | 'clock'
  log TEXT                          -- JSON tap log, kept for audits and recomputes
)
INDEX games_board ON games(ms, finished_at) WHERE ranked = 1
INDEX games_user ON games(user_id, finished_at DESC)
INDEX games_abandoned ON games(started_at) WHERE finished_at IS NULL
starts(ip_hash TEXT NOT NULL, at INTEGER NOT NULL)  -- one row per start (IPv6 keyed by /64) for the 200/hour limit, so a 422's deleted game still counts; INDEX starts_ip(ip_hash, at), starts_at(at); each start prunes up to 50 rows older than an hour
```

- **Rank of a run:** 1 + the count of ranked runs with a lower `ms`, or equal `ms` and an earlier `finished_at`. Only runs by named users count; unnamed accounts are excluded from the board and from ranks.
- **Housekeeping:** lazy, on writes, with no cron. Each game start deletes up to 50 stale rows: unfinished games older than 1 day, and unclaimed finished games older than 90 days.

## 3. API

| Method and path | Purpose |
| --- | --- |
| `GET /api/auth/google?return=` | Start sign-in. Fake mode skips Google. |
| `GET /api/auth/google/callback` | Finish sign-in, set the session and redirect to `return`. |
| `GET /api/auth/name?n=` | Check whether a name is available. |
| `POST /api/auth/name` | Set the display name once. A taken name gets 409. |
| `POST /api/auth/signout` | Sign out. |
| `GET /api/me` | `{user: {name, isAdmin} \| null}`. Renews the session when under 182 days remain. |
| `DELETE /api/me` | Delete the account. Requires a typed confirmation (the name, or the email if unnamed). |
| `GET /api/me/games` | Best run with its rank, the count of top-50 runs, and the last 30 games. |
| `POST /api/games` | Start a game: `{id, seed, genVersion, claim?}`. Limited to 200 starts per IP hash per hour (429). |
| `POST /api/games/:id/finish` | `{log}` → `{ranked, reason?, ms, rank?, total, best?, newBest}`. Idempotent. |
| `POST /api/games/claim` | `{claims: [{id, claim}]}`, up to 8 per call → the claimed results. |
| `GET /api/board` | The top 50 runs `[{rank, name, ms, finishedAt, mine}]`, `total` ranked runs, and `you` (your best run's row if it's outside the top 50). Short cache: `private, max-age=15`. |
| `GET /api/stations` and `/api/admin/stations`, `/api/admin/upload`, `/api/admin/session` | As today. The admin routes now check the Google session plus `ADMIN_EMAILS`: 401 when signed out, 403 when not the admin. |

Errors are `{error, message}` JSON. Unexpected failures return 503 and are logged by name only (the current convention).

## 4. Sign-in

Port Mapped's `worker/auth.ts`:

- **Flow cookie:** `__Host-aglow_oauth` holds `state.verifier.return` for 600s.
- **Request:** S256 PKCE, `prompt=select_account`.
- **Callback checks:** state, then `iss`, `aud`, `exp` and `email_verified` on the `id_token` returned by Google's token endpoint over TLS.
- **Account write:** upsert the user by `sub`. In one D1 batch: insert the session, delete expired sessions, and revoke the browser's previous session.
- **Session cookie:** `__Host-aglow_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, 365 days. D1 stores only `HMAC(AUTH_SECRET, 'session:' + token)`. `SameSite=Lax` is required so the cookie survives the redirect back from Google.
- **Return path:** sanitised to a same-site path; it may not start with `//` or `/\`.
- **Failures:** any callback failure redirects to `/?auth=failed`, and the game shows a toast.
- **Fake mode:** `AUTH_MODE=fake` signs in as `?as=<email>` or the `aglow_fake_as` cookie. The Worker refuses every request with 500 `misconfigured` when fake mode is set on a non-local host.
- **Admin:** `isAdmin` = signed in, with `users.email` (verified at sign-in) in `ADMIN_EMAILS`. The `/admin` page calls `GET /api/admin/session`:
  - signed out → a "Sign in with Google" card;
  - signed in but not the admin → "Not authorized";
  - the admin → the editor.
  - Uploads and saves behave exactly as today.

## 5. Game flow and verification

### 5.1 Start
- A new tree (not a restored one) calls `POST /api/games` with a 1.5s timeout.
- **Success:** build the board with `Board.random(GRID, mulberry32(seed))`. The call order is solution, then scramble, then colors (`src/core/board.ts`). Any change to that order, the mask or a generator bumps `GEN_VERSION`, and the Worker keeps replay support for every version still stored.
- **Failure or timeout:** a local `Math.random` tree, shown as unranked "offline". Play is never blocked.
- `started_at` is stamped by the server just before the insert.
- Signed-out starts get a `claim` token. Only its HMAC is stored.

### 5.2 Log
- The client records `{t, a}` entries, where `t` is integer wall-clock ms since the game's local start (`Date.now() − startEpoch`, with `startEpoch` saved with the game), so `t` stays continuous across reloads:
  - `a = i` (a tile index) for an **accepted** tap. Taps ignored because the queue is full aren't logged.
  - `a = 'p'` for pause, `a = 'r'` for resume.
- A tab switch and a reload count as pauses: `pagehide` logs `'p'`, and the restore logs `'r'`.
- `aglow.game` becomes v2 and adds `{gameId, seed, genVersion, claim?, log}`.
  - A v1 save still restores but plays as unranked "offline".
  - A v2 save resumes the same server game.

### 5.3 Finish and judge
On a win, the client sends `POST /api/games/:id/finish {log}`, retrying once after 800ms. The server does the following:

1. **Already finished:** return the stored result (idempotent; a race-protected `UPDATE … WHERE finished_at IS NULL`).
2. **Parse the log:** at most 5,000 entries, integer `t` that never decreases, at most 1 day, tap indices that exist in `GRID`, and alternating `p`/`r`.
3. **Replay:** rebuild the board from `seed`/`genVersion`, then apply each tap with `Board.tap(i, t)` and `tick(t)`. The tree must be solved exactly at the last tap's settle, with no taps inside a pause and no taps after the solve. If any of that fails: **422 `unverified`, and the game row is deleted** (Mapped's revision 1).
4. **Clock anchor:** compare the log's span (from local start to the solve) with `serverElapsed = finished_at − started_at`. `serverElapsed` is normally a little longer, because it includes both network legs.
   - `serverElapsed − span > CLOCK_TOLERANCE_MS` (3000ms) → `clock` (unranked). Time the log doesn't account for, such as studying the board before the log starts, can't shorten a ranked run.
   - `span − serverElapsed > CLOCK_TOLERANCE_MS` is impossible → 422 `unverified`, as in step 3.
5. **Ranked time:** `ms` = span − reported pause time − `REVEAL_MS`, which is when the clock starts (§6 of the base spec).
6. **Ranking rules:**
   - Total pause above 10 min, or more than 20 pauses → `paused`.
   - `ms` < 5000, or more than 10% of consecutive tap gaps under 40ms → `too_fast`.
   - No user (signed out) → `anonymous`, which becomes ranked when claimed, if no other reason applies.
   - Otherwise ranked.
7. **Respond:** `{ranked, reason, ms, rank, total, best, newBest}`.

### 5.4 Claim
- The browser keeps signed-out claims in localStorage: `{id, claim, at}`, 90 days, at most 500.
- After sign-in (and once a name is set), it claims them 8 per request. Claiming sets `user_id`, and runs whose only reason was `anonymous` become ranked.
- A 401 on any signed-in call signs the browser out locally.

## 6. UI

All sheets use the radio panel's dark-glass look (pick 2C). They pause the game, close on Escape or an outside tap, trap focus, and get added to `setPaused`'s `inert` list.

- **HUD chip (1A)**, beside the ··· button. `fitHud()` accounts for it.
  - Signed out, it reads "Sign in" and opens the sign-in card.
  - Signed in, it shows the name (or initial at narrow widths) and opens a menu: Leaderboard, Your games, Radio admin (admins only), Sign out, Delete account.
- **Sign-in card:**
  - A Google-branded "Continue with Google" button.
  - One line: "Your name on the leaderboard is the one you pick. We never show your email."
  - A privacy link.
- **Name card**, shown once after the first sign-in:
  - Mapped's rule: 3–20 letters, digits, spaces, `-` or `_`.
  - A debounced availability check (taken, available, invalid), plus a reserved list (e.g. `admin`, `aglow`, `santa`).
  - Uniqueness ignores case, spaces, `-` and `_` (`name_key`, the same normalisation as the reserved list), so "Tinsel Tom", "Tinsel_Tom" and "tinsel-tom" collide: one can't impersonate another.
- **Leaderboard sheet:** the top 50 runs as rank, name, time `m:ss.t` and date. Your rows are highlighted, and your best run is pinned below the list if it's outside the top 50. The total number of ranked runs is shown.
- **Your games sheet:** best time and its rank, the number of runs in the top 50, and recent games with ranked or unranked status.
- **Results tag ribbon (3B):**
  - Ranked: "#12 of 340 runs"; "New personal best!" or "Your best 1:21.0".
  - Signed out: a "Save to leaderboard" ribbon button that opens sign-in and returns to the results tag.
  - Unranked: "Unranked: paused too long" / "offline" / "too fast" / "couldn't verify the clock".
  - Rendering of the existing time, score and stats doesn't change.
- **Delete-account card:** type your name to confirm. It deletes the user, sessions and games (cascade).
- **`/privacy`:** a static page covering what is stored (Google `sub`, email, display name, games and tap logs, hashed IP for rate limits), why, how long, and how to delete. It's required for the Google OAuth consent screen.

## 7. Setup (done by Claude unless noted)

1. Create the D1 database `aglow`, add its binding and apply migrations (`--local` for dev and e2e; `--remote` before the deploy).
2. **Google Cloud.** Create a new project "Aglow" in Chrome. Configure the OAuth consent screen: name "Aglow", the support email, `https://aglow.lukeghanna.com` as the home page, `/privacy` as the privacy link, and `openid email` as the scopes. Create a Web client with:
   - redirect URI `https://aglow.lukeghanna.com/api/auth/google/callback`
   - redirect URI `http://localhost:4173/api/auth/google/callback` for real-Google local checks
   - **Luke** accepts any terms and publishes the app (production, not testing).
3. Put `GOOGLE_CLIENT_ID` in `wrangler.jsonc`. **Luke** runs `npx wrangler secret put GOOGLE_CLIENT_SECRET` with the secret left on screen. Claude pipes a random `AUTH_SECRET`.
4. Set `ADMIN_EMAILS`.
5. **Luke** runs `npm run deploy`.
   - The deploy script gains `wrangler d1 migrations apply aglow --remote`, plus a guard that `GOOGLE_CLIENT_ID` isn't a placeholder.
6. **Smoke-test:**
   - `/api/me` → `{user:null}`;
   - a signed-out start and finish → `anonymous`;
   - Luke signs in → claims work, the run is on the board, `/admin` loads.
   - `/api/admin/stations` signed out → 401.
7. **Luke** deletes the old `ADMIN_PASSWORD` and `SESSION_SECRET` secrets.

## 8. Error handling

- **API unreachable at start:** play offline, unranked, with no error shown. If it's unreachable at finish, retry once, then show "Couldn't save this run" with a Retry on the results ribbon. The run stays claimable from the log in `aglow.game` until a new tree starts.
- **`?auth=failed`:** toast "Sign-in didn't finish. Try again."
- **Name taken between the check and the save:** inline error, and the card stays open.
- **429 on start:** play offline, unranked.
- **Admin:** a 401 or 403 mid-session shows the sign-in or not-authorized card. Unsaved edits are kept, as today.

## 9. Testing

- **Unit (Node vitest):**
  - log parsing; replay, against seeds solved by a scripted solver built from the solution bits;
  - the judge reasons and their order; the pause cap; the speed floors;
  - the `GEN_VERSION` table; name rules; the return-path sanitiser; claim storage (TTL and cap); `Board.random` determinism per seed.
- **Worker integration:**
  - Mapped's `getPlatformProxy` harness with a real local D1 (`persist:false`), migrations applied per run, fake auth, and Google's token endpoint stubbed for the real-mode callback tests.
  - Covers: start rate limit, finish idempotency, the 422 delete, claim batches, board ranks with multiple runs per user, `/api/me/games`, delete cascade, admin 401/403/200, fake mode refused on a non-local host, and a CPU guard (replaying the longest legal log stays well under the 10ms budget).
- **E2E (Playwright):**
  - `serve:e2e` = `wrangler d1 migrations apply --local --persist-to .wrangler/e2e`, then `wrangler dev --port 4173 --local-upstream localhost:4173 --var AUTH_MODE:fake …`.
  - Scenarios:
    - play signed out → win → "Save to leaderboard" → fake sign-in → pick a name → the run is on the board;
    - pause past the cap → unranked ribbon;
    - two runs by the same player both appear on the board;
    - Luke's fake account opens `/admin`, another account gets "Not authorized";
    - the existing radio and admin e2e tests keep passing, with admin sign-in now going through fake Google.
  - Desktop and phone projects.

## 10. Rollout

One branch (`worktree-accounts`), executed with subagent-driven development, reviewed per task plus a final whole-branch review. It's merged to `main` once green. Luke runs the deploy, and Claude smoke-tests (§7.6).
