# Aglow: history import and account stats

**Date:** 2026-10-08
**Status:** Approved (design `.superpowers/history-import-design.md`, Luke, 2026-10-08); planned in `docs/superpowers/plans/2026-10-08-aglow-history-import.md`
**Builds on:** [Aglow accounts and leaderboard](2026-10-07-aglow-accounts-design.md) (§2 data model, §3 API, §6 UI). Where the two differ, this spec wins; it supersedes that spec's non-goal "Importing pre-accounts local stats" for the admin's own devices.

Luke's words: "we should be tracking every game. I want my games to fill the leaderboards too. so backfill my stats … and from now on, track it", then "for my account specifically, fabricate that data from my runs to your best ability".

Two parts:

1. **History import (admin only).** `/admin` reads this browser's pre-accounts stats (`aglow.stats`) and, after the admin confirms or edits them, the Worker fabricates that many runs for the admin's own account: plausible, deterministic, and consistent with the stats (exact best, exact total, the streaks). They are ordinary ranked games rows marked `source = 'import'`.
2. **Account stats.** A new `GET /api/me/stats` gives solved, average, best and streaks from the account's games, so the results tag and Your games show the same numbers on every device. Device stats stay the fallback.

## Decisions

| Question | Decision |
| --- | --- |
| Who can import | The admin only (`requireAdmin`): any player could forge `aglow.stats` in the console. Runs go to the signed-in admin's own account. |
| What the client sends | The edited numbers: `solved`, `bestSeconds`, `averageMs` (exact ms), `streak`, `longestStreak`, `lastSolvedDay`, plus the browser's `tz` offset and an `importId`. The total is `solved × averageMs`. |
| How runs are made | A pure, seeded function of the request (`worker/lib/history.ts`), PRNG `mulberry32` (`src/core/rng.ts`) seeded from `importId`. Same request, same runs. |
| Idempotency | Run ids are `imp_<importId>_<index, 4 digits>`. If run 0 of an `importId` exists, the import answers `already` and inserts nothing, whatever the numbers; the insert is one `INSERT OR IGNORE` statement besides. |
| Storage | Normal `games` rows, `source = 'import'` (new column), ranked, no log. They rank like any run. Replay and judge never see them. |
| Undo | `DELETE FROM games WHERE source = 'import' AND user_id = <id>` (README). |
| Account stats | Every finished game (imported included) counts for solved and average; best is the best ranked run (the board's "your best"); streaks come from distinct local days of finishes, in the client's time zone. |
| Where they show | Signed in: the results tag's Solved, Average and Day streak, and a new totals row in Your games. Signed out, offline or loading: the device's stats, as today. The device keeps recording `aglow.stats` either way. |

## Non-goals

- Importing for anyone but the signed-in admin; an import UI in the game.
- Importing per-run data (there is none: `aglow.stats` holds totals only).
- Editing or deleting imported runs from any UI (README SQL only).
- Daylight-saving accuracy inside an import: one offset (the one at import time) places every imported day.
- Changing the results tag's best badge: it stays the device's (it is hidden whenever the ranking rosette shows).

## 1. Constants (shared, `src/api/types.ts`)

| Name | Value | Meaning |
| --- | --- | --- |
| `HISTORY_FIRST_DAY` | `'2026-09-29'` | The game's first commit; no imported run is dated before it. |
| `MAX_IMPORT_RUNS` | `2000` | Most runs one import adds. |
| `MIN_IMPORT_BEST_SECONDS` | `5` | Lowest importable best (the judge's ranked floor is 5000 ms). |
| `MAX_IMPORT_MS` | `3_600_000` | Highest importable best and average (60:00). |
| `MAX_STREAK_DAYS` | `3650` | Highest importable streak. |

Fabrication constants (`worker/lib/history.ts`): `TREND = 0.6`, `SIGMA = 0.5`, `LOW_SIGMA = 0.9`, `BEST_FROM = 0.6`.

## 2. Data model (`migrations/0002_history_import.sql`)

```sql
-- History import (spec 2026-10-08 section 2): where a game came from. 'play' for games played on Aglow (every row so
-- far), 'import' for runs the admin imported from a device's pre-accounts stats.
ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'play' CHECK (source IN ('play', 'import'));
```

- No new index: the import checks one id by primary key; the stats read the user's games through `games_user`.
- An imported row: `id = imp_<importId>_<NNNN>`, `user_id` = the admin, `claim_hash` NULL, `gen_version` 0, `seed` 0, `started_at = finished_at − ms`, `finished_at` as fabricated, `ms` as fabricated, `paused_ms` 0, `pauses` 0, `ranked` 1, `unranked_reason` NULL, `log` NULL, `source` `'import'`.
- Housekeeping never touches them (they have a user and a finish). Deleting the account cascades to them.
- `POST /api/games/:id/finish` on an imported id answers the stored result unchanged (the existing already-finished path); a claim skips them (`claim_hash` is NULL).

## 3. API

Errors stay `{error, message}` with `Cache-Control: no-store`; unexpected failures 503 (accounts spec §3).

### 3.1 `POST /api/admin/import`

Admin only; a write, so same-origin `Origin` and `Content-Type: application/json` (the router's `checkWrite`).

Request (`ImportRequest`):

```json
{
  "importId": "AbCdEfGhIjKlMnOpQrStUv",
  "solved": 40,
  "bestSeconds": 41,
  "averageMs": 78500,
  "streak": 3,
  "longestStreak": 5,
  "lastSolvedDay": "2026-10-07",
  "tz": 420
}
```

Validation, in this order; the first failure answers **400** `{error: "invalid", message}` with exactly this message:

| Field | Rule | Message |
| --- | --- | --- |
| `importId` | string, `/^[A-Za-z0-9_-]{16,32}$/` | `importId must be 16–32 letters, digits, - or _.` |
| `solved` | integer, 1 … 2000 | `Games solved must be a whole number from 1 to 2,000.` |
| `bestSeconds` | integer, 5 … 3600 | `Best time must be from 0:05 to 60:00, in whole seconds.` |
| `averageMs` | integer, `bestSeconds × 1000` … 3,600,000 | `Average time must be at least the best time and at most 60:00.` |
| `averageMs` when `solved = 1` | equals `bestSeconds × 1000` | `With one game, the average time is the best time.` |
| `streak`, `longestStreak` | integers, `1 ≤ streak ≤ longestStreak ≤ 3650` | `Streaks are whole days from 1 to 3,650, and the longest is at least the current one.` |
| `tz` | integer minutes, −840 … 840 (`Date#getTimezoneOffset`: UTC minus local, 420 in PDT) | `tz must be whole minutes from -840 to 840.` |
| `lastSolvedDay` | a real `YYYY-MM-DD` date, `≥ 2026-09-29` and `≤` today in the `tz` zone (server clock); today only once `solved` finishes fit between its midnight and a second ago, 1 ms apart (the first `1 + solved` ms or so of the day are excluded) | `Last solved day must be a date from 2026-09-29 to today.` |

Other statuses: 401 `signed_out`, 403 `forbidden` (not the admin, or a cross-site write), 400 `bad_json`, 413 `too_large`, 503.

Response **200** (`ImportResponse`):

```json
{ "added": 40, "already": false, "streak": 3, "longestStreak": 5, "clamped": false }
```

- `added`: rows inserted. `already`: `added === 0` (this `importId` was imported before). `streak` / `longestStreak`: what the dates show after clamping (§4.2); `clamped`: either differs from the request.
- Steps: `requireAdmin` → read and validate → fabricate (pure) → `SELECT 1 FROM games WHERE id = <run 0's id>` → if absent, **one** statement inserts every run from a JSON array bound as `?2` → `resetBoardCache()` (the isolate's top 50 and total).

```sql
INSERT OR IGNORE INTO games (id, user_id, claim_hash, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, log, source)
SELECT json_extract(value, '$[0]'), ?1, NULL, 0, 0, json_extract(value, '$[1]') - json_extract(value, '$[2]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), 0, 0, 1, NULL, NULL, 'import'
FROM json_each(?2)
```

`?2` is `JSON.stringify(runs.map((r) => [r.id, r.finishedAt, r.ms]))`: about 70 bytes a run, 140 KB at 2,000 (D1 allows 2 MB per value, 100 bound parameters and 50 queries per request; this uses 2 parameters and 3 queries).

### 3.2 `GET /api/me/stats?today=YYYY-MM-DD&tz=<minutes>`

Signed-in only: **401** `signed_out` otherwise. `today` must be a real `YYYY-MM-DD` date and `tz` match `/^-?\d{1,3}$/` within −840 … 840, else **400** `{error: "invalid", message: "today must be YYYY-MM-DD and tz whole minutes from -840 to 840."}`.

Response **200** (`AccountStats`), `Cache-Control: no-store`:

```json
{
  "solved": 312,
  "totalMs": 24478272,
  "averageMs": 78456,
  "bestMs": 41000,
  "streak": 4,
  "longestStreak": 7,
  "lastSolvedDay": "2026-10-08",
  "imported": 300
}
```

- `solved`: finished games of the user (any ranked state, any source). `totalMs`: the sum of their `ms`. `averageMs`: `round(totalMs / solved)`, null when `solved = 0`. `bestMs`: the best ranked run (`BEST_SQL`, the board's "your best"), null when none. `imported`: finished games with `source = 'import'`.
- Days: a finish's local day is `floor((finished_at − tz × 60000) / 86400000)` (days since 1970-01-01). The query returns the distinct days in order (`CAST(?2 AS INTEGER)` keeps the division integral whatever type D1 binds a JS number as).
- `streak`: the run of consecutive days ending at the last played day, if that day is `today` or `today − 1`; otherwise 0. `longestStreak`: the longest run. `lastSolvedDay`: the last played day as `YYYY-MM-DD`, null when none.
- One D1 batch of three statements: totals, distinct days, best. Rows read ≈ the user's finished games (through `games_user`); CPU is a loop over distinct days.

### 3.3 `GET /api/me/games` (changed)

Each `RecentGame` gains `imported: boolean` (`source = 'import'`).

## 4. Fabrication (`worker/lib/history.ts`, pure)

`fabricateHistory(input: HistoryInput): History`, where `HistoryInput = {importId, solved, bestMs, averageMs, streak, longestStreak, lastDay, tz, now}` (`lastDay` a day number, `now` the server's epoch ms) and `History = {runs: {id, finishedAt, ms}[], streak, longestStreak, clamped}`. Precondition (the route validates): `solved ≥ 1` and `lastDay ≥ dayNumber('2026-09-29')`; otherwise it throws `RangeError`.

Notation: `N = solved`, `B = bestMs`, `A = averageMs`, `T = N × A`, `first = 2026-09-29`, `last = lastDay`, `span = last − first + 1`.

### 4.1 Randomness and determinism

- `rng = mulberry32(fnv1a32(importId))`, FNV-1a over the UTF-16 code units (offset `0x811c9dc5`, prime `0x01000193`).
- Draws happen in this order and no other: (1) one per free day (§4.2), (2) one weight per played day (§4.2), (3) the best's index (§4.3), (4) two per non-best run in index order (§4.3), (5) per played day in order: the session window, its start, then one per gap (§4.4).
- No `Math.random`, no `Date.now()` inside: `now` is an input. The same input always gives the same output (a test asserts deep equality).

### 4.2 Days and streaks (with clamping)

1. **Current streak** `s = min(streak, span, N)`: days `last − s + 1 … last`.
2. **Longest run** when `longestStreak > s`: `l = min(longestStreak, span − s − 1, N − s)`; if `l ≤ s`, there is no separate run (`l = 0`). Otherwise days `last − s − l … last − s − 1`, so day `last − s` is the empty gap between the two runs.
3. **Shown longest** `top = l > 0 ? l : s`. `streak`/`longestStreak` in the result are `s`/`top`; `clamped = s ≠ streak || top ≠ longestStreak`.
4. **Block start** `blockStart = l > 0 ? last − s − l : last − s + 1`. Day `blockStart − 1` stays empty, so nothing extends the earliest reserved run.
5. **Free days** `first … blockStart − 2`, in order: each is played when `rng() < 0.5` and the free run so far is shorter than `top` (so no free run beats the longest); an unplayed day resets the run. Then keep only the **latest** `N − s − l` of them (enough games for one each).
6. **Played days** = kept free days, then the longest run's days, then the current streak's days (ascending). Each gets one game; the other `N − played` games are split over them by weights `0.5 + rng()` (one draw per day, in order) with `split` (§4.5).

Clamping order, in words: the current streak shrinks first to the window and to the number of games; then the longest run shrinks to what is left of the window after the streak and a gap day, and to the games left; a longest run that would not be longer than the streak is dropped (the dates then show the streak as the longest). With nothing clamped, the dates reproduce `streak` and `longestStreak` exactly; clamped, they reproduce the reported values. Either way `streaksOf(days, lastDay)` (§5) equals `{streak, longestStreak}` of the result.

Example (`last = 2026-10-07`, `streak 3`, `longest 5`, 40 games): streak Oct 5–7, gap Oct 4, longest Sep 29–Oct 3, no free days.

### 4.3 Times

- **The best's index** (chronological): `lo = floor(N × 0.6)`, `bestAt = lo + floor(rng() × (N − lo))`: the last 40% of games (index 0 when `N = 1`). Its time is exactly `B`.
- **Excess** `E = T − N × B ≥ 0` (validation guarantees `A ≥ B`). **Floor** `f = E ≥ N − 1 ? 1 : 0`: when there is room, every other run is at least 1 ms slower, so the best is unique.
- **Weights**, for each other index `i` in order: `pos = N > 1 ? i / (N − 1) : 0`; `z = sqrt(−2 ln(1 − rng())) × cos(2π rng())` (Box–Muller, first draw first); `w_i = (1 + TREND × (1 − pos)) × exp(σ × z)` with `σ = SIGMA` for `z ≥ 0` and `σ = LOW_SIGMA` for `z < 0`. The log-normal factor skews times right, and its wider lower half gives the best some company (the runner-up is typically 5–12% slower, instead of standing 20% clear); the trend factor makes the first game about 1.6× the last in expected excess (the gentle improvement).
- **Times**: `ms_i = B + f + share_i`, with `share = split(E − f × (N − 1), w)`. So `min = B` exactly and `Σ ms = B + (N − 1)(B + f) + E − f(N − 1) = T` exactly. Shares carry arbitrary ms digits (sub-second realism).

### 4.4 Time of day

For each played day `d` with `k` games (the next `k` indexes), local midnight `M = d × 86400000 + tz × 60000`:

- **Session start** (ms after local midnight): `r = rng()`; window `[07:00, 09:30)` when `r < 0.15`, `[12:00, 14:00)` when `r < 0.40`, else `[18:30, 23:00)`; start `= from + floor(rng() × (to − from))`.
- **Chain**: the first game ends at `start + ms`; each next game starts `4,000 + floor(rng() × 41,000)` ms after the previous finish (4–45 s for a new tree) and ends `ms` later.
- **Limit**: `min(86400000 − 1, now − 1000 − M)`: the day's end, or a second ago on today.
- **Clamp**: if the last finish passes the limit, the whole session shifts earlier by the overrun; then each finish is `max(shifted, j)` for the day's `j`-th game (0-based). Finishes therefore stay inside the local day, strictly increase, and never pass `now − 1000`. A session longer than the time available (thousands of slow games in one day) bunches up 1 ms apart from midnight: valid, just not pretty, and out of reach of real devices.
- `finishedAt = M + finish`; the row's `started_at = finishedAt − ms` (it may fall the evening before).

### 4.5 `split(total, weights)`

Whole, non-negative parts in proportion to positive `weights`, summing to `total` exactly, by cumulative rounding: part `i` = `floor(total × W_i / W) − floor(total × W_{i−1} / W)` with `W_i` the running sum, the last cumulative value forced to `total`. Exact for totals up to `2000 × 3,600,000` (all products stay under 2^53).

### 4.6 Ids

`importRunId(importId, i) = 'imp_' + importId + '_' + String(i).padStart(4, '0')`: 25–41 characters, inside the finish route's `[A-Za-z0-9_-]{16,64}`.

### 4.7 Cost

About 1 ms of CPU for 2,000 runs (measured in Node), plus about 0.5 ms to stringify them: inside the Free plan's 10 ms. D1 writes about 8,000 rows for 2,000 runs (the row and three index entries each) of the Free plan's 100,000 a day.

## 5. Day helpers (`worker/lib/days.ts`, pure)

- `DAY_MS = 86_400_000`.
- `dayNumber(text: unknown): number | null`: a real `YYYY-MM-DD` date → `Date.UTC(y, m − 1, d) / DAY_MS`; anything else (including `2026-02-30`, `0099-01-01`) → null.
- `dayText(n)`: back to `YYYY-MM-DD`.
- `isTzOffset(v)`: an integer within ±840.
- `localDayOf(at, tz) = floor((at − tz × 60000) / DAY_MS)`; `localMidnight(day, tz) = day × DAY_MS + tz × 60000`.
- `streaksOf(days, today)`: `days` distinct and ascending → `{streak, longestStreak}` as in §3.2.

## 6. Client

### 6.1 Admin: "Import this device's history" (`/admin`)

A card below the upload queue on the editor screen (`src/admin/history-card.ts`, pure helpers in `src/admin/history.ts`), built once and kept across renders.

- **Defaults** from `loadStats()` (`aglow.stats`): Games solved = `solved`; Best time = `bestSeconds` as `m:ss`; Average time = `round(totalSeconds × 1000 / solved)` ms shown as `m:ss.t` (`formatMs`); Current streak = `max(1, streak)`; Longest streak = `max(1, longestStreak, streak)`; Last solved day = `lastSolvedDay` (a date input, min `2026-09-29`, max local today). No solved game, best or last day → the card says there is nothing to import.
- **Played games**: on build, `GET /api/me/stats` → "Your account already has {played} played games[ and {imported} imported runs]." (`played = solved − imported`) plus the double-counting hint (§7).
- **Average**: if its text is untouched, the exact default ms is sent (so the total matches the device's to the ms); a typed average is parsed (`m:ss` or `m:ss.t`, up to 3 decimals). With 1 game, the average sent is the best.
- **Client validation** mirrors §3.1 (messages in §7) and shows under the form; nothing is sent while it fails.
- **Import mark** (`localStorage['aglow.historyImport'] = {v: 1, importId, done, added}`): the id (16 random bytes, base64url, 22 characters) is created and saved just before the first send; a resend reuses it. Success saves `done: true` and `added`; the card then shows the result, disables the fields and shows the button as "Imported". A later visit reads the mark and stays disabled. (If storage is blocked, the id lives as long as the page; the played/imported line still shows what the account holds.)
- A 401/403 from the import → the page's existing `authLost` (sign-in or Not authorized card). A failed stats call only changes the account line (§7), never the page.
- Same-origin JSON through the admin's `call()`.

### 6.2 Results tag (`src/ui/results.ts`, `src/app.ts`)

- `Results.show` takes the numbers to paint as a `StatsView {solved, averageSeconds, streak}`; `Results.setStats(view)` repaints the three numbers at any time (even while hidden).
- `deviceStatsView(stats)` = device numbers (as today); `accountStatsView(a)` = `{solved, averageSeconds: round(averageMs / 1000) (0 if null), streak}`.
- The App's `syncStats()` runs after a finish is answered, after this run's claim, and whenever the account changes (sign-in, name, sign-out), and after a restored win. Signed out (or no solved tree): the device view. Signed in: `GET /api/me/stats` (today and offset from the browser), then the account view, if no newer call or new tree came first (a sequence number; `beginGame` bumps it and clears the account view). A failed call leaves the device's numbers.
- `presentWin` shows the account view when it has already arrived, else the device view.
- The badge ("New best" / "Best m:ss") is unchanged.

### 6.3 Your games (`src/ui/board-sheets.ts`, `src/ui/accounts.ts`)

- A totals row under the existing best/rank/top-50 row: Solved, Average (`formatMs`), Day streak, Longest; "–" while loading or on error. `listView` gains an optional sixth parameter `stats: Loadable<AccountStats>`.
- `Accounts` loads `api.myStats()` alongside `api.myGames()` whenever Your games opens or reloads; the session changing resets it.
- An imported game's status pill reads "Imported" ("Personal best · Imported" when it is the best).

### 6.4 API client

`api.myStats(now = new Date())` → `GET /api/me/stats?today=<localDay(now)>&tz=<now.getTimezoneOffset()>`, `no-store`. Admin: `api.stats(now)` and `api.importHistory(body)`.

## 7. Copy

| Where | Text |
| --- | --- |
| Admin card title | Import this device's history |
| Admin card lede | Adds this browser's saved games to your account as runs, so they count on the leaderboard and in your stats. Do it once per device. |
| Admin, account line | Your account already has {played} played game(s)[ and {imported} imported run(s)]. This device's total includes any games you played here since accounts launched: subtract them from Games solved so they aren't counted twice. |
| Admin, account line while loading | Checking your account… |
| Admin, account line on failure | Couldn't load your account's games. The import still works. |
| Admin, nothing to import | This browser has no saved games to import. |
| Admin field labels | Games solved · Best time (m:ss) · Average time (m:ss.t) · Current streak (days) · Longest streak (days) · Last solved day |
| Admin button | Import {n} run(s) · Importing… · Imported |
| Admin, done | Imported {added} run(s) from this device. |
| Admin, done but clamped (appended) | The streaks didn't fit between Sep 29 and the last solved day, so they were placed as {streak} and {longest} days. |
| Admin, already imported (server) | This device's history was already imported. |
| Admin, later visit | This device's history was imported[ ({added} run(s))]. |
| Admin client validation | Games solved must be a whole number from 1 to 2,000. · Best time must be m:ss, from 0:05 to 60:00. · Average time must be m:ss.t, at most 60:00. · Average time can't be faster than the best time. · Streaks are whole days from 1, and the longest is at least the current one. · Last solved day must be a date from 2026-09-29 to today. |
| Your games totals labels | Solved · Average · Day streak · Longest |
| Your games status | Imported · Personal best · Imported |
| Server 400 messages | As in §3.1 and §3.2. |

Plurals use the admin's `n run`/`n runs` style with `toLocaleString('en-US')` digits.

## 8. Testing

- **Unit, pure (`tests/unit/worker/days.test.ts`, `tests/unit/worker/history.test.ts`):**
  - `dayNumber`/`dayText` round trip and rejects; `localDayOf`/`localMidnight` across offsets; `streaksOf` cases (alive today, alive yesterday, broken, longest elsewhere, empty).
  - `split`: exact sums, non-negative parts, large totals.
  - `fabricateHistory` over a deterministic sweep of 600 valid inputs (sizes up to 2,000, offsets −840 … 840, streaks that fit and that don't): **min = best exactly**; **Σ ms = solved × averageMs exactly**; when `E ≥ N − 1` the best is unique and sits in the last 40% (otherwise, as with an average equal to the best, it needn't be); the sweep varies `now` too, down to the first valid moment of local midnight; the runner-up is close to the best; `fabricateHistory` throws `RangeError` for input the route would refuse (last day too recent, average under the best, one game with another average); **every local day within [2026-09-29, lastSolvedDay]**, the last day played, every finish ≤ `now − 1000`; finishes strictly increase; **`streaksOf` of the dates equals the reported streaks, which equal the requested ones whenever `clamped` is false** (and the sweep has more than 50 such cases); **deterministic** (deep equality; another `importId` differs).
  - Explicit clamp examples (§4.2), the trend (first third slower than the last third), right skew (mean above median), plausible hours (none before 07:00 in a typical import), ids (stable, match the game id pattern).
  - `parseImportRequest`: a valid body; every row of §3.1's table refused with its message.
- **Unit, browser:** admin helpers (`parseClock`, defaults, request building, the mark); `Results.setStats` and the two views (jsdom); Your games totals and the Imported pill; `api.myStats` URL.
- **Worker integration (`getPlatformProxy` + real local D1):** migration 0002 (`source` default and CHECK); import 401/403/cross-site 403/400; a 12-run import's rows (every column as §2), min and sum; idempotency (same id, other numbers → `already`); the board shows the runs at once after a primed cache; a finish on an imported id changes nothing; a 2,000-run import is one INSERT statement; `GET /api/me/stats` 401/400, zeros, counting rules, tz day boundaries, streak alive/broken; `GET /api/me/games` `imported`.
- **E2E (Playwright on `wrangler dev`, fake Google, nothing routed):**
  - Admin (desktop): seed `aglow.stats` (3 games, best 50:00, average 51:40, streaks 1 and 2, last day today: slow on purpose so the shared e2e board's top runs don't change), sign in as `admin@example.com`, check the prefilled fields, import, see "Imported 3 runs from this device.", confirm through `/api/me/stats` and `/api/me/games`, reload: still imported and disabled.
  - Accounts (desktop and phone): a device with history of its own (7 solved, a 10-day streak ending yesterday) signs in, names, wins: the results tag shows the account's 1 solved and 1-day streak, not the device's 8 and 11; Your games' totals show 1 solved.

## 9. Rollout and undo

- Same process as accounts: this spec, the plan, subagent-driven development with per-task review and a final review; Luke runs `npm run deploy`, which applies migration 0002 remotely (`wrangler d1 migrations apply aglow --remote`) before deploying.
- Then Luke opens `/admin` on each of his devices, checks the numbers (subtracting games played there since 2026-10-08, as the account line suggests), and imports once per device.
- Undo: `npx wrangler d1 execute aglow --remote --command "DELETE FROM games WHERE source = 'import' AND user_id = <id>"` (the id from `SELECT id, name FROM users WHERE email = '<email>'`), then remove `aglow.historyImport` from that browser's localStorage to allow importing again.

## Rulings on ambiguities in the design

1. **Average vs total.** The design says the total should equal "solved × average as closely as integer ms allow". The request carries `averageMs` (integer ms), the server's total is exactly `solved × averageMs`, and the card's untouched average is the device's exact `round(totalSeconds × 1000 / solved)`: the total is within `solved / 2` ms of the device's.
2. **Best exactly `bestSeconds × 1000`.** The device floors times to whole seconds, so the imported best reads `m:ss.0`, as the design requires; the best must be whole seconds (client and server).
3. **"Cap N at 2000"** means refuse: `solved > 2000` is a 400, never silently truncated (a truncated import would break the total).
4. **Streak semantics.** The device shows its stored streak even when stale; the account's `streak` is alive only if the last played day is today or yesterday (the usual rule; the design says "computed … using today"). Imports place the streak ending at `lastSolvedDay`, so the account shows it while it is alive.
5. **Clamping** is spelled out in §4.2 (streak first, then longest, gap day kept, a longest that can't beat the streak dropped) and reported back (`clamped`, with the placed values).
6. **Re-import with other numbers** under the same `importId` adds nothing (`already`), rather than mixing two fabrications.
7. **Played-games count** comes from `GET /api/me/stats` (`solved − imported`) rather than a new endpoint.
8. **Session clock and today.** Imported finishes never pass `now − 1000`, so an import whose last day is today never dates a run in the future.
9. **Your games stats** are a second totals row (four cells) rather than replacing best/rank/top-50.
10. **The results badge** stays device-based; only Solved, Average and Day streak switch to the account.
11. **One offset** per import (no DST): the window is about ten days, all inside PDT for Luke.
12. **Unnamed admin:** imported runs are ranked but, like any unnamed account's runs, join the board only once a name is picked.
