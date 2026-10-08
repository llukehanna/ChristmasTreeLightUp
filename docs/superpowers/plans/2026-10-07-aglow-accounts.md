# Aglow accounts and leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players sign in with Google, pick a display name and post server-verified times to one all-time leaderboard of runs; playing never needs an account, and the radio admin moves from a password to Luke's Google account.

**Architecture:**

- **The Worker `aglow` stays on `/api/*` only** (`run_worker_first`). It gains a D1 database `aglow` (binding `DB`), Mapped-style regex routes, a same-origin + JSON check on every write, and route groups `/api/auth/*`, `/api/me*`, `/api/games*` and `/api/board`.
- **The server picks the seed and stamps start and finish.** The browser builds the tree with `Board.random(GRID, mulberry32(seed))` and records a tap log; the Worker imports the pure game core (`src/core/*`) and replays the log through the real `Board` (in a new headless mode that is fast enough for the Free plan's 10 ms CPU budget), then anchors it to its own clock.
- **The browser** gets a small API client, a session store, claim storage and a v2 save; the UI is vanilla DOM in the radio panel's dark glass (HUD chip + menu, sheets, cards), plus a rosette and ribbon on the results tag.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node, jsdom where noted), Playwright 1.63, Wrangler 4.147 (Workers, static assets, R2, D1, `getPlatformProxy` for a real local D1 in Node tests), Google OpenID Connect (authorization code + PKCE, server-side).

**Spec:** `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md` (binding; read it alongside this plan). Base spec: `docs/superpowers/specs/2026-09-29-aglow-design.md`. Reference implementation (read-only): `/Users/luke/Claude Projects/Mapped` (`worker/*.ts`, `tests/worker/*`, `e2e/*`).

## Global Constraints

- **Cookies:** session `__Host-aglow_session` (`Path=/; HttpOnly; Secure; SameSite=Lax`, `Max-Age=31536000`, 365 days, renewed by `GET /api/me` when under 182 days remain); sign-in flow `__Host-aglow_oauth` holding `state.verifier.return` for 600 s. D1 stores only `HMAC(AUTH_SECRET, 'session:' + token)`. Fake sign-in cookie: `aglow_fake_as`.
- **Google:** OpenID Connect authorization code + PKCE (S256), scopes `openid email`, `prompt=select_account`. The callback checks state, then `iss`, `aud`, `exp` and `email_verified` on the `id_token` from Google's token endpoint. Any callback failure redirects to `<return>?auth=failed`; the game toasts "Sign-in didn't finish. Try again."
- **Return path:** sanitised to a same-site path; never `//…` or `/\…`.
- **`AUTH_MODE=fake`** (sign in as `?as=<email>` or the `aglow_fake_as` cookie) works on localhost only; on any other host every request answers 500 `misconfigured`.
- **Start:** `POST /api/games` with a **1.5 s** timeout (`START_TIMEOUT_MS = 1500`). Failure, timeout or 429 → a local `Math.random` tree, unranked "offline". Play is never blocked.
- **Generator:** `Board.random(GRID, mulberry32(seed))`, call order solution → scramble → colors. Any change to that order, the mask, a generator or the PRNG bumps `GEN_VERSION` (now `1`), and the Worker keeps replay support for every version still stored.
- **Log:** entries `{t, a}`; `t` = integer ms since the game's local start (`Date.now() − startEpoch`), `a` = tile index (accepted taps only), `'p'` pause, `'r'` resume. Max **5000** entries, `t` never decreasing and at most 1 day, tile indices that are tiles of `GRID`, `p`/`r` strictly alternating.
- **Judge:** `CLOCK_TOLERANCE_MS = 3000`; `ms = span − paused − REVEAL_MS` (`REVEAL_MS = 900`); pause cap **10 min total and 20 pauses** (`paused`); `too_fast` when `ms < 5000` or **more than 10%** of consecutive tap gaps are under **40 ms**; `anonymous` when signed out; reason order `clock`, `paused`, `too_fast`, `anonymous`. A log that doesn't replay (or claims more time than the server saw by over 3000 ms) → **422 `unverified` and the game row is deleted**.
- **Limits:** 200 starts per IP hash per hour (429); claims **8 per request**; the browser keeps claims **90 days, at most 500**; finish retried once after **800 ms**; leaderboard **top 50 runs**; `GET /api/board` sends `Cache-Control: private, max-age=15`; housekeeping deletes up to 50 stale rows per start (unfinished > 1 day, unclaimed finished > 90 days).
- **Ranking:** time only (server-computed active ms), ties to the earlier finish; rank = 1 + board runs with lower `ms`, or equal `ms` and earlier `finished_at`. Only runs by **named** users are on the board or counted. Unlimited runs per player.
- **Names:** 3–20 letters, digits, spaces, `-` or `_`, trimmed, no double spaces (`NAME_RULE = '3–20 letters, numbers, spaces, - or _'`), unique case-insensitively, chosen once. Reserved (compared lower-cased with spaces, `-` and `_` removed): `admin`, `administrator`, `aglow`, `santa`, `santaclaus`, `moderator`, `staff`, `support`, `official`, `system`. Google names and emails are never shown publicly.
- **Admin:** `/admin` and `/api/admin/*` need a session whose verified email is in `ADMIN_EMAILS` (comma-separated, compared lower-cased): 401 signed out, 403 not the admin. `ADMIN_PASSWORD`, `SESSION_SECRET`, the `aglow_admin` cookie, `worker/lib/session.ts`, `LOGIN_LIMITER`, `POST /api/admin/login`, `POST /api/admin/logout` and the password screen are removed.
- **Secrets / vars:** secrets `AUTH_SECRET` (256 random bits, piped so no one sees it) and `GOOGLE_CLIENT_SECRET` (Luke pastes it); vars `GOOGLE_CLIENT_ID`, `AUTH_MODE` (`google`; `fake` on localhost only), `ADMIN_EMAILS`. **Never print, log, echo, commit or paste a secret value.** No task runs `wrangler secret`, `wrangler deploy`, `--remote` or anything that touches Luke's Cloudflare or Google accounts: those are in the Rollout note for the controller and Luke.
- **Errors:** new routes answer `{error, message}` JSON with `Cache-Control: no-store`; unexpected failures answer 503 and are logged as route, method and error class only (never a message, body, cookie or secret).
- **Writes:** every non-GET `/api/*` request needs `Origin` equal to the request's own origin and a JSON `Content-Type`; `PUT /api/admin/upload` (raw audio) is the only exception to the JSON rule.
- **The Worker never imports UI or render code:** only `src/core/*`, `src/api/types.ts`, `src/api/names.ts`, `src/radio/schema.ts` and `src/radio/ids.ts`. `worker/lib` and `worker/routes` stay free of `@cloudflare/workers-types` (tests type-check them under Node); only `worker/index.ts` knows the runtime types. Worker files import with `.js` suffixes; `src` files import extensionless.
- **Free plans only:** Workers Free (10 ms CPU per request, 100k requests a day), D1 Free. No paid features.
- **TypeScript strict, no `any`** (use `unknown` and narrow). Follow existing patterns: `readJSON`/`writeJSON` for storage, `el()` for required DOM.
- **No real music anywhere:** never commit or read `Music MP3s/`; tests use fixtures.
- **UI copy** exactly as written in this plan.
- **Commits** end with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- **Verification commands:** `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (from Task 7 on, Playwright runs the real Worker with `wrangler dev`).

## File map

| File | Responsibility |
| --- | --- |
| `src/core/board.ts` | `Board` gains a headless mode (no per-turn lighting; a matched-link count gates the win check) |
| `src/core/clock.ts` | `REVEAL_MS` moves here from `app.ts` |
| `src/core/seeded.ts` | `GEN_VERSION`, generator table, `seededBoard(seed, genVersion, headless)` |
| `src/core/log.ts` | Log types, `parseLog`, the browser's `GameLog` recorder |
| `src/core/replay.ts` | `replay(board, log)`: solve time, pause totals, tap times (pure) |
| `src/core/judge.ts` | Anti-cheat constants, `UnrankedReason`, `judge()` (pure) |
| `src/api/types.ts` | JSON shapes shared by Worker and browser |
| `src/api/names.ts` | Display-name rule and reserved names (shared) |
| `src/api/client.ts` | Browser API client, `finishWithRetry`, 401 hook |
| `src/api/claims.ts` | Signed-out claim storage (90 days, 500) |
| `src/api/session.ts` | Signed-in user store |
| `src/api/outcome.ts` | `RunOutcome`: what became of the run on the results tag |
| `src/store/progress.ts` | `aglow.game` v2 (online run, log, won run), return marker |
| `src/app.ts` | Online start, log recording, finish, claims, won-run restore |
| `src/ui/account.css` | Chip, menu, sheets, cards (dark glass), results rosette and ribbon |
| `src/ui/icons.ts`, `src/ui/format.ts` | Icons; `m:ss.t`, dates, labels, escaping |
| `src/ui/sheet.ts` | Modal glass sheet: scrim, focus trap, Escape |
| `src/ui/account-menu.ts` | HUD chip and its menu |
| `src/ui/account-cards.ts` | Sign-in, name and delete cards |
| `src/ui/board-sheets.ts` | Leaderboard and Your games views |
| `src/ui/accounts.ts` | Wires session, chip, sheets and cards |
| `src/ui/ribbon.ts` | Results tag ranking (rosette, line, save ribbon) |
| `privacy.html` | The privacy page (`/privacy`) |
| `migrations/0001_init.sql` | D1 schema |
| `worker/lib/db.ts` | Structural D1 types |
| `worker/lib/crypto.ts` | Tokens, seeds, HMAC, SHA-256 |
| `worker/lib/http.ts` | `json`, `HttpError`, write check, cookies, body reading |
| `worker/lib/users.ts` | Sessions, `currentUser`, `requireUser`, `requireAdmin`, `publicUser` |
| `worker/lib/ranks.ts` | Board total, rank, best run, top 50 |
| `worker/router.ts` | Regex route table, fake-mode guard, error mapping |
| `worker/routes/auth.ts` | Google start/callback (+ fake), name check/set, sign-out |
| `worker/routes/me.ts` | `GET/DELETE /api/me`, `GET /api/me/games` |
| `worker/routes/games.ts` | Start, finish, claim |
| `worker/routes/board.ts` | `GET /api/board` |
| `tests/worker/harness.ts` | Real local D1 via `getPlatformProxy`, fake sign-in helpers |
| `scripts/deploy-check.ts` | Refuses a deploy with placeholder config |

---
## Task order

1. Seeded game core, game log, headless replay and judge (pure; shared with the Worker)
2. D1 schema, Worker router upgrade and the integration harness
3. Google sign-in, sessions, names, sign-out and account delete
4. Games: start, finish and claim
5. Leaderboard and Your games queries
6. The radio admin moves to Luke's Google account
7. Browser game flow (online start, tap log, finish, claims); e2e on the real Worker
8. Account UI: HUD chip and menu, glass sheets, sign-in, name and delete cards
9. Results tag ranking (3B) and the Save-to-leaderboard round trip
10. Privacy page and the remaining end-to-end account flows (desktop and phone)
11. Deploy guard, production config and docs; then the Rollout note (controller and Luke only)

---

### Task 1: Seeded game core, game log, headless replay and judge

Pure code the Worker and the browser share. `Board` gets a headless mode: replaying a 5,000-entry log through the ordinary board costs about 50 ms (a full lighting BFS per turn), far over the Free plan's 10 ms; headless keeps a count of matched links and only lights the tree when it could be whole, which replays the same log in about 1.5 ms with identical turns, queues and win.

**Files:**
- Modify: `src/core/board.ts` (whole file below), `src/core/clock.ts`, `src/app.ts:24` (REVEAL_MS moves out)
- Create: `src/core/seeded.ts`, `src/core/log.ts`, `src/core/replay.ts`, `src/core/judge.ts`
- Test: `tests/unit/core/solver.ts` (helper), `tests/unit/core/headless.test.ts`, `tests/unit/core/seeded.test.ts`, `tests/unit/core/log.test.ts`, `tests/unit/core/replay.test.ts`, `tests/unit/core/judge.test.ts`

**Interfaces:**
- Consumes: existing `Board`, `GRID`, `mulberry32`, `rotCW`, `ROTATE_MS`.
- Produces:
  - `src/core/clock.ts`: `export const REVEAL_MS = 900`.
  - `src/core/board.ts`: `new Board(grid, state, rotateMs = ROTATE_MS, headless = false)`, `Board.random(grid, rng, headless = false)`, `readonly headless: boolean`. Behaviour of a non-headless board is unchanged.
  - `src/core/seeded.ts`: `GEN_VERSION = 1`; `isSeed(v: unknown): v is number`; `seededBoard(seed: number, genVersion: number, headless = false): Board | null`.
  - `src/core/log.ts`: `type LogAction = number | 'p' | 'r'`; `interface LogEntry { t: number; a: LogAction }`; `MAX_LOG_ENTRIES = 5000`; `MAX_LOG_MS = 86_400_000`; `parseLog(value: unknown, grid: Grid): LogEntry[] | null`; `endsPaused(log): boolean`; `class GameLog { readonly entries: LogEntry[]; get paused(): boolean; tap(t, tile): void; pause(t): void; resume(t): void }`.
  - `src/core/replay.ts`: `interface Replay { solvedAt: number; pausedMs: number; pauses: number; tapTimes: number[] }`; `replay(board: Board, log: readonly LogEntry[]): Replay | null`.
  - `src/core/judge.ts`: `CLOCK_TOLERANCE_MS = 3000`, `MAX_PAUSED_MS = 600_000`, `MAX_PAUSES = 20`, `MIN_RANKED_MS = 5000`, `FAST_GAP_MS = 40`, `MAX_FAST_GAP_SHARE = 0.1`; `type UnrankedReason = 'anonymous' | 'paused' | 'too_fast' | 'clock'`; `interface Verdict { ms: number; pausedMs: number; pauses: number; reason: Exclude<UnrankedReason, 'anonymous'> | null }`; `judge(input: { seed: number; genVersion: number; log: readonly LogEntry[]; serverElapsedMs: number }): Verdict | null`.
  - Test helpers `tests/unit/core/solver.ts`: `solvingTaps(board, start = 1000, gap = 50): LogEntry[]`, `withPause(log, k, ms): LogEntry[]` (Tasks 4 and 5 import them).

- [ ] **Step 1: Write the test helper**

`tests/unit/core/solver.ts`:

```ts
import type { Board } from '../../../src/core/board';
import { rotCW } from '../../../src/core/dirs';
import type { LogEntry } from '../../../src/core/log';

/** A scripted solver: taps that turn every tile of a settled board to its solution, in grid order, `gap` ms apart from `start`. */
export function solvingTaps(board: Board, start = 1000, gap = 50): LogEntry[] {
  if (board.rotating.size) throw new Error('solvingTaps needs a settled board');
  const out: LogEntry[] = [];
  let t = start;
  for (const i of board.grid.ids) {
    let b = board.bits[i];
    for (let k = 0; k < 4 && b !== board.solution[i]; k++) {
      out.push({ t, a: i });
      t += gap;
      b = rotCW(b);
    }
  }
  return out;
}

/** `log` with a pause of `ms` just after entry k − 1: every entry from k on moves ms + 1 later. */
export function withPause(log: readonly LogEntry[], k: number, ms: number): LogEntry[] {
  const at = log[k - 1].t + 1;
  return [...log.slice(0, k), { t: at, a: 'p' }, { t: at + ms, a: 'r' }, ...log.slice(k).map((e) => ({ t: e.t + ms + 1, a: e.a }))];
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/core/seeded.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { GEN_VERSION, isSeed, seededBoard } from '../../../src/core/seeded';

/** FNV-1a of a board's solution, bits and colors: a fingerprint of what a seed generates. */
function fingerprint(b: Board): string {
  const s = JSON.stringify([b.solution, b.bits, b.colors]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('seeded boards', () => {
  it('version 1 is Board.random(GRID, mulberry32(seed)): solution, then scramble, then colors', () => {
    for (const seed of [1, 42, 0xffffffff]) {
      const a = seededBoard(seed, 1);
      const b = Board.random(GRID, mulberry32(seed));
      expect(a?.solution).toEqual(b.solution);
      expect(a?.bits).toEqual(b.bits);
      expect(a?.colors).toEqual(b.colors);
    }
  });

  it('is pinned: a fingerprint changes only with a GEN_VERSION bump (and the old generator stays for stored games)', () => {
    expect(GEN_VERSION).toBe(1);
    expect(fingerprint(seededBoard(1, 1) as Board)).toBe('dc4eccce');
    expect(fingerprint(seededBoard(42, 1) as Board)).toBe('515b3974');
    expect(fingerprint(seededBoard(0xffffffff, 1) as Board)).toBe('b60cd6a2');
  });

  it('is deterministic per seed, and different seeds give different trees', () => {
    expect(seededBoard(7, 1)?.bits).toEqual(seededBoard(7, 1)?.bits);
    expect(seededBoard(7, 1)?.solution).not.toEqual(seededBoard(8, 1)?.solution);
  });

  it('knows no other versions and refuses anything that is not a uint32 seed', () => {
    for (const v of [0, 2, 99, Number.NaN]) expect(seededBoard(1, v)).toBeNull();
    for (const s of [-1, 1.5, 2 ** 32, Number.NaN]) expect(seededBoard(s, 1)).toBeNull();
    expect(isSeed(0)).toBe(true);
    expect(isSeed(0xffffffff)).toBe(true);
    expect(isSeed('1')).toBe(false);
  });

  it('makes a headless board on request', () => {
    expect(seededBoard(5, 1, true)?.headless).toBe(true);
    expect(seededBoard(5, 1)?.headless).toBe(false);
  });
});
```

`tests/unit/core/headless.test.ts`:

```ts
import { expect, it } from 'vitest';
import { ROTATE_MS } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps } from './solver';

it('a headless board turns, queues, drops taps and wins exactly like the real one', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 7);
    const fast = seededBoard(seed, GEN_VERSION, true);
    const real = seededBoard(seed, GEN_VERSION);
    if (!fast || !real) throw new Error('no board');
    let t = 0;
    for (let k = 0; k < 2000; k++) {
      t += Math.floor(rng() * 90);
      fast.tick(t);
      real.tick(t);
      const i = GRID.ids[Math.floor(rng() * GRID.ids.length)];
      expect(fast.tap(i, t).length > 0).toBe(real.tap(i, t).length > 0);
      expect(fast.bits).toEqual(real.bits);
      expect(fast.won).toBe(real.won);
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      fast.tick(t);
      real.tick(t);
      expect(fast.bits).toEqual(real.bits);
    }
    if (real.won) continue;
    for (const e of solvingTaps(real, t + 500, 50)) {
      if (typeof e.a !== 'number') continue;
      fast.tick(e.t);
      real.tick(e.t);
      fast.tap(e.a, e.t);
      real.tap(e.a, e.t);
      t = e.t;
    }
    while (fast.rotating.size || real.rotating.size) {
      t += ROTATE_MS;
      fast.tick(t);
      real.tick(t);
      expect(fast.won).toBe(real.won);
    }
    expect(fast.won).toBe(true);
    expect(real.won).toBe(true);
  }
});

it('a headless board only lights the tree to check for the win', () => {
  const b = seededBoard(3, GEN_VERSION, true);
  if (!b) throw new Error('no board');
  b.tap(GRID.ids[10], 0);
  expect(b.lighting.count).toBe(0); // dark while anything turns
  expect(b.tick(0)).toEqual([]);
});
```

`tests/unit/core/log.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { endsPaused, GameLog, MAX_LOG_ENTRIES, MAX_LOG_MS, parseLog } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';

describe('parseLog', () => {
  const tile = GRID.ids[0];
  it('accepts a well-formed log', () => {
    const log = [{ t: 0, a: tile }, { t: 5, a: 'p' }, { t: 9, a: 'r' }, { t: 9, a: GRID.ids[1] }];
    expect(parseLog(log, GRID)).toEqual(log);
    expect(parseLog([], GRID)).toEqual([]);
    expect(parseLog(Array.from({ length: MAX_LOG_ENTRIES }, () => ({ t: 0, a: tile })), GRID)).not.toBeNull();
  });

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      {},
      'x',
      [null],
      [{ t: 0 }],
      [{ t: 0, a: 'x' }],
      [{ t: -1, a: tile }],
      [{ t: 1.5, a: tile }],
      [{ t: '1', a: tile }],
      [{ t: 5, a: tile }, { t: 4, a: tile }], // time going backwards
      [{ t: MAX_LOG_MS + 1, a: tile }], // more than a day
      [{ t: 0, a: 0 }], // the top-left corner is not a tile
      [{ t: 0, a: GRID.cells.length }],
      [{ t: 0, a: 1.5 }],
      [{ t: 0, a: -1 }],
      [{ t: 0, a: 'r' }], // a resume without a pause
      [{ t: 0, a: 'p' }, { t: 1, a: 'p' }], // two pauses in a row
    ];
    for (const v of bad) expect(parseLog(v, GRID), JSON.stringify(v)).toBeNull();
    expect(parseLog(Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => ({ t: 0, a: tile })), GRID)).toBeNull();
  });
});

describe('GameLog', () => {
  it('records taps, pauses and resumes: rounded times that never go backwards, no taps while paused', () => {
    const log = new GameLog();
    log.tap(10.4, 7);
    log.pause(20.6);
    log.tap(25, 8);
    log.pause(26);
    log.resume(30);
    log.resume(31);
    log.tap(29, 9);
    expect(log.entries).toEqual([{ t: 10, a: 7 }, { t: 21, a: 'p' }, { t: 30, a: 'r' }, { t: 30, a: 9 }]);
  });

  it('continues a saved log, paused if it ended paused, without changing the saved array', () => {
    const saved = [{ t: 5, a: 7 }, { t: 9, a: 'p' as const }];
    const log = new GameLog(saved);
    expect(log.paused).toBe(true);
    log.tap(12, 8);
    log.resume(15);
    expect(log.entries).toEqual([{ t: 5, a: 7 }, { t: 9, a: 'p' }, { t: 15, a: 'r' }]);
    expect(saved).toHaveLength(2);
    expect(endsPaused([{ t: 1, a: 'p' }, { t: 2, a: 'r' }, { t: 3, a: 7 }])).toBe(false);
    expect(endsPaused([])).toBe(false);
  });

  it('keeps nothing past MAX_LOG_ENTRIES', () => {
    const log = new GameLog();
    for (let k = 0; k < MAX_LOG_ENTRIES + 3; k++) log.tap(k, 7);
    expect(log.entries).toHaveLength(MAX_LOG_ENTRIES);
  });
});
```

`tests/unit/core/replay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROTATE_MS } from '../../../src/core/board';
import type { LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps, withPause } from './solver';

const honest = (seed: number, start = 1000, gap = 50): LogEntry[] => {
  const b = seededBoard(seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, start, gap);
};
const run = (seed: number, log: LogEntry[]) => {
  const b = seededBoard(seed, GEN_VERSION, true);
  if (!b) throw new Error('no board');
  return replay(b, log);
};

describe('replay', () => {
  it('replays the scripted solver on 30 seeds: solved when the last turn settles', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const log = honest(seed);
      const r = run(seed, log);
      expect(r, `seed ${seed}`).not.toBeNull();
      const last = log[log.length - 1].t;
      expect(r?.solvedAt).toBeGreaterThan(last);
      expect(r?.solvedAt).toBeLessThanOrEqual(last + 4 * ROTATE_MS);
      expect(r?.tapTimes).toEqual(log.map((e) => e.t));
      expect(r?.pausedMs).toBe(0);
      expect(r?.pauses).toBe(0);
    }
  });

  it('seed 1: 121 taps 50 ms apart from t = 1000 settle at 7260', () => {
    expect(honest(1)).toHaveLength(121);
    expect(run(1, honest(1))?.solvedAt).toBe(7260);
  });

  it('refuses a log that never solves the tree', () => {
    expect(run(1, honest(1).slice(0, -1))).toBeNull();
    expect(run(1, [])).toBeNull();
  });

  it('refuses a tap after the solve', () => {
    const log = honest(1);
    expect(run(1, [...log, { t: log[log.length - 1].t + 2000, a: GRID.ids[0] }])).toBeNull();
  });

  it('refuses a tap inside a pause', () => {
    const log = honest(1);
    const bad: LogEntry[] = [...log.slice(0, 5), { t: log[4].t + 1, a: 'p' }, log[5], { t: log[5].t + 10, a: 'r' }, ...log.slice(6).map((e) => ({ t: e.t + 10, a: e.a }))];
    expect(run(1, bad)).toBeNull();
  });

  it('refuses a tap the board would have dropped (its turn queue was full)', () => {
    const tile = GRID.ids[3];
    expect(run(1, [0, 10, 20, 30, 40].map((t) => ({ t: 2000 + t, a: tile })))).toBeNull();
  });

  it('totals the pauses before the solve', () => {
    expect(run(1, withPause(honest(1), 10, 5000))).toMatchObject({ pausedMs: 5000, pauses: 1 });
  });

  it('counts a pause still open at the solve only up to the solve, and ignores pauses after it', () => {
    const log = honest(1);
    expect(run(1, [...log, { t: 7001, a: 'p' }])).toMatchObject({ solvedAt: 7260, pausedMs: 259, pauses: 1 });
    expect(run(1, [...log, { t: 9000, a: 'p' }, { t: 9500, a: 'r' }])).toMatchObject({ solvedAt: 7260, pausedMs: 0, pauses: 0 });
  });
});
```

`tests/unit/core/judge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REVEAL_MS } from '../../../src/core/clock';
import { CLOCK_TOLERANCE_MS, FAST_GAP_MS, judge, MAX_PAUSED_MS, MAX_PAUSES, MIN_RANKED_MS } from '../../../src/core/judge';
import { MAX_LOG_ENTRIES, type LogEntry } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { solvingTaps, withPause } from './solver';

const SEED = 1;
const honest = (start = 1000, gap = 50, seed = SEED): LogEntry[] => {
  const b = seededBoard(seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, start, gap);
};
const solvedAt = (log: LogEntry[], seed = SEED): number => {
  const b = seededBoard(seed, GEN_VERSION, true);
  const r = b && replay(b, log);
  if (!r) throw new Error('does not replay');
  return r.solvedAt;
};
/** Judged as if the server saw `extra` ms more than the log spans (an honest client: two network legs). */
const judged = (log: LogEntry[], extra = 300) => judge({ seed: SEED, genVersion: GEN_VERSION, log, serverElapsedMs: solvedAt(log) + extra });
/** The same taps, re-timed: gap(k) ms before tap k. */
const retimed = (log: LogEntry[], gap: (k: number) => number): LogEntry[] => {
  let t = log[0].t;
  return log.map((e, k) => {
    if (k > 0) t += gap(k);
    return { t, a: e.a };
  });
};
const pausedTimes = (n: number): LogEntry[] => {
  let log = honest();
  for (let k = 0; k < n; k++) log = withPause(log, 5 + 3 * k, 100);
  return log;
};

describe('judge', () => {
  it('ranks an honest run: ms is the span minus pauses minus the reveal', () => {
    expect(judged(honest())).toEqual({ ms: 7260 - REVEAL_MS, pausedMs: 0, pauses: 0, reason: null });
    const paused = withPause(honest(), 10, 5000);
    expect(judged(paused)).toEqual({ ms: solvedAt(paused) - 5000 - REVEAL_MS, pausedMs: 5000, pauses: 1, reason: null });
  });

  it('clock: the server saw more than 3 s that the log does not account for', () => {
    expect(judged(honest(), CLOCK_TOLERANCE_MS)?.reason).toBeNull();
    expect(judged(honest(), CLOCK_TOLERANCE_MS + 1)?.reason).toBe('clock');
  });

  it('refuses (null) a log that claims more than 3 s more than the server saw', () => {
    expect(judged(honest(), -CLOCK_TOLERANCE_MS)?.reason).toBeNull();
    expect(judged(honest(), -CLOCK_TOLERANCE_MS - 1)).toBeNull();
  });

  it('paused: more than 10 minutes of pauses, or more than 20 pauses', () => {
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS))?.reason).toBeNull();
    expect(judged(withPause(honest(), 10, MAX_PAUSED_MS + 1))?.reason).toBe('paused');
    expect(judged(pausedTimes(MAX_PAUSES))?.reason).toBeNull();
    expect(judged(pausedTimes(MAX_PAUSES + 1))?.reason).toBe('paused');
  });

  it('too_fast: under 5 s of ranked time', () => {
    const quick = honest(0, 41); // 121 taps: about 4.3 s once the reveal is taken off
    expect(judged(quick)?.ms).toBeLessThan(MIN_RANKED_MS);
    expect(judged(quick)?.reason).toBe('too_fast');
  });

  it('too_fast: more than 10% of the gaps between taps under 40 ms', () => {
    const log = honest(); // 121 taps, 120 gaps
    expect(log).toHaveLength(121);
    expect(judged(retimed(log, (k) => (k <= 12 ? FAST_GAP_MS - 1 : 50)))?.reason).toBeNull(); // 12 of 120 is 10%
    expect(judged(retimed(log, (k) => (k <= 13 ? FAST_GAP_MS - 1 : 50)))?.reason).toBe('too_fast');
    expect(judged(retimed(log, () => 20).map((e) => ({ t: e.t + 10_000, a: e.a })))?.reason).toBe('too_fast');
  });

  it('gives one reason, in order: clock, then paused, then too_fast', () => {
    const pausedAndFast = withPause(honest(0, 41), 10, MAX_PAUSED_MS + 1);
    expect(judged(pausedAndFast)?.reason).toBe('paused');
    expect(judged(pausedAndFast, CLOCK_TOLERANCE_MS + 1)?.reason).toBe('clock');
  });

  it('refuses a log that does not replay, another seed, or an unknown generator version', () => {
    expect(judge({ seed: SEED, genVersion: GEN_VERSION, log: honest().slice(0, -1), serverElapsedMs: 10_000 })).toBeNull();
    expect(judge({ seed: SEED + 1, genVersion: GEN_VERSION, log: honest(), serverElapsedMs: 7600 })).toBeNull();
    expect(judge({ seed: SEED, genVersion: 99, log: honest(), serverElapsedMs: 7600 })).toBeNull();
  });

  it('CPU guard: the longest legal log replays well inside the Workers Free 10 ms budget', () => {
    const seed = 77;
    const solve = honest(0, 50, seed);
    // Whole turns of one tile (four taps 130 ms apart change nothing), then the real solve: 5,000 entries at most.
    const tile = GRID.ids[5];
    const pad: LogEntry[] = [];
    for (let t = 1000; pad.length + solve.length + 4 <= MAX_LOG_ENTRIES; t += 130) pad.push({ t, a: tile });
    pad.length -= pad.length % 4;
    const offset = pad[pad.length - 1].t + 200;
    const log = [...pad, ...solve.map((e) => ({ t: e.t + offset, a: e.a }))];
    expect(log.length).toBeGreaterThan(MAX_LOG_ENTRIES - 8);
    const serverElapsedMs = solvedAt(log, seed) + 300;
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const s = performance.now();
      expect(judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs })?.reason).toBeNull();
      times.push(performance.now() - s);
    }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(5); // the median; about 1.5 ms on Luke's Mac
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/core`
Expected: FAIL: cannot resolve `src/core/seeded`, `src/core/log`, `src/core/replay`, `src/core/judge`, and `REVEAL_MS` is not exported from `src/core/clock`.

- [ ] **Step 4: Add the headless mode to `Board`**

Replace `src/core/board.ts` with (only the `Board` class changes; `computeLighting` and the types are unchanged):

```ts
import { D, DIRS, OPPOSITE, rotCW } from './dirs';
import { generateSolution } from './generate';
import { neighbor, type Grid } from './mask';
import type { Rng } from './rng';
import { randomColors, scramble } from './scramble';

export interface Lighting {
  lit: boolean[];
  /** BFS parent of each lit tile (-1 for the root / unlit). */
  parent: number[];
  /** Direction (bit) through which each lit tile receives power. */
  entry: number[];
  /** Lit tiles in BFS order. */
  order: number[];
  children: number[][];
  count: number;
}

/** Faithful port of the original Game.og/Ke: BFS from the root, neighbours in U,D,L,R order. */
export function computeLighting(g: Grid, bits: readonly number[]): Lighting {
  const n = g.w * g.h;
  const lit = new Array<boolean>(n).fill(false);
  const parent = new Array<number>(n).fill(-1);
  const entry = new Array<number>(n).fill(0);
  const children: number[][] = Array.from({ length: n }, () => []);
  const order: number[] = [];
  if (bits[g.root] & D) {
    lit[g.root] = true;
    entry[g.root] = D;
    order.push(g.root);
  }
  for (let h = 0; h < order.length; h++) {
    const i = order[h];
    for (const d of DIRS) {
      if (!(bits[i] & d)) continue;
      const j = neighbor(g, i, d);
      if (j < 0 || lit[j]) continue;
      const o = OPPOSITE[d];
      if (bits[j] & o) {
        lit[j] = true;
        parent[j] = i;
        entry[j] = o;
        children[i].push(j);
        order.push(j);
      }
    }
  }
  return { lit, parent, entry, order, children, count: order.length };
}

/** Original: 200ms linear. Shortened for a snappier feel (spec §2.7). */
export const ROTATE_MS = 120;
/** Rapid taps on a turning tile are buffered into one fluid spin (spec §2.7). */
export const MAX_QUEUE = 3;

export interface Rotation {
  from: number;
  to: number;
  t0: number;
  queued: number;
}

export interface BoardState {
  solution: number[];
  bits: number[];
  colors: number[];
}

export type BoardEvent =
  | { type: 'rotateStarted'; tile: number }
  | { type: 'tapBuffered'; tile: number }
  | { type: 'rotateFinished'; tile: number }
  | { type: 'lightingChanged'; newlyLit: number[]; lost: number[] }
  | { type: 'won' };

export class Board {
  readonly grid: Grid;
  readonly solution: readonly number[];
  readonly colors: readonly number[];
  readonly rotateMs: number;
  /**
   * The Worker's replay board (spec 2026-10-07 §5.3): turns, queues and the win are exactly the real board's, but the
   * tree is only lit (a BFS) when it could be whole: nothing turning, the root wired to the source, and at least as
   * many matched links as a spanning tree needs. Between those checks `lighting` stays dark and no lighting events fire.
   */
  readonly headless: boolean;
  bits: number[];
  lighting: Lighting;
  readonly rotating = new Map<number, Rotation>();
  won = false;
  /** Headless only: adjacent tile pairs whose links meet. */
  private matched = 0;
  private dark: Lighting | null = null;

  constructor(grid: Grid, state: BoardState, rotateMs = ROTATE_MS, headless = false) {
    this.grid = grid;
    this.solution = [...state.solution];
    this.colors = [...state.colors];
    this.bits = [...state.bits];
    this.rotateMs = rotateMs;
    this.headless = headless;
    this.lighting = computeLighting(grid, this.bits);
    if (headless) this.recount();
  }

  static random(grid: Grid, rng: Rng, headless = false): Board {
    const solution = generateSolution(grid, rng);
    return new Board(grid, { solution, bits: scramble(grid, solution, rng), colors: randomColors(grid, rng) }, ROTATE_MS, headless);
  }

  /** A click/tap on tile `i`. Mid-turn taps are buffered; taps after the win are ignored. */
  tap(i: number, now: number): BoardEvent[] {
    if (this.won || !this.grid.cells[i]) return [];
    const r = this.rotating.get(i);
    if (r) {
      if (r.queued >= MAX_QUEUE) return []; // dropped: no click or buzz for a tap that does nothing
      r.queued++;
      return [{ type: 'tapBuffered', tile: i }];
    }
    const from = this.bits[i];
    this.rotating.set(i, { from, to: rotCW(from), t0: now, queued: 0 });
    this.setBits(i, 0); // original: Lb = 0 while turning, so the tile and everything downstream go dark
    return [{ type: 'rotateStarted', tile: i }, ...this.relight()];
  }

  /** Advance time: finish turns whose duration has elapsed and check for the win. */
  tick(now: number): BoardEvent[] {
    const events: BoardEvent[] = [];
    let finished = false;
    for (const [i, r] of this.rotating) {
      if (now - r.t0 < this.rotateMs) continue;
      if (r.queued > 0) {
        this.rotating.set(i, { from: r.to, to: rotCW(r.to), t0: r.t0 + this.rotateMs, queued: r.queued - 1 });
      } else {
        this.setBits(i, r.to);
        this.rotating.delete(i);
        events.push({ type: 'rotateFinished', tile: i });
        finished = true;
      }
    }
    if (finished) {
      events.push(...this.relight());
      events.push(...this.checkWin());
    }
    return events;
  }

  /** Bits to draw: a turning tile shows the shape it is turning from. */
  displayBits(i: number): number {
    return this.rotating.get(i)?.from ?? this.bits[i];
  }

  /** Bits as they will be once every turn (including buffered ones) completes. Used for saving. */
  settledBits(): number[] {
    return this.bits.map((b, i) => {
      const r = this.rotating.get(i);
      if (!r) return b;
      let x = r.to;
      for (let k = 0; k < r.queued; k++) x = rotCW(x);
      return x;
    });
  }

  /**
   * Claims the win for a board that is already fully lit, e.g. one restored from a save made during the final turn
   * (the constructor never checks for a win). Returns the same events as a winning turn would.
   */
  settleWin(): BoardEvent[] {
    return this.checkWin();
  }

  /** Test/debug only: snap to the solution. */
  debugSolve(): BoardEvent[] {
    this.rotating.clear();
    this.bits = [...this.solution];
    if (this.headless) this.recount();
    return [...this.relight(), ...this.checkWin()];
  }

  private setBits(i: number, b: number): void {
    if (this.headless) this.matched += this.linksMatched(i, b) - this.linksMatched(i, this.bits[i]);
    this.bits[i] = b;
  }

  /** How many of the links in `b` (tile i's shape) meet a link of the neighbouring tile. */
  private linksMatched(i: number, b: number): number {
    let n = 0;
    for (const d of DIRS) {
      if (!(b & d)) continue;
      const j = neighbor(this.grid, i, d);
      if (j >= 0 && this.bits[j] & OPPOSITE[d]) n++;
    }
    return n;
  }

  private recount(): void {
    let twice = 0;
    for (const i of this.grid.ids) twice += this.linksMatched(i, this.bits[i]);
    this.matched = twice / 2;
  }

  private relight(): BoardEvent[] {
    if (this.headless && (this.rotating.size > 0 || !(this.bits[this.grid.root] & D) || this.matched < this.grid.ids.length - 1)) {
      this.dark ??= computeLighting(this.grid, new Array<number>(this.bits.length).fill(0));
      this.lighting = this.dark;
      return [];
    }
    const prev = this.lighting;
    const next = computeLighting(this.grid, this.bits);
    this.lighting = next;
    const newlyLit = next.order.filter((i) => !prev.lit[i]);
    const lost = prev.order.filter((i) => !next.lit[i]);
    return newlyLit.length || lost.length ? [{ type: 'lightingChanged', newlyLit, lost }] : [];
  }

  private checkWin(): BoardEvent[] {
    if (this.won || this.lighting.count !== this.grid.ids.length) return [];
    this.won = true;
    return [{ type: 'won' }];
  }
}
```

- [ ] **Step 5: Move `REVEAL_MS` into the core**

In `src/core/clock.ts`, add at the top of the file:

```ts
/** The reveal before the clock starts (base spec §6): the server takes it off every ranked time. */
export const REVEAL_MS = 900;
```

In `src/app.ts`, delete line 24 (`export const REVEAL_MS = 900;`) and change the clock import to:

```ts
import { GameClock, REVEAL_MS } from './core/clock';
```

- [ ] **Step 6: Write `src/core/seeded.ts`**

```ts
import { Board } from './board';
import { GRID } from './mask';
import { mulberry32 } from './rng';

/**
 * Bump when anything that turns a seed into a tree changes: Board.random's call order (solution, scramble, colors),
 * the mask, a generator or the PRNG. Keep every version stored games still use in GENERATORS (as a frozen copy of the
 * old code if need be), so their logs always replay.
 */
export const GEN_VERSION = 1;

const GENERATORS: Readonly<Record<number, (seed: number, headless: boolean) => Board>> = {
  1: (seed, headless) => Board.random(GRID, mulberry32(seed), headless),
};

export const isSeed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

/** The tree a server seed makes, or null for an unknown generator version or a value that is not a uint32. */
export function seededBoard(seed: number, genVersion: number, headless = false): Board | null {
  const make = Object.hasOwn(GENERATORS, genVersion) ? GENERATORS[genVersion] : undefined;
  return make && isSeed(seed) ? make(seed, headless) : null;
}
```

- [ ] **Step 7: Write `src/core/log.ts`**

```ts
import type { Grid } from './mask';

/** A tile index (an accepted tap), 'p' (pause) or 'r' (resume). */
export type LogAction = number | 'p' | 'r';

export interface LogEntry {
  /** Integer ms since the game's local start (Date.now() − startEpoch), continuous across reloads. */
  t: number;
  a: LogAction;
}

export const MAX_LOG_ENTRIES = 5000;
export const MAX_LOG_MS = 86_400_000;

/**
 * A log from untrusted JSON, or null: at most 5,000 entries; integer times from 0 to one day that never go backwards;
 * taps on tiles of `grid` only; pauses and resumes strictly alternating, starting with a pause.
 */
export function parseLog(value: unknown, grid: Grid): LogEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOG_ENTRIES) return null;
  const out: LogEntry[] = [];
  let last = 0;
  let paused = false;
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { t, a } = entry as Record<string, unknown>;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < last || t > MAX_LOG_MS) return null;
    if (a === 'p' || a === 'r') {
      if ((a === 'p') === paused) return null;
      paused = a === 'p';
    } else if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= grid.cells.length || !grid.cells[a]) {
      return null;
    }
    last = t;
    out.push({ t, a });
  }
  return out;
}

/** Whether a log's last pause or resume is a pause. */
export function endsPaused(log: readonly LogEntry[]): boolean {
  for (let k = log.length - 1; k >= 0; k--) {
    if (log[k].a === 'p') return true;
    if (log[k].a === 'r') return false;
  }
  return false;
}

/**
 * The browser's recorder. Times come from the caller (log ms), so it stays pure. Taps while paused are never logged
 * (the server would refuse them), a pause or resume only when the state changes, and times never go backwards.
 * Past MAX_LOG_ENTRIES nothing more is kept (such a run can't verify).
 */
export class GameLog {
  readonly entries: LogEntry[];
  private pausedNow: boolean;

  constructor(entries: readonly LogEntry[] = []) {
    this.entries = [...entries];
    this.pausedNow = endsPaused(entries);
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  tap(t: number, tile: number): void {
    if (!this.pausedNow) this.push(t, tile);
  }

  pause(t: number): void {
    if (this.pausedNow) return;
    this.pausedNow = true;
    this.push(t, 'p');
  }

  resume(t: number): void {
    if (!this.pausedNow) return;
    this.pausedNow = false;
    this.push(t, 'r');
  }

  private push(t: number, a: LogAction): void {
    if (this.entries.length >= MAX_LOG_ENTRIES) return;
    const last = this.entries.length ? this.entries[this.entries.length - 1].t : 0;
    this.entries.push({ t: Math.min(MAX_LOG_MS, Math.max(last, Math.round(t))), a });
  }
}
```

- [ ] **Step 8: Write `src/core/replay.ts`**

```ts
import type { Board } from './board';
import type { LogEntry } from './log';

export interface Replay {
  /** Log time of the solve: when the turn that lit the whole tree finished. */
  solvedAt: number;
  /** Paused time before the solve (a pause still open at the solve counts up to it). */
  pausedMs: number;
  /** Pauses begun before the solve. */
  pauses: number;
  /** Log times of the taps, in order. */
  tapTimes: number[];
}

/** Ticks `board` at each turn's exact finishing time up to `to`. Returns the time of the win if it happens on the way. */
function advance(board: Board, to: number): number | null {
  for (;;) {
    let next = Infinity;
    for (const r of board.rotating.values()) next = Math.min(next, r.t0 + board.rotateMs);
    if (next === Infinity || next > to) return null;
    if (board.tick(next).some((e) => e.type === 'won')) return next;
  }
}

/**
 * Plays `log` on `board` (a fresh board from the game's seed) the way the browser does: before each entry, turns
 * finish at their exact times; then the tap goes in. Null when the log is not an honest client's: a tap while
 * paused, after the solve, or one the board drops (a full turn queue), or a tree that never gets solved.
 */
export function replay(board: Board, log: readonly LogEntry[]): Replay | null {
  let solvedAt: number | null = null;
  let paused = false;
  const tapTimes: number[] = [];
  for (const { t, a } of log) {
    if (solvedAt === null) solvedAt = advance(board, t);
    if (a === 'p' || a === 'r') {
      paused = a === 'p';
      continue;
    }
    if (paused || solvedAt !== null || board.tap(a, t).length === 0) return null;
    tapTimes.push(t);
  }
  solvedAt ??= advance(board, Number.MAX_SAFE_INTEGER);
  if (solvedAt === null) return null;
  let pausedMs = 0;
  let pauses = 0;
  let since: number | null = null;
  for (const { t, a } of log) {
    if (a === 'p' && t < solvedAt) {
      since = t;
      pauses++;
    } else if (a === 'r' && since !== null) {
      pausedMs += Math.min(t, solvedAt) - since;
      since = null;
    }
  }
  if (since !== null) pausedMs += solvedAt - since;
  return { solvedAt, pausedMs, pauses, tapTimes };
}
```

- [ ] **Step 9: Write `src/core/judge.ts`**

```ts
import { REVEAL_MS } from './clock';
import type { LogEntry } from './log';
import { replay } from './replay';
import { seededBoard } from './seeded';

export const CLOCK_TOLERANCE_MS = 3000;
export const MAX_PAUSED_MS = 10 * 60_000;
export const MAX_PAUSES = 20;
export const MIN_RANKED_MS = 5000;
export const FAST_GAP_MS = 40;
export const MAX_FAST_GAP_SHARE = 0.1;

/** Why a verified run doesn't rank. 'anonymous' (played signed out) clears when the run is claimed. */
export type UnrankedReason = 'anonymous' | 'paused' | 'too_fast' | 'clock';

export interface Verdict {
  /** Ranked time: the span from the local start to the solve, minus pauses, minus the reveal. */
  ms: number;
  pausedMs: number;
  pauses: number;
  /** null: the run ranks (once it has an owner). */
  reason: Exclude<UnrankedReason, 'anonymous'> | null;
}

export interface JudgeInput {
  seed: number;
  genVersion: number;
  log: readonly LogEntry[];
  /** The server's clock: receipt of the finish minus the stamped start. */
  serverElapsedMs: number;
}

/** The server's verdict on a finished run (spec §5.3), or null when the log is unverifiable (422, and the game is deleted). */
export function judge({ seed, genVersion, log, serverElapsedMs }: JudgeInput): Verdict | null {
  const board = seededBoard(seed, genVersion, true);
  const run = board && replay(board, log);
  if (!run) return null;
  const span = run.solvedAt;
  // More time in the log than passed on the server is impossible for an honest client.
  if (span - serverElapsedMs > CLOCK_TOLERANCE_MS) return null;
  const ms = Math.max(0, span - run.pausedMs - REVEAL_MS);
  const gaps = run.tapTimes.slice(1).map((t, k) => t - run.tapTimes[k]);
  const fast = gaps.filter((g) => g < FAST_GAP_MS).length;
  const reason =
    serverElapsedMs - span > CLOCK_TOLERANCE_MS
      ? 'clock'
      : run.pausedMs > MAX_PAUSED_MS || run.pauses > MAX_PAUSES
        ? 'paused'
        : ms < MIN_RANKED_MS || fast > gaps.length * MAX_FAST_GAP_SHARE
          ? 'too_fast'
          : null;
  return { ms, pausedMs: run.pausedMs, pauses: run.pauses, reason };
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/core && npm run typecheck`
Expected: PASS (all core tests, including the existing board tests; typecheck clean).

- [ ] **Step 11: Commit**

```bash
git add src/core tests/unit/core src/app.ts
git commit -m "feat(core): seeded boards, game log, headless replay and the run judge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: D1 schema, Worker router upgrade and the integration harness

The database, the structural D1 types, the shared HTTP helpers, and a router that matches regex routes (`:id` paths), refuses fake sign-in mode off localhost, and applies the same-origin + JSON check to every `/api/*` write. Plus Mapped's `getPlatformProxy` harness: a real local D1 per test file, migrations applied per run. The password admin still works at the end of this task (it goes in Task 6).

**Files:**
- Create: `migrations/0001_init.sql`, `worker/lib/db.ts`, `worker/lib/crypto.ts`, `tests/worker/harness.ts`, `tests/worker/wrangler.test.jsonc`, `tests/worker/schema.test.ts`, `tests/unit/worker/no-db.ts`
- Modify: `worker/lib/http.ts` (whole file below), `worker/lib/env.ts` (whole file below), `worker/router.ts` (whole file below), `worker/index.ts`, `worker/routes/admin/*.ts` (rename `adminJson` → `json`), `wrangler.jsonc`, `vite.config.ts:184` (test include), `tests/unit/worker/handlers.test.ts`, `tests/unit/worker/imports.test.ts`

**Interfaces:**
- Consumes: Task 1 nothing directly.
- Produces:
  - `worker/lib/db.ts`: `interface DbResult<T> { results: T[]; meta: { changes: number } }`, `interface DbStatement { bind(...values: unknown[]): DbStatement; first<T>(): Promise<T | null>; all<T>(): Promise<DbResult<T>>; run(): Promise<DbResult<unknown>> }`, `interface Db { prepare(query: string): DbStatement; batch(statements: DbStatement[]): Promise<DbResult<unknown>[]> }`.
  - `worker/lib/crypto.ts`: `base64url(bytes)`, `fromBase64url(text)`, `randomToken(bytes = 32)`, `randomSeed()`, `hmac(secret, data): Promise<string>`, `sha256(data): Promise<string>` (base64url strings).
  - `worker/lib/http.ts`: `class HttpError(status, code, message)`, `json(body, init?)`, `errorResponse(e)`, `redirect(location, cookies?)`, `checkWrite(req, pathname)`, `readJson(req, max?)`, `MAX_JSON_BYTES`, `getCookie(req, name): string | null`, `cookie(name, value, maxAgeSec)`, `clientIp(req)`, `isLocalHost(req)`; kept: `notConfigured`, `requireAdmin` (password, until Task 6), `sameOrigin`, `readTextCapped`.
  - `worker/lib/env.ts`: `AppEnv` gains `DB: Db` and `AUTH_MODE?: string`; `type Handler = (req: Request, env: AppEnv, ctx: Ctx, params: readonly string[]) => Response | Promise<Response>`.
  - `worker/router.ts`: `handle(req, env, ctx)`; route table `ROUTES: readonly (readonly [Method, RegExp, Handler])[]`.
  - `tests/worker/harness.ts`: `ORIGIN`, `statements(sql)`, `startDb()`, `wipe(db)`, `testEnv(db, over?)`, `call(env, method, path, opts?)`, `cookiesFrom(res)`.

- [ ] **Step 1: Write the migration**

`migrations/0001_init.sql`:

```sql
-- Aglow accounts (spec 2026-10-07 section 2). Times are epoch ms on the server's clock.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  name_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  claim_hash TEXT,
  ip_hash TEXT NOT NULL,
  gen_version INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ms INTEGER,
  paused_ms INTEGER,
  pauses INTEGER,
  ranked INTEGER NOT NULL DEFAULT 0,
  unranked_reason TEXT,
  log TEXT
);
CREATE INDEX games_board ON games (ms, finished_at) WHERE ranked = 1;
CREATE INDEX games_user ON games (user_id, finished_at DESC);
CREATE INDEX games_ip ON games (ip_hash, started_at);
CREATE INDEX games_abandoned ON games (started_at) WHERE finished_at IS NULL;
```

(Every statement ends with `;` at the end of a line and no comment contains a `;`: the harness splits the file on that.)

- [ ] **Step 2: Write the harness and its test config**

`tests/worker/wrangler.test.jsonc`:

```jsonc
// Bindings for the Worker integration tests: a throwaway in-memory D1 per test file (R2 is the FakeBucket).
{
  "name": "aglow-test",
  "compatibility_date": "2026-10-01",
  "d1_databases": [{ "binding": "DB", "database_name": "aglow-test", "database_id": "00000000-0000-0000-0000-000000000000" }]
}
```

`tests/worker/harness.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { handle } from '../../worker/router';
import { FakeBucket } from '../unit/worker/fake-bucket';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
/** Fake sign-in only works on localhost, so tests talk to this origin unless they pass `base`. */
export const ORIGIN = 'http://localhost';

/** The statements of a migration file, in order. Each ends with ";" at the end of a line. */
export function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A real local D1 (wrangler's miniflare, in memory) with every migration applied. One per test file. */
export async function startDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: Db }>({
    configPath: fileURLToPath(new URL('./wrangler.test.jsonc', import.meta.url)),
    persist: false,
  });
  const db = proxy.env.DB;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.batch(statements(readFileSync(new URL(file, MIGRATIONS), 'utf8')).map((s) => db.prepare(s)));
  }
  return { db, dispose: proxy.dispose };
}

export async function wipe(db: Db): Promise<void> {
  await db.batch(['games', 'sessions', 'users'].map((t) => db.prepare(`DELETE FROM ${t}`)));
}

export function testEnv(db: Db, over: Partial<AppEnv> = {}): AppEnv {
  return { DB: db, MUSIC: new FakeBucket(), MUSIC_BASE_URL: 'https://aglow-music.example', AUTH_MODE: 'fake', ...over };
}

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  /** null: send no Origin header. */
  origin?: string | null;
  ip?: string;
  /** Another site, e.g. to test real-Google mode or the fake-mode guard. */
  base?: string;
}

/** One request through the Worker's router. Writes are same-origin JSON unless told otherwise. */
export function call(env: AppEnv, method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const base = opts.base ?? ORIGIN;
  const headers = new Headers({ 'CF-Connecting-IP': opts.ip ?? '203.0.113.7' });
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const write = method !== 'GET';
  if (write) headers.set('Content-Type', 'application/json');
  if (write && opts.origin !== null) headers.set('Origin', opts.origin ?? base);
  const req = new Request(base + path, { method, headers, body: write ? JSON.stringify(opts.body ?? {}) : undefined });
  return handle(req, env, { waitUntil: () => undefined });
}

/** "name=value" pairs from a response's Set-Cookie headers, ready to send back. */
export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
```

`tests/unit/worker/no-db.ts`:

```ts
import type { Db } from '../../../worker/lib/db';

/** For unit tests of routes that never touch D1: any use fails loudly. */
export const NO_DB: Db = {
  prepare(): never {
    throw new Error('this test has no database');
  },
  batch(): never {
    throw new Error('this test has no database');
  },
};
```

- [ ] **Step 3: Write the failing tests**

`tests/worker/schema.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../worker/lib/db';
import { startDb, statements, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
}, 30_000);
afterAll(() => dispose());
beforeEach(() => wipe(db));

const count = async (sql: string): Promise<number> => (await db.prepare(sql).first<{ n: number }>())?.n ?? -1;

describe('migrations', () => {
  it('split into statements on ";" at a line end, without comments', () => {
    expect(statements('-- a comment\nCREATE TABLE a (x INTEGER);\nCREATE INDEX b ON a (x);\n')).toEqual(['CREATE TABLE a (x INTEGER)', 'CREATE INDEX b ON a (x)']);
  });

  it('create the tables and the indexes the spec names', async () => {
    const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all<{ name: string }>()).results.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['users', 'sessions', 'games', 'games_board', 'games_user', 'games_ip', 'games_abandoned']));
  });

  it('deleting a user deletes their sessions and games (foreign keys cascade); signed-out games stay', async () => {
    const user = await db.prepare("INSERT INTO users (google_sub, email, created_at) VALUES ('g-1', 'a@example.com', 1) RETURNING id").first<{ id: number }>();
    if (!user) throw new Error('no user');
    await db.batch([
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', ?, 1, 2)").bind(user.id),
      db.prepare("INSERT INTO games (id, user_id, ip_hash, gen_version, seed, started_at) VALUES ('owned-aaaaaaaaaaaaaa', ?, 'ip', 1, 1, 1)").bind(user.id),
      db.prepare("INSERT INTO games (id, user_id, ip_hash, gen_version, seed, started_at) VALUES ('anon-bbbbbbbbbbbbbbbb', NULL, 'ip', 1, 1, 1)"),
    ]);
    await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    expect(await count('SELECT count(*) AS n FROM sessions')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM games')).toBe(1);
  });

  it('name_key is unique', async () => {
    await db.prepare("INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES ('g-1', 'a@example.com', 'Comet', 'comet', 1)").run();
    await expect(db.prepare("INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES ('g-2', 'b@example.com', 'COMET', 'comet', 1)").run()).rejects.toThrow(/UNIQUE/);
  });
});
```

In `tests/unit/worker/handlers.test.ts` (still the password admin; it moves to the D1 harness in Task 6), make these edits:

1. Add the import `import { NO_DB } from './no-db';` and change `env` to include `DB: NO_DB`:

```ts
const env = (over: Partial<AppEnv> = {}): AppEnv => ({ DB: NO_DB, MUSIC: bucket, MUSIC_BASE_URL: B, ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, ...over });
```

2. Replace `req()` so writes are JSON (every write must be now) except the raw-audio upload:

```ts
function req(method: string, path: string, { headers = {}, body, origin }: ReqOpts = {}): Request {
  const o = origin === undefined ? (method === 'GET' ? null : SITE) : origin;
  const type = method !== 'GET' && !path.startsWith('/api/admin/upload') ? { 'content-type': 'application/json' } : {};
  return new Request(`${SITE}${path}`, { method, headers: { ...type, ...(o === null ? {} : { origin: o }), ...headers }, body });
}
```

3. In `it('serves every route in the table …')`, send `audio/mpeg` only to the upload route:

```ts
    for (const [method, path, status] of table) {
      const headers = path.startsWith('/api/admin/upload') ? { 'content-type': 'audio/mpeg' } : {};
      const r = await call(req(method, path, { headers, body: method === 'GET' ? undefined : '{}' }));
      expect(r.status, `${method} ${path}`).toBe(status);
      expect(r.headers.get('content-type'), `${method} ${path}`).toMatch(/^application\/json/);
    }
```

4. In `it('answers 404 JSON, never cached, for unknown /api paths')`, expect the new error shape:

```ts
      expect(await r.json(), path).toEqual({ error: 'not_found', message: 'Not found' });
```

5. Add after the `describe('origin check', …)` block:

```ts
describe('write checks and fake mode', () => {
  it('refuses a write that is not JSON anywhere but the raw-audio upload', async () => {
    const r = await call(req('PUT', '/api/admin/stations', { headers: { ...(await authed()), 'content-type': 'text/plain' }, body: '{}' }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'forbidden', message: 'Cross-origin request refused' });
    expect(stored()).toEqual(v3);
  });
  it('refuses every request with 500 misconfigured when fake sign-in is set on a non-local host', async () => {
    const r = await call(req('GET', '/api/stations'), env({ AUTH_MODE: 'fake' }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'misconfigured', message: 'Sign-in is misconfigured.' });
    const local = await handle(new Request('http://localhost/api/stations'), env({ AUTH_MODE: 'fake' }), ctx);
    expect(local.status).toBe(200);
  });
});
```

In `tests/unit/worker/imports.test.ts`, add inside the `describe`:

```ts
  it('reaches no browser code: only the pure core, the shared API types and names, and the station schema', () => {
    const safe = /^src\/(core\/[a-z-]+\.ts|api\/(types|names)\.ts|radio\/(schema|ids)\.ts)$/;
    const src = reachable()
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => f.startsWith('src/'));
    expect(src.filter((f) => !safe.test(f))).toEqual([]);
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/worker tests/unit/worker`
Expected: FAIL: `tests/worker` is not in the Vitest include yet (no tests found) and `worker/lib/db` doesn't exist; the handlers tests fail on the 404 body, the JSON write check and fake mode.

- [ ] **Step 5: Include the integration tests in Vitest**

In `vite.config.ts`, change the `test` line to:

```ts
  test: { include: ['tests/unit/**/*.test.ts', 'tests/worker/**/*.test.ts'], environment: 'node' },
```

- [ ] **Step 6: Write `worker/lib/db.ts` and `worker/lib/crypto.ts`**

`worker/lib/db.ts`:

```ts
/**
 * The slice of the D1 client the Worker uses, written structurally (like bucket.ts) so worker/lib and worker/routes
 * type-check under Node for the tests. worker/index.ts proves the real D1Database satisfies it.
 */
export interface DbResult<T> {
  results: T[];
  meta: { changes: number };
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run(): Promise<DbResult<unknown>>;
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<DbResult<unknown>[]>;
}
```

`worker/lib/crypto.ts`:

```ts
const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on text that isn't base64url. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** An unguessable id or token: 32 bytes is 256 bits (43 characters). */
export const randomToken = (bytes = 32): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** A uint32 game seed. */
export const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

/** HMAC-SHA256 of `data` under `secret`, base64url. */
export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

export async function sha256(data: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(data))));
}
```

- [ ] **Step 7: Rewrite `worker/lib/http.ts` and `worker/lib/env.ts`**

`worker/lib/http.ts`:

```ts
import { adminSecrets, isAdmin } from './session.js';

/** A failure with a status and a stable code; the router answers `{error: code, message}`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** JSON that is never cached anywhere (the public lists pass their own Cache-Control). */
export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { 'Cache-Control': 'no-store', ...init.headers } });
}

export const errorResponse = (e: HttpError): Response => json({ error: e.code, message: e.message }, { status: e.status });

export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export const notConfigured = (): Response => json({ error: 'Admin is not configured' }, { status: 503 });

/** null when the caller has a valid session, otherwise the response to send (401, or 503 if a secret is unset). */
export async function requireAdmin(req: Request, env: { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }): Promise<Response | null> {
  const secrets = adminSecrets(env);
  if (!secrets) return notConfigured();
  return (await isAdmin(req, secrets)) ? null : json({ error: 'Not signed in' }, { status: 401 });
}

/** Browsers send Origin on every write, so a state-changing request must carry one equal to its own origin. A missing header fails too. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return origin !== null && origin === new URL(req.url).origin;
}

/**
 * Writes (anything but GET) must be same-origin JSON, so another site can't act with a visitor's cookie. The
 * raw-audio upload is the one exception to the JSON rule.
 */
export function checkWrite(req: Request, pathname: string): void {
  if (req.method === 'GET') return;
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const rawUpload = req.method === 'PUT' && pathname === '/api/admin/upload';
  if (!sameOrigin(req) || (!rawUpload && type !== 'application/json')) throw new HttpError(403, 'forbidden', 'Cross-origin request refused');
}

/** Reads the body as text, or returns null if it is larger than `max` bytes (it stops reading as soon as the cap is passed). */
export async function readTextCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** A finish carries a log of at most 5,000 entries: well under this. */
export const MAX_JSON_BYTES = 262_144;

/** The request's JSON object body: 413 past `max` bytes, 400 when it isn't a JSON object. An empty body is `{}`. */
export async function readJson(req: Request, max = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const text = await readTextCapped(req, max);
  if (text === null) throw new HttpError(413, 'too_large', 'That request is too large.');
  try {
    const value: unknown = JSON.parse(text || '{}');
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // not JSON: answered below
  }
  throw new HttpError(400, 'bad_json', "That request isn't valid JSON.");
}

export function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Every cookie the Worker sets: host-only, HTTPS only, never readable by scripts, sent on top-level navigations (Google's redirect back). */
export const cookie = (name: string, value: string, maxAgeSec: number): string =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

/** Set by Cloudflare's edge; a client cannot forge it the way it can X-Forwarded-For. */
export const clientIp = (req: Request): string => req.headers.get('cf-connecting-ip')?.trim() || 'unknown';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const isLocalHost = (req: Request): boolean => LOCAL_HOSTS.has(new URL(req.url).hostname);
```

`worker/lib/env.ts`:

```ts
import type { Bucket } from './bucket.js';
import type { Db } from './db.js';

/** The slice of a Workers rate-limit binding the login route uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings as the routes see them (structural; worker/index.ts proves the real Env satisfies this). */
export interface AppEnv {
  MUSIC: Bucket;
  /** Public origin of the bucket (its R2 custom domain), e.g. "https://aglow-music.lukeghanna.com". */
  MUSIC_BASE_URL: string;
  /** D1 database "aglow": users, sessions and games. */
  DB: Db;
  /** "google" (default) or "fake" (localhost only: sign in as ?as=<email> without Google). */
  AUTH_MODE?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  LOGIN_LIMITER?: RateLimitBinding;
}

/** The slice of ExecutionContext the routes use. */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/** A route handler. `params` are the route pattern's capture groups. */
export type Handler = (req: Request, env: AppEnv, ctx: Ctx, params: readonly string[]) => Response | Promise<Response>;
```

Rename the helper in the routes: `sed -i '' 's/adminJson/json/g' worker/routes/admin/*.ts` (no other identifier named `json` exists in those files).

- [ ] **Step 8: Rewrite `worker/router.ts`**

```ts
import type { AppEnv, Ctx, Handler } from './lib/env.js';
import { checkWrite, errorResponse, HttpError, isLocalHost, json } from './lib/http.js';
import * as login from './routes/admin/login.js';
import * as logout from './routes/admin/logout.js';
import * as session from './routes/admin/session.js';
import * as adminStations from './routes/admin/stations.js';
import * as upload from './routes/admin/upload.js';
import * as stations from './routes/stations.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Route = readonly [method: Method, pattern: RegExp, handler: Handler];

/** Every /api route. Patterns are anchored; their capture groups become the handler's params. */
const ROUTES: readonly Route[] = [
  ['GET', /^\/api\/stations$/, stations.GET],
  ['POST', /^\/api\/admin\/login$/, login.POST],
  ['POST', /^\/api\/admin\/logout$/, logout.POST],
  ['GET', /^\/api\/admin\/session$/, session.GET],
  ['GET', /^\/api\/admin\/stations$/, adminStations.GET],
  ['PUT', /^\/api\/admin\/stations$/, adminStations.PUT],
  ['PUT', /^\/api\/admin\/upload$/, upload.PUT],
];

/** The Worker's request handler (it only runs for /api/*; everything else is static assets). */
export async function handle(req: Request, env: AppEnv, ctx: Ctx): Promise<Response> {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
    // Fake sign-in skips Google: anywhere but a developer's machine it would let anyone be anyone.
    if (env.AUTH_MODE === 'fake' && !isLocalHost(req)) throw new HttpError(500, 'misconfigured', 'Sign-in is misconfigured.');
    const matching = ROUTES.filter(([, pattern]) => pattern.test(pathname));
    if (matching.length === 0) throw new HttpError(404, 'not_found', 'Not found');
    const route = matching.find(([method]) => method === req.method);
    if (!route) {
      const allow = [...new Set(matching.map(([method]) => method))].join(', ');
      return json({ error: 'method_not_allowed', message: 'Method not allowed' }, { status: 405, headers: { Allow: allow } });
    }
    checkWrite(req, pathname);
    return await route[2](req, env, ctx, route[1].exec(pathname)?.slice(1) ?? []);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    // Visible in Workers Logs (wrangler.jsonc "observability"). Only the route and the error's class: never its
    // message, the request body or cookies, or a secret.
    console.error('api', pathname, req.method, e instanceof Error ? e.name : 'error');
    // Never a 500, and never the error itself (it could carry request data).
    return json({ error: 'unavailable', message: 'Something went wrong. Try again.' }, { status: 503 });
  }
}
```

- [ ] **Step 9: Bind D1 in `worker/index.ts` and `wrangler.jsonc`**

In `worker/index.ts`, add `import type { Db } from './lib/db.js';`, add these members to `Env`:

```ts
  /** D1 database "aglow": users, sessions and games (migrations/). */
  DB: D1Database;
  AUTH_MODE?: string;
```

and add the proof next to the other checks:

```ts
export type DbCheck = Assignable<D1Database, Db>;
```

(If `DbCheck` or `EnvCheck` fails to type-check, adjust only the structural interfaces in `worker/lib/db.ts` to match `@cloudflare/workers-types`' signatures; never use `any`.)

In `wrangler.jsonc`, add after `r2_buckets` (the zero id is a placeholder until the controller creates the database during rollout; Task 11's deploy check refuses it):

```jsonc
  // D1 "aglow": users, sessions and games. Create it with `npx wrangler d1 create aglow` and paste its id here (rollout).
  "d1_databases": [
    { "binding": "DB", "database_name": "aglow", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
  ],
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/worker tests/unit/worker && npm run typecheck`
Expected: PASS (schema tests on a real local D1; every existing handler test plus the new write and fake-mode checks; the import guard). The first run of `getPlatformProxy` can take a few seconds.

- [ ] **Step 11: Commit**

```bash
git add migrations worker tests/worker tests/unit/worker vite.config.ts wrangler.jsonc
git commit -m "feat(worker): D1 schema, regex routes, a write check on every /api write, local D1 test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Google sign-in, sessions, names, sign-out and account delete

Port Mapped's `worker/auth.ts` (spec §4): Google OIDC with PKCE, fake mode for localhost, D1 sessions holding only an HMAC of the token, `GET /api/me` with renewal, the once-only display name, sign-out and account delete. Also the shared types and name rules the browser uses later.

**Files:**
- Create: `src/api/types.ts`, `src/api/names.ts`, `worker/lib/users.ts`, `worker/routes/auth.ts`, `worker/routes/me.ts`, `tests/unit/api/names.test.ts`, `tests/worker/auth.test.ts`
- Modify: `worker/lib/env.ts` (four optional vars), `worker/index.ts` (`Env`), `worker/router.ts` (routes), `tests/worker/harness.ts` (`testEnv`, `signIn`)

**Interfaces:**
- Consumes: Task 2's `json`, `HttpError`, `redirect`, `readJson`, `getCookie`, `cookie`, `randomToken`, `hmac`, `sha256`, `fromBase64url`, `Db`, harness `call`/`cookiesFrom`; Task 1's `UnrankedReason`.
- Produces:
  - `src/api/types.ts`: `MAX_CLAIMS_PER_REQUEST = 8`; `User { name: string | null; isAdmin: boolean }`; `MeResponse { user: User | null }`; `NameCheck { available: boolean; reason?: 'invalid' | 'reserved' | 'taken' }`; `StartResponse { id; seed; genVersion; claim: string | null }`; `FinishResult { id; ranked; reason: UnrankedReason | null; ms; rank: number | null; total; best: number | null; newBest }`; `ClaimResponse { results: FinishResult[] }`; `BoardRow { rank; name; ms; finishedAt; mine }`; `BoardResponse { rows; total; you: BoardRow | null }`; `RecentGame { id; ms; finishedAt; ranked; reason; isBest }`; `MyGamesResponse { best: { ms; rank: number | null; finishedAt } | null; inTop; total; games: RecentGame[] }`; re-exports `type UnrankedReason`.
  - `src/api/names.ts`: `NAME_RULE`, `RESERVED_NAMES`, `cleanName(raw: unknown): string | null`, `nameKey(name): string`, `isReserved(name): boolean`.
  - `worker/lib/users.ts`: `SESSION_COOKIE`, `SESSION_DAYS = 365`, `RENEW_UNDER_DAYS = 182`, `interface SessionUser { id: number; name: string | null; email: string; expiresAt: number; token: string; tokenHash: string }`, `authSecret(env)`, `sessionHash(secret, token)`, `sessionCookie(token)`, `clearSessionCookie()`, `currentUser(req, env)`, `requireUser(req, env)`, `adminEmails(env)`, `isAdmin(env, email)`, `requireAdmin(req, env): Promise<SessionUser>`, `publicUser(env, u): User`.
  - `worker/routes/auth.ts`: `FLOW_COOKIE`, `FAKE_COOKIE`, `safeReturn`, `checkIdToken`, handlers `googleStart`, `googleCallback`, `nameAvailable`, `setName`, `signOut`.
  - `worker/routes/me.ts`: `getMe`, `deleteMe` (Task 5 adds `myGames`).
  - Harness: `testEnv` now sets `AUTH_SECRET`, `GOOGLE_CLIENT_ID: 'client-123'`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS: 'admin@example.com'`; `signIn(env, email, name?): Promise<string>` returns the `__Host-aglow_session=…` pair.

- [ ] **Step 1: Write the shared types and name rules**

`src/api/types.ts`:

```ts
import type { UnrankedReason } from '../core/judge';

/** JSON shapes shared by the Worker and the browser (spec 2026-10-07 §3). Types only, plus one constant. */
export type { UnrankedReason };

/** Most claims one POST /api/games/claim handles; the browser sends them in batches of this many. */
export const MAX_CLAIMS_PER_REQUEST = 8;

export interface User {
  /** null until the player picks one. */
  name: string | null;
  isAdmin: boolean;
}

export interface MeResponse {
  user: User | null;
}

export interface NameCheck {
  available: boolean;
  reason?: 'invalid' | 'reserved' | 'taken';
}

export interface StartResponse {
  id: string;
  seed: number;
  genVersion: number;
  /** Proves ownership of a game played signed out (only its HMAC is stored); null when signed in. */
  claim: string | null;
}

export interface FinishResult {
  id: string;
  ranked: boolean;
  reason: UnrankedReason | null;
  /** Ranked time (active ms), computed by the server. */
  ms: number;
  /** This run's place on the board, or for an 'anonymous' run the place it would take once claimed. Null otherwise. */
  rank: number | null;
  /** Ranked runs on the board (named players only). */
  total: number;
  /** The owner's best ranked time after this run; null when signed out or with no ranked run yet. */
  best: number | null;
  /** This run is now the owner's best ranked run. */
  newBest: boolean;
}

export interface ClaimResponse {
  results: FinishResult[];
}

export interface BoardRow {
  rank: number;
  name: string;
  ms: number;
  finishedAt: number;
  /** One of the signed-in player's runs. */
  mine: boolean;
}

export interface BoardResponse {
  /** The top 50 runs. */
  rows: BoardRow[];
  /** Ranked runs on the board. */
  total: number;
  /** Your best run's row when it is outside the top 50. */
  you: BoardRow | null;
}

export interface RecentGame {
  id: string;
  ms: number;
  finishedAt: number;
  ranked: boolean;
  reason: UnrankedReason | null;
  /** This run is the player's best ranked run. */
  isBest: boolean;
}

export interface MyGamesResponse {
  best: { ms: number; rank: number | null; finishedAt: number } | null;
  /** How many of the top 50 runs are yours. */
  inTop: number;
  total: number;
  /** The last 30 finished games, newest first. */
  games: RecentGame[];
}
```

`src/api/names.ts`:

```ts
/** Display names (spec §6): shared by the name card and the Worker. */
export const NAME_RULE = '3–20 letters, numbers, spaces, - or _';

/** Never anyone's display name, compared lower-cased with spaces, "-" and "_" removed. */
export const RESERVED_NAMES: readonly string[] = ['admin', 'administrator', 'aglow', 'santa', 'santaclaus', 'moderator', 'staff', 'support', 'official', 'system'];

/** The trimmed name when it follows the rule, else null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return /^[A-Za-z0-9 _-]{3,20}$/.test(name) && !name.includes('  ') ? name : null;
}

/** Names are unique case-insensitively. */
export const nameKey = (name: string): string => name.toLowerCase();

export const isReserved = (name: string): boolean => RESERVED_NAMES.includes(name.toLowerCase().replace(/[ _-]/g, ''));
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/api/names.test.ts`:

```ts
import { expect, it } from 'vitest';
import { cleanName, isReserved, nameKey } from '../../../src/api/names';

it('cleanName keeps 3–20 letters, digits, spaces, - and _, trimmed, with no double spaces', () => {
  expect(cleanName('  Tinsel Tom ')).toBe('Tinsel Tom');
  expect(cleanName('lat_long-2')).toBe('lat_long-2');
  for (const bad of ['ab', 'x'.repeat(21), 'a  b', 'émile', 'ana!', 'Luke H.', 42, null]) expect(cleanName(bad), String(bad)).toBeNull();
});

it('reserves admin, aglow, santa and friends whatever the case or separators', () => {
  for (const n of ['Admin', 'AGLOW', 'Santa', 's-a n_t a', 'Santa Claus', 'support']) expect(isReserved(n), n).toBe(true);
  for (const n of ['Santa Fan', 'Comet', 'Aglowing']) expect(isReserved(n), n).toBe(false);
  expect(nameKey('Comet')).toBe('comet');
});
```

`tests/worker/auth.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAME_RULE } from '../../src/api/names';
import type { MeResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import { checkIdToken, safeReturn } from '../../worker/routes/auth';
import { call, cookiesFrom, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
}, 30_000);
afterAll(() => dispose());
beforeEach(() => wipe(db));
afterEach(() => vi.unstubAllGlobals());

const SITE = 'https://aglow.lukeghanna.com';
const idToken = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const goodClaims = { iss: 'https://accounts.google.com', aud: 'client-123', exp: Date.now() / 1000 + 600, sub: 'g-1', email: 'Ana@Example.com', email_verified: true };
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;
const sessionOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-aglow_session='))?.split(';')[0] ?? '';
const me = async (cookie?: string, env = testEnv(db)) => (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponse;
const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

/** Real-Google sign-in with Google's token endpoint stubbed: start, then the callback with `query`. */
async function googleRound(query: (state: string) => string, token: () => Promise<Response>, ret = '/admin') {
  const env = testEnv(db, { AUTH_MODE: 'google' });
  vi.stubGlobal('fetch', vi.fn(token));
  const start = await call(env, 'GET', `/api/auth/google?return=${encodeURIComponent(ret)}`, { base: SITE });
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state') ?? '';
  return call(env, 'GET', `/api/auth/google/callback?${query(state)}`, { base: SITE, cookie: cookiesFrom(start) });
}

describe('pure helpers', () => {
  it('safeReturn keeps same-site paths only', () => {
    expect(safeReturn('/admin')).toBe('/admin');
    expect(safeReturn('/?x=1#y')).toBe('/?x=1#y');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com', '/\n/evil.com', '/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', null, '', 'admin']) {
      expect(safeReturn(bad), String(bad)).toBe('/');
    }
    expect(safeReturn('/ /evil.com')).toBe('/%20/evil.com');
  });

  it('checkIdToken accepts only Google tokens for this app with a verified email', () => {
    const now = Date.now();
    expect(checkIdToken(idToken(goodClaims), 'client-123', now)).toEqual({ sub: 'g-1', email: 'ana@example.com' });
    expect(checkIdToken(idToken({ ...goodClaims, iss: 'accounts.google.com' }), 'client-123', now)).not.toBeNull();
    for (const bad of [{ aud: 'other' }, { iss: 'https://evil.com' }, { exp: now / 1000 - 1 }, { email_verified: false }, { email_verified: 'true' }, { sub: 5 }]) {
      expect(checkIdToken(idToken({ ...goodClaims, ...bad }), 'client-123', now), JSON.stringify(bad)).toBeNull();
    }
    expect(checkIdToken('garbage', 'client-123', now)).toBeNull();
  });
});

describe('Google sign-in', () => {
  it('sends you to Google with PKCE (S256), a state, and a 10-minute flow cookie', async () => {
    const res = await call(testEnv(db, { AUTH_MODE: 'google' }), 'GET', '/api/auth/google?return=/admin', { base: SITE });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('Location') ?? '');
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      client_id: 'client-123',
      redirect_uri: `${SITE}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-aglow_oauth=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.%2Fadmin; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    const verifier = (res.headers.get('Set-Cookie') ?? '').split('=')[1].split('.')[1];
    expect(to.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('exchanges the code, creates the user and a session, and goes back where you were', async () => {
    const token = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id_token: idToken(goodClaims) }));
    const env = testEnv(db, { AUTH_MODE: 'google' });
    vi.stubGlobal('fetch', token);
    const start = await call(env, 'GET', '/api/auth/google?return=/admin', { base: SITE });
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
    const back = await call(env, 'GET', `/api/auth/google/callback?code=abc&state=${state}`, { base: SITE, cookie: cookiesFrom(start) });
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe('/admin');
    expect(token.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const sent = token.mock.calls[0][1].body as URLSearchParams;
    expect(Object.fromEntries(sent)).toMatchObject({ code: 'abc', client_id: 'client-123', redirect_uri: `${SITE}/api/auth/google/callback`, grant_type: 'authorization_code' });
    expect(sent.get('code_verifier')).toHaveLength(43);
    const cookies = back.headers.getSetCookie();
    expect(cookies).toContain('__Host-aglow_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    expect(cookies.find((c) => c.startsWith('__Host-aglow_session='))).toMatch(/^__Host-aglow_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/);
    expect(await db.prepare('SELECT google_sub, email, name FROM users').first()).toEqual({ google_sub: 'g-1', email: 'ana@example.com', name: null });
    // Only an HMAC of the token is stored.
    expect((await db.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>())?.token_hash).not.toBe(sessionOf(back).split('=')[1]);
    expect(await me(sessionOf(back), env)).toEqual({ user: { name: null, isAdmin: false } });
  });

  it('fails back to the page with ?auth=failed: wrong state, refused or bad token, unverified email, a cancel, no flow cookie', async () => {
    const ok = async () => Response.json({ id_token: idToken(goodClaims) });
    const cases: [(s: string) => string, () => Promise<Response>][] = [
      [() => 'code=abc&state=wrong', ok],
      [(s) => `code=abc&state=${s}`, async () => new Response('no', { status: 400 })],
      [(s) => `code=abc&state=${s}`, async () => Response.json({ id_token: idToken({ ...goodClaims, aud: 'someone-else' }) })],
      [(s) => `code=abc&state=${s}`, async () => Response.json({ id_token: idToken({ ...goodClaims, email_verified: false }) })],
      [(s) => `code=abc&state=${s}`, async () => Promise.reject(new TypeError('network'))],
      [(s) => `error=access_denied&state=${s}`, ok],
    ];
    for (const [query, token] of cases) {
      const res = await googleRound(query, token);
      expect(res.headers.get('Location')).toBe('/admin?auth=failed');
      expect(sessionOf(res)).toBe('');
    }
    const lost = await call(testEnv(db, { AUTH_MODE: 'google' }), 'GET', '/api/auth/google/callback?code=abc&state=x', { base: SITE });
    expect(lost.headers.get('Location')).toBe('/?auth=failed');
    expect(await count('users')).toBe(0);
  });

  it('a returning Google account is the same user, with its email refreshed', async () => {
    const env = testEnv(db);
    await signIn(env, 'ana@example.com', 'Meridian');
    await db.prepare("UPDATE users SET google_sub = 'fake:new@example.com'").run();
    const again = await signIn(env, 'new@example.com');
    expect(await me(again)).toEqual({ user: { name: 'Meridian', isAdmin: false } });
    expect(await db.prepare('SELECT email FROM users').first()).toEqual({ email: 'new@example.com' });
    expect(await count('users')).toBe(1);
  });

  it("signing in again revokes the browser's previous session", async () => {
    const env = testEnv(db);
    const first = await signIn(env, 'ana@example.com');
    const start = await call(env, 'GET', '/api/auth/google?return=/&as=ana@example.com', { cookie: first });
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: `${first}; ${cookiesFrom(start)}` });
    expect(sessionOf(back)).not.toBe(first);
    expect(await me(first)).toEqual({ user: null });
    expect(await count('sessions')).toBe(1);
  });

  it('fake mode signs in as ?as= or the aglow_fake_as cookie, and needs a plausible email', async () => {
    const env = testEnv(db);
    const viaCookie = await call(env, 'GET', '/api/auth/google?return=/', { cookie: 'aglow_fake_as=bo@example.com' });
    expect(new URL(viaCookie.headers.get('Location') ?? '').searchParams.get('code')).toBe('fake:bo@example.com');
    const start = await call(env, 'GET', '/api/auth/google?return=/&as=not-an-email');
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
    expect(back.headers.get('Location')).toBe('/?auth=failed');
  });

  it('fake mode is refused for every route anywhere but localhost', async () => {
    for (const path of ['/api/me', '/api/auth/google?as=x@y.z', '/api/auth/google/callback?code=fake:x@y.z&state=s', '/api/stations']) {
      const res = await call(testEnv(db), 'GET', path, { base: SITE });
      expect(res.status, path).toBe(500);
      expect(await body(res)).toEqual({ error: 'misconfigured', message: 'Sign-in is misconfigured.' });
    }
  });
});

describe('sessions', () => {
  it('GET /api/me renews a session with under 182 days left, and only then', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    expect((await call(env, 'GET', '/api/me', { cookie: s })).headers.get('Set-Cookie')).toBeNull();
    await db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 100 * 86_400_000).run();
    const renewed = await call(env, 'GET', '/api/me', { cookie: s });
    expect(renewed.headers.get('Set-Cookie')).toBe(`${s}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
    const row = await db.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThan(Date.now() + 364 * 86_400_000);
  });

  it('an expired, unknown or malformed session is signed out', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    await db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect(await me(s)).toEqual({ user: null });
    expect(await me(`__Host-aglow_session=${'x'.repeat(43)}`)).toEqual({ user: null });
    expect(await me('__Host-aglow_session=short')).toEqual({ user: null });
  });

  it('sign-out deletes the session and clears the cookie', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    const res = await call(env, 'POST', '/api/auth/signout', { cookie: s });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBe('__Host-aglow_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    expect(await count('sessions')).toBe(0);
    expect(await me(s)).toEqual({ user: null });
  });

  it('isAdmin follows ADMIN_EMAILS (comma-separated, any case, spaces ignored)', async () => {
    const env = testEnv(db, { ADMIN_EMAILS: ' other@example.com , ANA@example.com ' });
    const s = await signIn(env, 'ana@example.com');
    expect(await me(s, env)).toEqual({ user: { name: null, isAdmin: true } });
    expect(await me(s, testEnv(db, { ADMIN_EMAILS: undefined }))).toEqual({ user: { name: null, isAdmin: false } });
  });

  it('without AUTH_SECRET: signed-out calls still work, a session cookie gets 503 not_configured', async () => {
    const env = testEnv(db, { AUTH_SECRET: undefined });
    expect(await me(undefined, env)).toEqual({ user: null });
    const res = await call(env, 'GET', '/api/me', { cookie: `__Host-aglow_session=${'x'.repeat(43)}` });
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe('not_configured');
  });

  it('writes need same-origin JSON; unknown paths are 404 and wrong methods 405', async () => {
    const env = testEnv(db);
    expect((await call(env, 'POST', '/api/auth/signout', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'POST', '/api/auth/signout', { origin: null })).status).toBe(403);
    expect((await call(env, 'GET', '/api/nope')).status).toBe(404);
    expect((await call(env, 'GET', '/api/auth/signout')).status).toBe(405);
  });
});

describe('names', () => {
  it('checks a name: invalid, reserved, taken (any case) or available', async () => {
    const env = testEnv(db);
    await signIn(env, 'bo@example.com', 'Comet');
    const check = async (n: string) => body(await call(env, 'GET', `/api/auth/name?n=${encodeURIComponent(n)}`));
    expect(await check('ab')).toEqual({ available: false, reason: 'invalid' });
    expect(await check('s-a n_t a')).toEqual({ available: false, reason: 'reserved' });
    expect(await check('comet')).toEqual({ available: false, reason: 'taken' });
    expect(await check('  Tinsel Tom ')).toEqual({ available: true });
  });

  it('sets the name once; a name taken in between is 409 and the card can try another', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    await signIn(env, 'bo@example.com', 'Comet');
    const taken = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'COMET' } });
    expect(taken.status).toBe(409);
    expect(await body(taken)).toEqual({ error: 'taken', message: 'That name is taken.' });
    const ok = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: ' Tinsel Tom ' } });
    expect(await body(ok)).toEqual({ user: { name: 'Tinsel Tom', isAdmin: false } });
    const again = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Other Name' } });
    expect(again.status).toBe(409);
    expect((await body(again)).error).toBe('has_name');
  });

  it('refuses invalid and reserved names, and needs a session', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    expect(await body(await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'a!' } }))).toEqual({ error: 'invalid', message: `${NAME_RULE}.` });
    expect((await body(await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Santa' } }))).error).toBe('reserved');
    const anon = await call(env, 'POST', '/api/auth/name', { body: { name: 'Tinsel Tom' } });
    expect(anon.status).toBe(401);
    expect((await body(anon)).error).toBe('signed_out');
  });
});

describe('deleting an account', () => {
  it('needs the name typed (any case), then deletes the user, their sessions and games, and clears the cookie', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const user = await db.prepare('SELECT id FROM users').first<{ id: number }>();
    await db.prepare("INSERT INTO games (id, user_id, ip_hash, gen_version, seed, started_at) VALUES ('owned-aaaaaaaaaaaaaa', ?, 'ip', 1, 1, 1)").bind(user?.id).run();
    const wrong = await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: 'nope' } });
    expect(wrong.status).toBe(400);
    expect((await body(wrong)).error).toBe('confirm');
    const res = await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: ' meridian ' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBe('__Host-aglow_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    for (const t of ['users', 'sessions', 'games']) expect(await count(t), t).toBe(0);
  });

  it('an account without a name confirms with its email', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    expect((await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: 'ANA@example.com' } })).status).toBe(200);
    expect(await count('users')).toBe(0);
  });

  it('needs a session', async () => {
    expect((await call(testEnv(db), 'DELETE', '/api/me', { body: { confirm: 'x' } })).status).toBe(401);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/api tests/worker/auth.test.ts`
Expected: FAIL: `worker/routes/auth` and `src/api/names` don't resolve; `signIn` is not exported by the harness.

- [ ] **Step 4: Add the auth vars to the environment**

In `worker/lib/env.ts`, add to `AppEnv` (after `AUTH_MODE`):

```ts
  /** Secret: 256 random bits keying session, claim and IP hashes. */
  AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Secret, pasted by Luke from the Google console. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated, compared lower-cased: the radio admin's Google email(s). */
  ADMIN_EMAILS?: string;
```

In `worker/index.ts`, add the same four optional `string` members to `Env`.

In `tests/worker/harness.ts`, replace `testEnv` and add `signIn` (fixture values only; never a real secret):

```ts
export function testEnv(db: Db, over: Partial<AppEnv> = {}): AppEnv {
  return {
    DB: db,
    MUSIC: new FakeBucket(),
    MUSIC_BASE_URL: 'https://aglow-music.example',
    AUTH_MODE: 'fake',
    AUTH_SECRET: 'test-auth-secret-not-real',
    GOOGLE_CLIENT_ID: 'client-123',
    GOOGLE_CLIENT_SECRET: 'test-client-secret-not-real',
    ADMIN_EMAILS: 'admin@example.com',
    ...over,
  };
}

/** Signs in through fake mode (the whole redirect dance) and optionally picks a name. Returns "__Host-aglow_session=…". */
export async function signIn(env: AppEnv, email: string, name?: string): Promise<string> {
  const start = await call(env, 'GET', `/api/auth/google?return=/&as=${encodeURIComponent(email)}`);
  const to = new URL(start.headers.get('Location') ?? '');
  const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
  const session = back.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-aglow_session='))
    ?.split(';')[0];
  if (!session) throw new Error(`fake sign-in failed for ${email}`);
  if (name) {
    const res = await call(env, 'POST', '/api/auth/name', { cookie: session, body: { name } });
    if (!res.ok) throw new Error(`could not name ${email}: ${res.status}`);
  }
  return session;
}
```

- [ ] **Step 5: Write `worker/lib/users.ts`**

```ts
import type { User } from '../../src/api/types.js';
import { hmac } from './crypto.js';
import type { AppEnv } from './env.js';
import { cookie, getCookie, HttpError } from './http.js';

export const SESSION_COOKIE = '__Host-aglow_session';
export const SESSION_DAYS = 365;
/** Sessions with less than this left are renewed by GET /api/me. */
export const RENEW_UNDER_DAYS = 182;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionUser {
  id: number;
  name: string | null;
  /** Lower-cased; verified by Google at sign-in. Never shown publicly. */
  email: string;
  expiresAt: number;
  /** The cookie's token, to set the cookie again on renewal. */
  token: string;
  tokenHash: string;
}

/** AUTH_SECRET, or 503 not_configured: no session, claim or IP hash without it. */
export function authSecret(env: AppEnv): string {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new HttpError(503, 'not_configured', 'Accounts are not configured.');
  return secret;
}

/** D1 stores only this, so a leaked table holds no usable token. */
export const sessionHash = (secret: string, token: string): Promise<string> => hmac(secret, `session:${token}`);
export const sessionCookie = (token: string): string => cookie(SESSION_COOKIE, token, SESSION_DAYS * 86_400);
export const clearSessionCookie = (): string => cookie(SESSION_COOKIE, '', 0);

export async function currentUser(req: Request, env: AppEnv): Promise<SessionUser | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !TOKEN.test(token)) return null;
  const tokenHash = await sessionHash(authSecret(env), token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.name, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(tokenHash, Date.now())
    .first<{ id: number; name: string | null; email: string; expires_at: number }>();
  return row && { id: row.id, name: row.name, email: row.email, expiresAt: row.expires_at, token, tokenHash };
}

export async function requireUser(req: Request, env: AppEnv): Promise<SessionUser> {
  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, 'signed_out', 'Sign in first.');
  return user;
}

export function adminEmails(env: AppEnv): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isAdmin = (env: AppEnv, email: string): boolean => adminEmails(env).has(email.toLowerCase());

/** The radio admin: 401 signed out, 403 for any other account. */
export async function requireAdmin(req: Request, env: AppEnv): Promise<SessionUser> {
  const user = await requireUser(req, env);
  if (!isAdmin(env, user.email)) throw new HttpError(403, 'forbidden', 'This account is not the radio admin.');
  return user;
}

/** What the browser may know about the signed-in player (never the email). */
export const publicUser = (env: AppEnv, u: { name: string | null; email: string }): User => ({ name: u.name, isAdmin: isAdmin(env, u.email) });
```

- [ ] **Step 6: Write `worker/routes/auth.ts`**

```ts
import { cleanName, isReserved, NAME_RULE, nameKey } from '../../src/api/names.js';
import type { NameCheck } from '../../src/api/types.js';
import { fromBase64url, randomToken, sha256 } from '../lib/crypto.js';
import type { AppEnv } from '../lib/env.js';
import { cookie, getCookie, HttpError, json, readJson, redirect } from '../lib/http.js';
import { clearSessionCookie, publicUser, requireUser, SESSION_COOKIE, SESSION_DAYS, sessionCookie, sessionHash } from '../lib/users.js';

export const FLOW_COOKIE = '__Host-aglow_oauth';
/** Fake mode only: the e2e tests' Google account. */
export const FAKE_COOKIE = 'aglow_fake_as';
const FLOW_SECONDS = 600;
const DAY_MS = 86_400_000;

/** Only same-site paths: "/x", never "//evil.com", "/\evil.com", another origin or control characters. */
export function safeReturn(value: string | null): string {
  if (!value || value.length > 200 || /[\x00-\x1f\x7f]/.test(value) || !value.startsWith('/')) return '/';
  try {
    const url = new URL(value, 'http://x');
    if (url.origin !== 'http://x') return '/';
    const result = url.pathname + url.search + url.hash;
    if (result.startsWith('//') || result.startsWith('/\\')) return '/';
    return result;
  } catch {
    return '/';
  }
}

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return url.pathname + url.search + url.hash;
}

/** GET /api/auth/google?return=/path (fake mode: &as=<email> or the aglow_fake_as cookie) */
export async function googleStart(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const back = safeReturn(url.searchParams.get('return'));
  const state = randomToken(16);
  const verifier = randomToken(32);
  const flow = cookie(FLOW_COOKIE, `${state}.${verifier}.${encodeURIComponent(back)}`, FLOW_SECONDS);
  const callback = `${url.origin}/api/auth/google/callback`;
  if (env.AUTH_MODE === 'fake') {
    const as = url.searchParams.get('as') ?? getCookie(req, FAKE_COOKIE) ?? 'player@example.com';
    return redirect(`${callback}?code=${encodeURIComponent(`fake:${as}`)}&state=${state}`, [flow]);
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new HttpError(503, 'not_configured', 'Sign-in is not configured.');
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(google.toString(), [flow]);
}

export interface Identity {
  sub: string;
  email: string;
}

/**
 * The id_token's claims. It came straight from Google's token endpoint over TLS, so its signature needn't be checked
 * (OpenID Connect Core 3.1.3.7); the issuer, audience, expiry and verified email still are.
 */
export function checkIdToken(idToken: string, clientId: string, now: number): Identity | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(idToken.split('.')[1] ?? ''))) as Record<string, unknown>;
    const issuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!issuer || claims.aud !== clientId || !(typeof claims.exp === 'number' && claims.exp * 1000 > now) || claims.email_verified !== true) return null;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
    return { sub: claims.sub, email: claims.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function exchange(env: AppEnv, code: string, verifier: string, redirectUri: string): Promise<Identity | null> {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id_token?: unknown };
    return typeof data.id_token === 'string' ? checkIdToken(data.id_token, clientId, Date.now()) : null;
  } catch {
    return null;
  }
}

function fakeIdentity(code: string): Identity | null {
  if (!code.startsWith('fake:')) return null;
  const email = code.slice(5).trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email) ? { sub: `fake:${email}`, email } : null;
}

/** GET /api/auth/google/callback?code&state: any failure goes back to the page with ?auth=failed. */
export async function googleCallback(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const [state, verifier, ...rest] = (getCookie(req, FLOW_COOKIE) ?? '').split('.');
  let back = '/';
  try {
    back = safeReturn(decodeURIComponent(rest.join('.')));
  } catch {
    // keep '/'
  }
  const clear = cookie(FLOW_COOKIE, '', 0);
  const failed = () => redirect(withParam(back, 'auth', 'failed'), [clear]);
  const code = url.searchParams.get('code');
  const secret = env.AUTH_SECRET?.trim();
  if (!state || !verifier || !code || url.searchParams.get('state') !== state || !secret) return failed();

  const identity = env.AUTH_MODE === 'fake' ? fakeIdentity(code) : await exchange(env, code, verifier, `${url.origin}/api/auth/google/callback`);
  if (!identity) return failed();

  const now = Date.now();
  const user = await env.DB.prepare(
    'INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?) ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email RETURNING id',
  )
    .bind(identity.sub, identity.email, now)
    .first<{ id: number }>();
  if (!user) throw new Error('user upsert returned no row');
  const token = randomToken(32);
  const old = getCookie(req, SESSION_COOKIE);
  const statements = [
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await sessionHash(secret, token),
      user.id,
      now,
      now + SESSION_DAYS * DAY_MS,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ];
  // Signing in revokes the session this browser already had.
  if (old) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(secret, old)));
  await env.DB.batch(statements);
  return redirect(back, [clear, sessionCookie(token)]);
}

/** GET /api/auth/name?n= */
export async function nameAvailable(req: Request, env: AppEnv): Promise<Response> {
  const name = cleanName(new URL(req.url).searchParams.get('n'));
  if (!name) return json({ available: false, reason: 'invalid' } satisfies NameCheck);
  if (isReserved(name)) return json({ available: false, reason: 'reserved' } satisfies NameCheck);
  const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE name_key = ?').bind(nameKey(name)).first();
  return json((taken ? { available: false, reason: 'taken' } : { available: true }) satisfies NameCheck);
}

/** POST /api/auth/name { name }: once per account. */
export async function setName(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const name = cleanName((await readJson(req)).name);
  if (!name) throw new HttpError(400, 'invalid', `${NAME_RULE}.`);
  if (isReserved(name)) throw new HttpError(400, 'reserved', 'That name is reserved.');
  if (user.name !== null) throw new HttpError(409, 'has_name', 'You already have a name.');
  try {
    const res = await env.DB.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ? AND name IS NULL').bind(name, nameKey(name), user.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'has_name', 'You already have a name.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'taken', 'That name is taken.');
    throw e;
  }
  return json({ user: publicUser(env, { name, email: user.email }) });
}

/** POST /api/auth/signout */
export async function signOut(req: Request, env: AppEnv): Promise<Response> {
  const token = getCookie(req, SESSION_COOKIE);
  const secret = env.AUTH_SECRET?.trim();
  if (token && secret) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(secret, token)).run();
  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
```

- [ ] **Step 7: Write `worker/routes/me.ts`**

```ts
import type { MeResponse } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { clearSessionCookie, currentUser, publicUser, RENEW_UNDER_DAYS, requireUser, SESSION_DAYS, sessionCookie } from '../lib/users.js';

const DAY_MS = 86_400_000;

/** GET /api/me. Renews a session past its halfway point, so regular players stay signed in. */
export async function getMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return json({ user: null } satisfies MeResponse);
  const body: MeResponse = { user: publicUser(env, user) };
  if (user.expiresAt - Date.now() > RENEW_UNDER_DAYS * DAY_MS) return json(body);
  await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + SESSION_DAYS * DAY_MS, user.tokenHash).run();
  return json(body, { headers: { 'Set-Cookie': sessionCookie(user.token) } });
}

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** DELETE /api/me { confirm }: the display name, or the email before a name is picked. Games and sessions go too (cascade). */
export async function deleteMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  if (norm((await readJson(req)).confirm) !== norm(user.name ?? user.email)) throw new HttpError(400, 'confirm', 'Type it exactly as shown to confirm.');
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
```

- [ ] **Step 8: Add the routes**

In `worker/router.ts`, add the imports `import * as auth from './routes/auth.js';` and `import * as me from './routes/me.js';`, and insert after the `/api/stations` route:

```ts
  ['GET', /^\/api\/auth\/google$/, auth.googleStart],
  ['GET', /^\/api\/auth\/google\/callback$/, auth.googleCallback],
  ['GET', /^\/api\/auth\/name$/, auth.nameAvailable],
  ['POST', /^\/api\/auth\/name$/, auth.setName],
  ['POST', /^\/api\/auth\/signout$/, auth.signOut],
  ['GET', /^\/api\/me$/, me.getMe],
  ['DELETE', /^\/api\/me$/, me.deleteMe],
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/api tests/worker && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/api worker tests/unit/api tests/worker
git commit -m "feat(auth): Google sign-in with PKCE, D1 sessions, fake mode, display names, sign-out and account delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Games: start, finish and claim

`POST /api/games` (server seed and start stamp, claim token when signed out, 200 starts per IP hash per hour, lazy housekeeping), `POST /api/games/:id/finish` (parse, replay and judge; idempotent; 422 deletes the row) and `POST /api/games/claim` (8 per request). Also the rank and best-run queries the results need.

**Files:**
- Create: `worker/lib/ranks.ts`, `worker/routes/games.ts`, `tests/worker/games.test.ts`
- Modify: `worker/router.ts`, `tests/unit/worker/imports.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseLog`, `judge`, `GEN_VERSION`, `UnrankedReason`, test helpers `solvingTaps`, `withPause`; Task 2 `Db`, `json`, `HttpError`, `readJson`, `clientIp`, `hmac`, `randomToken`, `randomSeed`, harness; Task 3 `authSecret`, `currentUser`, `requireUser`, types `StartResponse`, `FinishResult`, `ClaimResponse`, `MAX_CLAIMS_PER_REQUEST`, harness `signIn`.
- Produces:
  - `worker/lib/ranks.ts`: `TOP = 50`; `boardTotal(db): Promise<number>`; `rankOf(db, ms, finishedAt): Promise<number>`; `interface BestRun { id: string; ms: number; finished_at: number }`; `bestOf(db, userId): Promise<BestRun | null>` (Task 5 adds the top-50 query).
  - `worker/routes/games.ts`: `STARTS_PER_HOUR = 200`, `UNCLAIMED_KEEP_DAYS = 90`, `GAME_ID` regex, handlers `startGame`, `finishGame`, `claimGames`.

- [ ] **Step 1: Write the failing tests**

`tests/worker/games.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimResponse, FinishResult, StartResponse } from '../../src/api/types';
import { REVEAL_MS } from '../../src/core/clock';
import type { LogEntry } from '../../src/core/log';
import { replay } from '../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../src/core/seeded';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { STARTS_PER_HOUR, UNCLAIMED_KEEP_DAYS } from '../../worker/routes/games';
import { solvingTaps, withPause } from '../unit/core/solver';
import { call, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
let env: AppEnv;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
  env = testEnv(db);
}, 30_000);
afterAll(() => dispose());
beforeEach(() => wipe(db));

const DAY = 86_400_000;
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;
const start = async (cookie?: string, ip?: string): Promise<StartResponse> => json<StartResponse>(await call(env, 'POST', '/api/games', { cookie, ip }));
/** An honest player's log: the scripted solver, from 3 s after the local start, `gap` ms between taps. */
const honestLog = (seed: number, gap = 50): LogEntry[] => {
  const b = seededBoard(seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, 3000, gap);
};
const spanOf = (seed: number, log: LogEntry[]): number => {
  const b = seededBoard(seed, GEN_VERSION, true);
  const r = b && replay(b, log);
  if (!r) throw new Error('does not replay');
  return r.solvedAt;
};
/** Moves the server's start stamp back, as if the game had been going on for `ms`. */
const backdate = (id: string, ms: number) => db.prepare('UPDATE games SET started_at = started_at - ? WHERE id = ?').bind(ms, id).run();
/** Finishes like an honest client: the server has seen the log's span plus `extra` ms of network. */
async function finish(game: StartResponse, log: LogEntry[], { cookie, extra = 300 }: { cookie?: string; extra?: number } = {}): Promise<Response> {
  await backdate(game.id, spanOf(game.seed, log) + extra);
  return call(env, 'POST', `/api/games/${game.id}/finish`, { cookie, body: { log } });
}
async function play(cookie?: string, opts: { gap?: number; pauses?: number; extra?: number } = {}) {
  const game = await start(cookie);
  let log = honestLog(game.seed, opts.gap);
  for (let k = 0; k < (opts.pauses ?? 0); k++) log = withPause(log, 5 + 3 * k, 100);
  const res = await finish(game, log, { cookie, extra: opts.extra });
  return { game, log, res, result: await json<FinishResult>(res.clone()) };
}
const row = (id: string) => db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Record<string, unknown>>();
const claim = async (cookie: string, claims: { id: string; claim: string | null }[]) =>
  json<ClaimResponse>(await call(env, 'POST', '/api/games/claim', { cookie, body: { claims } }));

describe('starting a game', () => {
  it('returns an id, a seed and the generator version; a claim token only when signed out', async () => {
    const before = Date.now();
    const anon = await start();
    expect(anon).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), seed: expect.any(Number), genVersion: GEN_VERSION, claim: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) });
    const stored = await row(anon.id);
    expect(stored).toMatchObject({ user_id: null, gen_version: GEN_VERSION, seed: anon.seed, finished_at: null, ranked: 0 });
    expect(stored?.started_at).toBeGreaterThanOrEqual(before);
    expect(stored?.claim_hash).not.toBe(anon.claim); // only an HMAC of the claim
    expect(String(stored?.ip_hash)).not.toContain('203.0.113.7'); // only an HMAC of the IP
    const ana = await signIn(env, 'ana@example.com');
    expect((await start(ana)).claim).toBeNull();
  });

  it('limits starts per IP per hour (429), counting only that IP and only the last hour', async () => {
    const first = await start();
    const ipHash = String((await row(first.id))?.ip_hash);
    await db.batch(
      Array.from({ length: STARTS_PER_HOUR - 1 }, (_, i) =>
        db.prepare('INSERT INTO games (id, ip_hash, gen_version, seed, started_at) VALUES (?, ?, 1, 1, ?)').bind(`filler-${String(i).padStart(12, '0')}`, ipHash, Date.now()),
      ),
    );
    const limited = await call(env, 'POST', '/api/games', {});
    expect(limited.status).toBe(429);
    expect((await json<{ error: string }>(limited)).error).toBe('rate_limited');
    expect((await call(env, 'POST', '/api/games', { ip: '198.51.100.9' })).status).toBe(200);
    await db.prepare('UPDATE games SET started_at = started_at - 3600001').run();
    expect((await call(env, 'POST', '/api/games', {})).status).toBe(200);
  });

  it('housekeeping: abandoned games go after a day, unclaimed finished games after 90 days, owned games stay', async () => {
    const abandoned = await start();
    const recentAnon = await play();
    const oldAnon = await play();
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const owned = await play(ana);
    const age = (id: string, days: number) =>
      db
        .prepare('UPDATE games SET started_at = ?1, finished_at = CASE WHEN finished_at IS NULL THEN NULL ELSE ?1 END WHERE id = ?2')
        .bind(Date.now() - days * DAY, id)
        .run();
    await age(abandoned.id, 2);
    await age(recentAnon.game.id, 2);
    await age(oldAnon.game.id, UNCLAIMED_KEEP_DAYS + 1);
    await age(owned.game.id, 400);
    await start();
    expect(await row(abandoned.id)).toBeNull();
    expect(await row(recentAnon.game.id)).not.toBeNull();
    expect(await row(oldAnon.game.id)).toBeNull();
    expect(await row(owned.game.id)).not.toBeNull();
  });

  it('clears at most 50 stale games per start (25 abandoned and 25 unclaimed)', async () => {
    const old = Date.now() - 100 * DAY;
    await db.batch(
      Array.from({ length: 60 }, (_, i) =>
        db.prepare("INSERT INTO games (id, ip_hash, gen_version, seed, started_at, finished_at) VALUES (?, 'ip', 1, 1, ?, ?)").bind(`stale-${String(i).padStart(12, '0')}`, old, i % 2 ? old : null),
      ),
    );
    await start();
    expect((await db.prepare("SELECT count(*) AS n FROM games WHERE id LIKE 'stale-%'").first<{ n: number }>())?.n).toBe(10);
  });

  it('housekeeping finds stale games through indexes, not a scan of every game', async () => {
    const plan = async (sql: string) => JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(1, 25).all()).results);
    expect(await plan('SELECT id FROM games WHERE finished_at IS NULL AND started_at < ? LIMIT ?')).toContain('games_abandoned');
    expect(await plan('SELECT id FROM games WHERE user_id IS NULL AND finished_at < ? LIMIT ?')).toContain('games_user');
  });
});

describe('finishing a game', () => {
  it('signed in: ranked, #1 of 1, a new best; the log and pause totals are kept', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { game, log, result } = await play(ana);
    const ms = spanOf(game.seed, log) - REVEAL_MS;
    expect(result).toEqual({ id: game.id, ranked: true, reason: null, ms, rank: 1, total: 1, best: ms, newBest: true });
    expect(await row(game.id)).toMatchObject({ ranked: 1, unranked_reason: null, ms, paused_ms: 0, pauses: 0, log: JSON.stringify(log) });
  });

  it('a second run ranks too; the best is whichever is faster', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const first = (await play(ana)).result;
    const second = (await play(ana, { gap: 90 })).result;
    expect(second).toMatchObject({ ranked: true, total: 2, best: Math.min(first.ms, second.ms), newBest: second.ms < first.ms });
    expect(second.rank).toBe(second.ms < first.ms ? 1 : 2);
  });

  it('signed out: anonymous, with the place it would take; claiming it ranks it', async () => {
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    await play(bo);
    const anon = await play();
    expect(anon.result).toMatchObject({ ranked: false, reason: 'anonymous', rank: expect.any(Number), total: 1, best: null, newBest: false });
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { results } = await claim(ana, [{ id: anon.game.id, claim: anon.game.claim }]);
    expect(results).toEqual([{ ...anon.result, ranked: true, reason: null, total: 2, best: anon.result.ms, newBest: true }]);
    expect(await row(anon.game.id)).toMatchObject({ claim_hash: null, ranked: 1, unranked_reason: null });
  });

  it('unranked: more than 20 pauses (paused), gaps under 40 ms (too_fast), unexplained server time (clock)', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    expect((await play(ana, { pauses: 21 })).result).toMatchObject({ ranked: false, reason: 'paused', rank: null });
    expect((await play(ana, { pauses: 20 })).result).toMatchObject({ ranked: true, reason: null });
    expect((await play(ana, { gap: 20 })).result).toMatchObject({ ranked: false, reason: 'too_fast' });
    expect((await play(ana, { extra: 3500 })).result).toMatchObject({ ranked: false, reason: 'clock' });
  });

  it('422 unverified deletes the game: a log that does not replay, or one spanning more than the server saw', async () => {
    const g1 = await start();
    const bad = await call(env, 'POST', `/api/games/${g1.id}/finish`, { body: { log: [{ t: 0, a: 'nope' }] } });
    expect(bad.status).toBe(422);
    expect(await json(bad)).toEqual({ error: 'unverified', message: "This run couldn't be verified." });
    expect(await row(g1.id)).toBeNull();
    const g2 = await start();
    // No backdate: the log spans seconds, the server has seen milliseconds.
    expect((await call(env, 'POST', `/api/games/${g2.id}/finish`, { body: { log: honestLog(g2.seed) } })).status).toBe(422);
    expect(await row(g2.id)).toBeNull();
    expect((await call(env, 'POST', `/api/games/${g2.id}/finish`, { body: { log: [] } })).status).toBe(404);
  });

  it('finishing twice returns the saved result and changes nothing (a retry after a lost response)', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { game, result } = await play(ana);
    const before = await row(game.id);
    const again = await call(env, 'POST', `/api/games/${game.id}/finish`, { body: { log: [] } });
    expect(again.status).toBe(200);
    expect(await json(again)).toEqual(result);
    expect(await row(game.id)).toEqual(before);
  });

  it('an unknown game is 404 not_found; a malformed id matches no route', async () => {
    const unknown = await call(env, 'POST', '/api/games/zzzzzzzzzzzzzzzzzzzzzz/finish', { body: { log: [] } });
    expect(unknown.status).toBe(404);
    expect((await json<{ error: string }>(unknown)).error).toBe('not_found');
    expect((await call(env, 'POST', '/api/games/x/finish', { body: { log: [] } })).status).toBe(404);
  });
});

describe('claiming games', () => {
  it('a wrong token, a game already owned, or an unfinished game claims nothing', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    const anon = await play();
    const unfinished = await start();
    expect((await claim(ana, [{ id: anon.game.id, claim: 'x'.repeat(32) }])).results).toEqual([]);
    expect((await claim(ana, [{ id: unfinished.id, claim: unfinished.claim }])).results).toEqual([]);
    expect((await claim(ana, [{ id: anon.game.id, claim: anon.game.claim }])).results).toHaveLength(1);
    expect((await claim(bo, [{ id: anon.game.id, claim: anon.game.claim }])).results).toEqual([]);
  });

  it('a claimed run keeps any other reason: a paused signed-out run stays unranked', async () => {
    const pausy = await play(undefined, { pauses: 21 });
    expect(pausy.result.reason).toBe('paused');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    expect((await claim(ana, [{ id: pausy.game.id, claim: pausy.game.claim }])).results).toMatchObject([{ ranked: false, reason: 'paused' }]);
  });

  it('handles at most 8 claims per request, and needs a session', async () => {
    const runs = [];
    for (let k = 0; k < 9; k++) runs.push(await play());
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { results } = await claim(ana, runs.map((r) => ({ id: r.game.id, claim: r.game.claim })));
    expect(results).toHaveLength(8);
    expect(await row(runs[8].game.id)).toMatchObject({ user_id: null });
    expect((await call(env, 'POST', '/api/games/claim', { body: { claims: [] } })).status).toBe(401);
  });
});
```

In `tests/unit/worker/imports.test.ts`, add to `it('finds the files it should check')`:

```ts
    expect(rel).toContain('src/core/judge.ts');
    expect(rel).toContain('src/core/board.ts');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/worker/games.test.ts`
Expected: FAIL: `worker/routes/games` does not resolve.

- [ ] **Step 3: Write `worker/lib/ranks.ts`**

```ts
import type { Db } from './db.js';

/** Ranked runs by players who have a name: the only runs on the board (spec §2). */
const ON_BOARD = 'FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 AND u.name IS NOT NULL';

export const TOP = 50;

export async function boardTotal(db: Db): Promise<number> {
  return (await db.prepare(`SELECT count(*) AS n ${ON_BOARD}`).first<{ n: number }>())?.n ?? 0;
}

/** 1 + the board runs that beat (ms, finishedAt): faster, or as fast and finished earlier. */
export async function rankOf(db: Db, ms: number, finishedAt: number): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n ${ON_BOARD} AND (g.ms < ?1 OR (g.ms = ?1 AND g.finished_at < ?2))`)
    .bind(ms, finishedAt)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export interface BestRun {
  id: string;
  ms: number;
  finished_at: number;
}

/** The player's best ranked run: fastest, then earliest. */
export function bestOf(db: Db, userId: number): Promise<BestRun | null> {
  return db.prepare('SELECT id, ms, finished_at FROM games WHERE user_id = ? AND ranked = 1 ORDER BY ms, finished_at LIMIT 1').bind(userId).first<BestRun>();
}
```

- [ ] **Step 4: Write `worker/routes/games.ts`**

```ts
import { MAX_CLAIMS_PER_REQUEST, type ClaimResponse, type FinishResult, type StartResponse } from '../../src/api/types.js';
import { judge, type UnrankedReason } from '../../src/core/judge.js';
import { parseLog } from '../../src/core/log.js';
import { GRID } from '../../src/core/mask.js';
import { GEN_VERSION } from '../../src/core/seeded.js';
import { hmac, randomSeed, randomToken } from '../lib/crypto.js';
import type { AppEnv, Ctx } from '../lib/env.js';
import { clientIp, HttpError, json, readJson } from '../lib/http.js';
import { bestOf, boardTotal, rankOf } from '../lib/ranks.js';
import { authSecret, currentUser, requireUser } from '../lib/users.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const STARTS_PER_HOUR = 200;
/** Finished games nobody has claimed are kept this long, so signing in later on the same browser still finds them. */
export const UNCLAIMED_KEEP_DAYS = 90;
/** Each start clears at most this many stale games of each kind: up to 50 in all (spec §2). */
const STALE_BATCH = 25;
export const GAME_ID = /^[A-Za-z0-9_-]{16,64}$/;

interface GameRow {
  id: string;
  user_id: number | null;
  claim_hash: string | null;
  gen_version: number;
  seed: number;
  started_at: number;
  finished_at: number | null;
  ms: number | null;
  ranked: number;
  unranked_reason: UnrankedReason | null;
}
type FinishedGame = GameRow & { finished_at: number; ms: number };
const COLUMNS = 'id, user_id, claim_hash, gen_version, seed, started_at, finished_at, ms, ranked, unranked_reason';
const finished = (g: GameRow): g is FinishedGame => g.finished_at !== null && g.ms !== null;
const notFound = () => new HttpError(404, 'not_found', "That game isn't on record.");

/** POST /api/games {} */
export async function startGame(req: Request, env: AppEnv): Promise<Response> {
  const secret = authSecret(env);
  await readJson(req);
  const ipHash = await hmac(secret, `ip:${clientIp(req)}`);
  const recent = await env.DB.prepare('SELECT count(*) AS n FROM games WHERE ip_hash = ? AND started_at > ?').bind(ipHash, Date.now() - HOUR_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= STARTS_PER_HOUR) throw new HttpError(429, 'rate_limited', 'Too many games from here. Try again in a bit.');

  const user = await currentUser(req, env);
  const id = randomToken(16);
  const seed = randomSeed();
  const claim = user ? null : randomToken(24);
  const claimHash = claim && (await hmac(secret, `claim:${claim}`));
  // Stamped last, right before the insert, so nothing above counts against the player's clock.
  const now = Date.now();
  await env.DB.batch([
    // Lazy housekeeping (no cron): abandoned games after a day, unclaimed finished games after 90 days.
    env.DB.prepare('DELETE FROM games WHERE id IN (SELECT id FROM games WHERE finished_at IS NULL AND started_at < ? LIMIT ?)').bind(now - DAY_MS, STALE_BATCH),
    env.DB.prepare('DELETE FROM games WHERE id IN (SELECT id FROM games WHERE user_id IS NULL AND finished_at < ? LIMIT ?)').bind(now - UNCLAIMED_KEEP_DAYS * DAY_MS, STALE_BATCH),
    env.DB.prepare('INSERT INTO games (id, user_id, claim_hash, ip_hash, gen_version, seed, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      user?.id ?? null,
      claimHash,
      ipHash,
      GEN_VERSION,
      seed,
      now,
    ),
  ]);
  return json({ id, seed, genVersion: GEN_VERSION, claim } satisfies StartResponse);
}

/** What the browser shows for a finished game. */
async function resultOf(env: AppEnv, g: FinishedGame): Promise<FinishResult> {
  const placed = g.ranked === 1 || g.unranked_reason === 'anonymous';
  const [total, rank, best] = await Promise.all([
    boardTotal(env.DB),
    placed ? rankOf(env.DB, g.ms, g.finished_at) : Promise.resolve(null),
    g.user_id === null ? Promise.resolve(null) : bestOf(env.DB, g.user_id),
  ]);
  return { id: g.id, ranked: g.ranked === 1, reason: g.unranked_reason, ms: g.ms, rank, total, best: best?.ms ?? null, newBest: g.ranked === 1 && best?.id === g.id };
}

/** POST /api/games/:id/finish { log } */
export async function finishGame(req: Request, env: AppEnv, _ctx: Ctx, [id]: readonly string[]): Promise<Response> {
  const receivedAt = Date.now();
  const body = await readJson(req);
  const game = await env.DB.prepare(`SELECT ${COLUMNS} FROM games WHERE id = ?`).bind(id).first<GameRow>();
  if (!game) throw notFound();
  // A retry after a lost response: answer what was saved (the id is a bearer secret).
  if (finished(game)) return json(await resultOf(env, game));

  const log = parseLog(body.log, GRID);
  const verdict = log && judge({ seed: game.seed, genVersion: game.gen_version, log, serverElapsedMs: receivedAt - game.started_at });
  if (!log || !verdict) {
    await env.DB.prepare('DELETE FROM games WHERE id = ? AND finished_at IS NULL').bind(id).run();
    throw new HttpError(422, 'unverified', "This run couldn't be verified.");
  }
  // Everything checks out but nobody owns it yet: it ranks once claimed.
  const reason: UnrankedReason | null = verdict.reason ?? (game.user_id === null ? 'anonymous' : null);
  const ranked = reason === null ? 1 : 0;
  const saved = await env.DB.prepare(
    'UPDATE games SET finished_at = ?, ms = ?, paused_ms = ?, pauses = ?, ranked = ?, unranked_reason = ?, log = ? WHERE id = ? AND finished_at IS NULL',
  )
    .bind(receivedAt, verdict.ms, verdict.pausedMs, verdict.pauses, ranked, reason, JSON.stringify(log), id)
    .run();
  if (saved.meta.changes === 0) {
    // Lost a race with another finish of the same game: answer what that one saved.
    const now = await env.DB.prepare(`SELECT ${COLUMNS} FROM games WHERE id = ?`).bind(id).first<GameRow>();
    if (now && finished(now)) return json(await resultOf(env, now));
    throw notFound();
  }
  return json(await resultOf(env, { ...game, finished_at: receivedAt, ms: verdict.ms, ranked, unranked_reason: reason }));
}

/** POST /api/games/claim { claims: [{ id, claim }] }: finished signed-out games join the account, 8 at a time. */
export async function claimGames(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const secret = authSecret(env);
  const body = await readJson(req);
  const claims = Array.isArray(body.claims) ? (body.claims as unknown[]).slice(0, MAX_CLAIMS_PER_REQUEST) : [];
  const claimed: FinishedGame[] = [];
  for (const c of claims) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, claim } = c as Record<string, unknown>;
    if (typeof id !== 'string' || typeof claim !== 'string' || !GAME_ID.test(id)) continue;
    const game = await env.DB.prepare(`SELECT ${COLUMNS} FROM games WHERE id = ? AND user_id IS NULL`).bind(id).first<GameRow>();
    if (!game || !finished(game) || game.claim_hash === null || game.claim_hash !== (await hmac(secret, `claim:${claim}`))) continue;
    const ranks = game.unranked_reason === 'anonymous';
    const owned: FinishedGame = { ...game, user_id: user.id, claim_hash: null, ranked: ranks ? 1 : game.ranked, unranked_reason: ranks ? null : game.unranked_reason };
    const res = await env.DB.prepare('UPDATE games SET user_id = ?, claim_hash = NULL, ranked = ?, unranked_reason = ? WHERE id = ? AND user_id IS NULL')
      .bind(user.id, owned.ranked, owned.unranked_reason, id)
      .run();
    if (res.meta.changes > 0) claimed.push(owned);
  }
  // Results after every claim, so best and newBest reflect the whole batch.
  const results = await Promise.all(claimed.map((g) => resultOf(env, g)));
  return json({ results } satisfies ClaimResponse);
}
```

- [ ] **Step 5: Add the routes**

In `worker/router.ts`, add `import * as games from './routes/games.js';` and, after the `/api/me` routes:

```ts
  ['POST', /^\/api\/games$/, games.startGame],
  ['POST', /^\/api\/games\/claim$/, games.claimGames],
  ['POST', /^\/api\/games\/([A-Za-z0-9_-]{16,64})\/finish$/, games.finishGame],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/worker tests/unit/worker && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker tests/worker tests/unit/worker
git commit -m "feat(games): server-seeded starts, replay-verified finishes, claims, rate limit and housekeeping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leaderboard and Your games queries

`GET /api/board` (the top 50 runs, several per player allowed, ties sharing a rank, your best pinned when outside the top 50, `private, max-age=15`) and `GET /api/me/games` (best run with its rank, how many of the top 50 are yours, the last 30 games).

**Files:**
- Create: `worker/routes/board.ts`, `tests/worker/board.test.ts`
- Modify: `worker/lib/ranks.ts`, `worker/routes/me.ts`, `worker/router.ts`

**Interfaces:**
- Consumes: Task 4 `boardTotal`, `rankOf`, `bestOf`, `TOP`; Task 3 `currentUser`, `requireUser`, `BoardRow`, `BoardResponse`, `MyGamesResponse`, `RecentGame`, harness `signIn`.
- Produces: `worker/lib/ranks.ts` adds `TOP_SQL`, `interface TopRow { id: string; user_id: number; name: string; ms: number; finished_at: number }`, `topRuns(db): Promise<TopRow[]>`, `rankRows(rows): number[]`; handlers `getBoard` (board.ts) and `myGames` (me.ts).

- [ ] **Step 1: Write the failing tests**

`tests/worker/board.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BoardResponse, MyGamesResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { TOP_SQL } from '../../worker/lib/ranks';
import { call, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
let env: AppEnv;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
  env = testEnv(db);
}, 30_000);
afterAll(() => dispose());
beforeEach(() => wipe(db));

/** A user as fake sign-in would create them (google_sub "fake:<email>"), so signIn() finds the same account. */
async function user(email: string, name: string | null): Promise<number> {
  const row = await db
    .prepare('INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES (?, ?, ?, ?, 1) RETURNING id')
    .bind(`fake:${email}`, email, name, name === null ? null : name.toLowerCase())
    .first<{ id: number }>();
  if (!row) throw new Error('no user');
  return row.id;
}
let runs = 0;
/** A finished game straight into D1. */
async function run(userId: number | null, ms: number, finishedAt: number, reason: string | null = null): Promise<string> {
  const id = `run-${String(++runs).padStart(16, '0')}`;
  await db
    .prepare('INSERT INTO games (id, user_id, ip_hash, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason) VALUES (?, ?, ?, 1, 1, ?, ?, ?, 0, 0, ?, ?)')
    .bind(id, userId, 'ip', finishedAt - ms, finishedAt, ms, reason === null ? 1 : 0, reason)
    .run();
  return id;
}
const board = async (cookie?: string): Promise<BoardResponse> => (await (await call(env, 'GET', '/api/board', { cookie })).json()) as BoardResponse;
const myGames = async (cookie?: string): Promise<MyGamesResponse> => (await (await call(env, 'GET', '/api/me/games', { cookie })).json()) as MyGamesResponse;

describe('the leaderboard', () => {
  it('is empty at first, with a short private cache', async () => {
    const res = await call(env, 'GET', '/api/board');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
    expect(await res.json()).toEqual({ rows: [], total: 0, you: null });
  });

  it('lists runs fastest first, ties to the earlier finish, several per player; unranked runs and unnamed players are left off', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const bo = await user('bo@example.com', 'Comet');
    const nameless = await user('cy@example.com', null);
    await run(ana, 60_000, 5000);
    await run(bo, 50_000, 4000);
    await run(ana, 50_000, 3000);
    await run(nameless, 10_000, 1000);
    await run(bo, 1_000, 2000, 'paused');
    await run(null, 1_000, 1000, 'anonymous');
    const b = await board();
    expect(b.total).toBe(3);
    expect(b.rows).toEqual([
      { rank: 1, name: 'Meridian', ms: 50_000, finishedAt: 3000, mine: false },
      { rank: 2, name: 'Comet', ms: 50_000, finishedAt: 4000, mine: false },
      { rank: 3, name: 'Meridian', ms: 60_000, finishedAt: 5000, mine: false },
    ]);
  });

  it('runs with the same time and finish share a rank', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const bo = await user('bo@example.com', 'Comet');
    await run(ana, 50_000, 3000);
    await run(bo, 50_000, 3000);
    await run(bo, 70_000, 3000);
    expect((await board()).rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('marks your runs, and pins your best below the list when it is outside the top 50', async () => {
    const bo = await user('bo@example.com', 'Comet');
    await db.batch(
      Array.from({ length: 50 }, (_, k) =>
        db
          .prepare("INSERT INTO games (id, user_id, ip_hash, gen_version, seed, started_at, finished_at, ms, ranked) VALUES (?, ?, 'ip', 1, 1, 0, ?, ?, 1)")
          .bind(`fast-${String(k).padStart(16, '0')}`, bo, 1000 + k, 10_000 + k),
      ),
    );
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 99_000, 5000);
    await run(ana, 98_000, 6000);
    const cookie = await signIn(env, 'ana@example.com');
    const b = await board(cookie);
    expect(b.rows).toHaveLength(50);
    expect(b.rows.some((r) => r.mine)).toBe(false);
    expect(b.total).toBe(52);
    expect(b.you).toEqual({ rank: 51, name: 'Meridian', ms: 98_000, finishedAt: 6000, mine: true });
    await run(ana, 5_000, 7000);
    const again = await board(cookie);
    expect(again.rows[0]).toEqual({ rank: 1, name: 'Meridian', ms: 5_000, finishedAt: 7000, mine: true });
    expect(again.you).toBeNull();
  });

  it('reads the top 50 through the board index', async () => {
    expect(JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${TOP_SQL}`).all()).results)).toContain('games_board');
  });
});

describe('your games', () => {
  it('needs a session', async () => {
    expect((await call(env, 'GET', '/api/me/games')).status).toBe(401);
  });

  it('your best with its rank, how many of the top 50 are yours, and recent games newest first', async () => {
    const bo = await user('bo@example.com', 'Comet');
    const ana = await user('ana@example.com', 'Meridian');
    await run(bo, 40_000, 1000);
    const best = await run(ana, 45_000, 2000);
    const slower = await run(ana, 60_000, 3000);
    const clock = await run(ana, 30_000, 4000, 'clock');
    const cookie = await signIn(env, 'ana@example.com');
    expect(await myGames(cookie)).toEqual({
      best: { ms: 45_000, rank: 2, finishedAt: 2000 },
      inTop: 2,
      total: 3,
      games: [
        { id: clock, ms: 30_000, finishedAt: 4000, ranked: false, reason: 'clock', isBest: false },
        { id: slower, ms: 60_000, finishedAt: 3000, ranked: true, reason: null, isBest: false },
        { id: best, ms: 45_000, finishedAt: 2000, ranked: true, reason: null, isBest: true },
      ],
    });
  });

  it('keeps the last 30 games; an account without a name has no rank and nothing in the top 50', async () => {
    const cy = await user('cy@example.com', null);
    for (let k = 0; k < 31; k++) await run(cy, 50_000 + k, 1000 + k);
    const g = await myGames(await signIn(env, 'cy@example.com'));
    expect(g.games).toHaveLength(30);
    expect(g.games[0].finishedAt).toBe(1030);
    expect(g).toMatchObject({ best: { ms: 50_000, rank: null }, inTop: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/worker/board.test.ts`
Expected: FAIL: `TOP_SQL` is not exported; `/api/board` and `/api/me/games` are 404.

- [ ] **Step 3: Add the top-50 query to `worker/lib/ranks.ts`**

Append:

```ts
/** The top 50 runs: fastest, then earliest. Reads games_board (a partial index on ranked runs) in order. */
export const TOP_SQL = `SELECT g.id, g.user_id, u.name, g.ms, g.finished_at ${ON_BOARD} ORDER BY g.ms, g.finished_at, g.id LIMIT ${TOP}`;

export interface TopRow {
  id: string;
  user_id: number;
  name: string;
  ms: number;
  finished_at: number;
}

export async function topRuns(db: Db): Promise<TopRow[]> {
  return (await db.prepare(TOP_SQL).all<TopRow>()).results;
}

/** Ranks for rows in board order: a run tied with the one above (same ms and finish) shares its rank (spec §2's formula). */
export function rankRows(rows: readonly { ms: number; finished_at: number }[]): number[] {
  const ranks: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    ranks.push(prev && prev.ms === r.ms && prev.finished_at === r.finished_at ? ranks[i - 1] : i + 1);
  });
  return ranks;
}
```

- [ ] **Step 4: Write `worker/routes/board.ts`**

```ts
import type { BoardResponse, BoardRow } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { json } from '../lib/http.js';
import { bestOf, boardTotal, rankOf, rankRows, topRuns } from '../lib/ranks.js';
import { currentUser } from '../lib/users.js';

/** GET /api/board: the all-time top 50 runs. Varies with the cookie (your rows), so the cache is private and short. */
export async function getBoard(req: Request, env: AppEnv): Promise<Response> {
  const user = await currentUser(req, env);
  const [top, total] = await Promise.all([topRuns(env.DB), boardTotal(env.DB)]);
  const ranks = rankRows(top);
  const rows: BoardRow[] = top.map((r, i) => ({ rank: ranks[i], name: r.name, ms: r.ms, finishedAt: r.finished_at, mine: user !== null && r.user_id === user.id }));
  let you: BoardRow | null = null;
  if (user?.name && !rows.some((r) => r.mine)) {
    const best = await bestOf(env.DB, user.id);
    if (best) you = { rank: await rankOf(env.DB, best.ms, best.finished_at), name: user.name, ms: best.ms, finishedAt: best.finished_at, mine: true };
  }
  return json({ rows, total, you } satisfies BoardResponse, { headers: { 'Cache-Control': 'private, max-age=15' } });
}
```

- [ ] **Step 5: Add `myGames` to `worker/routes/me.ts`**

Add to the imports: `import type { MyGamesResponse, RecentGame, UnrankedReason } from '../../src/api/types.js';` (merge with the existing `MeResponse` import) and `import { bestOf, boardTotal, rankOf, topRuns, type TopRow } from '../lib/ranks.js';`, then append:

```ts
interface RecentRow {
  id: string;
  ms: number;
  finished_at: number;
  ranked: number;
  unranked_reason: UnrankedReason | null;
}

/** GET /api/me/games: your best and its rank, how many of the top 50 are yours, and your last 30 games. */
export async function myGames(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const [best, recent, top, total] = await Promise.all([
    bestOf(env.DB, user.id),
    env.DB.prepare('SELECT id, ms, finished_at, ranked, unranked_reason FROM games WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 30')
      .bind(user.id)
      .all<RecentRow>(),
    user.name ? topRuns(env.DB) : Promise.resolve<TopRow[]>([]),
    boardTotal(env.DB),
  ]);
  const rank = best && user.name ? await rankOf(env.DB, best.ms, best.finished_at) : null;
  const games: RecentGame[] = recent.results.map((g) => ({
    id: g.id,
    ms: g.ms,
    finishedAt: g.finished_at,
    ranked: g.ranked === 1,
    reason: g.unranked_reason,
    isBest: g.id === best?.id,
  }));
  return json({
    best: best && { ms: best.ms, rank, finishedAt: best.finished_at },
    inTop: top.filter((r) => r.user_id === user.id).length,
    total,
    games,
  } satisfies MyGamesResponse);
}
```

- [ ] **Step 6: Add the routes**

In `worker/router.ts`, add `import * as board from './routes/board.js';` and these routes (after the `/api/me` DELETE route and after the games routes respectively):

```ts
  ['GET', /^\/api\/me\/games$/, me.myGames],
```

```ts
  ['GET', /^\/api\/board$/, board.getBoard],
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/worker && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker tests/worker
git commit -m "feat(board): all-time top 50 runs with shared ranks and a pinned best; Your games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The radio admin moves to Luke's Google account

`/api/admin/*` now needs a session whose verified email is in `ADMIN_EMAILS` (401 signed out, 403 any other account). The password admin goes: `ADMIN_PASSWORD`, `SESSION_SECRET`, the `aglow_admin` cookie, `worker/lib/session.ts`, `LOGIN_LIMITER` (and the in-memory limiter that only login used), `POST /api/admin/login`, `POST /api/admin/logout` and the password screen. The `/admin` page shows a "Sign in with Google" card, "Not authorized", or the editor; a 401 or 403 mid-session keeps unsaved edits, as today.

**Files:**
- Delete: `worker/lib/session.ts`, `worker/lib/ratelimit.ts`, `worker/routes/admin/login.ts`, `worker/routes/admin/logout.ts`, `tests/unit/worker/session.test.ts`, `tests/unit/worker/ratelimit.test.ts`
- Move: `tests/unit/worker/handlers.test.ts` → `tests/worker/admin.test.ts` (then edit)
- Modify: `worker/lib/http.ts`, `worker/lib/env.ts`, `worker/index.ts`, `worker/router.ts`, `worker/routes/admin/session.ts`, `worker/routes/admin/stations.ts`, `worker/routes/admin/upload.ts`, `wrangler.jsonc`, `.dev.vars.example`, `package.json` (`dev:full`), `src/admin/api.ts`, `src/admin/main.ts`, `src/admin/admin.css`, `tests/e2e/admin.spec.ts`, `tests/unit/worker/imports.test.ts`, `README.md` (Radio admin section)

**Interfaces:**
- Consumes: Task 3 `requireAdmin(req, env): Promise<SessionUser>` (throws `HttpError` 401 `signed_out` / 403 `forbidden`), harness `signIn`, `testEnv` (`ADMIN_EMAILS: 'admin@example.com'`).
- Produces: `GET /api/admin/session` → 200 `{ admin: true, name: string | null }` (else 401/403 JSON); admin client `api.session()`, `api.signOut()`, `SIGN_IN_HREF`; npm script `dev:full`.

- [ ] **Step 1: Move the handler tests onto the D1 harness and rewrite their auth parts**

Run `git mv tests/unit/worker/handlers.test.ts tests/worker/admin.test.ts`, then in `tests/worker/admin.test.ts`:

1. Replace everything from the first line down to (but not including) `describe('admin stations', () => {` with:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUrl, type StationsFile } from '../../src/radio/schema';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { resetPublicCache } from '../../worker/lib/public-stations';
import { CURRENT } from '../../worker/lib/stations-store';
import { handle } from '../../worker/router';
import { FakeBucket } from '../unit/worker/fake-bucket';
import { signIn, startDb, testEnv, wipe } from './harness';

/** Fake sign-in only works on localhost. */
const SITE = 'http://localhost';
const ADMIN = 'admin@example.com';
const B = 'https://aglow-music.example';
const CONFLICT = 'Stations changed somewhere else. Reload to get the latest, then redo your change.';
const MB = 1024 * 1024;

const v3: StationsFile = {
  version: 3,
  stations: [
    {
      id: 'christmas-jazz',
      name: 'Christmas Jazz',
      description: '',
      cover: `${B}/covers/christmas-jazz/c.png`,
      tracks: [
        { id: 'a', url: `${B}/tracks/christmas-jazz/a.mp3`, title: 'A', artist: '', credit: '', duration: 1 },
        { id: 'b', url: `${B}/tracks/christmas-jazz/b%20b.mp3`, title: 'B', artist: '', credit: '', duration: 1 },
      ],
    },
  ],
};
const onlyB = () => [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];

let db: Db;
let dispose: () => Promise<void>;
let bucket: FakeBucket;
let pending: Promise<unknown>[];
let adminCookie = '';
beforeAll(async () => {
  ({ db, dispose } = await startDb());
}, 30_000);
afterAll(() => dispose());

const env = (over: Partial<AppEnv> = {}): AppEnv => testEnv(db, { MUSIC: bucket, MUSIC_BASE_URL: B, ADMIN_EMAILS: ADMIN, ...over });
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
const call = (req: Request, e: AppEnv = env()) => handle(req, e, ctx);
const settle = () => Promise.all(pending);

interface ReqOpts {
  headers?: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  /** Send the site's own Origin (default for anything but GET), none, or another one. */
  origin?: string | null;
}
function req(method: string, path: string, { headers = {}, body, origin }: ReqOpts = {}): Request {
  const o = origin === undefined ? (method === 'GET' ? null : SITE) : origin;
  const type = method !== 'GET' && !path.startsWith('/api/admin/upload') ? { 'content-type': 'application/json' } : {};
  return new Request(`${SITE}${path}`, { method, headers: { ...type, ...(o === null ? {} : { origin: o }), ...headers }, body });
}
/** The admin's session (fake Google sign-in as an ADMIN_EMAILS address). */
const authed = async (extra: Record<string, string> = {}) => ({ cookie: adminCookie, ...extra });
const putStations = async (body: unknown, opts: ReqOpts = {}) =>
  call(req('PUT', '/api/admin/stations', { ...opts, headers: { ...(await authed()), ...opts.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const stored = (): StationsFile => JSON.parse(bucket.text(CURRENT) ?? 'null') as StationsFile;

beforeEach(async () => {
  await wipe(db);
  bucket = new FakeBucket();
  bucket.seed(CURRENT, JSON.stringify(v3), { contentType: 'application/json' });
  for (const k of ['tracks/christmas-jazz/a.mp3', 'tracks/christmas-jazz/b b.mp3', 'covers/christmas-jazz/c.png']) bucket.seed(k, 'media');
  pending = [];
  resetPublicCache();
  adminCookie = await signIn(env(), ADMIN);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('routing', () => {
  it('serves every admin route; signed-out callers get 401 JSON', async () => {
    const table: [string, string, number][] = [
      ['GET', '/api/stations', 200],
      ['GET', '/api/admin/session', 401],
      ['GET', '/api/admin/stations', 401],
      ['PUT', '/api/admin/stations', 401],
      ['PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3', 401],
    ];
    for (const [method, path, status] of table) {
      const headers = path.startsWith('/api/admin/upload') ? { 'content-type': 'audio/mpeg' } : {};
      const r = await call(req(method, path, { headers, body: method === 'GET' ? undefined : '{}' }));
      expect(r.status, `${method} ${path}`).toBe(status);
      expect(r.headers.get('content-type'), `${method} ${path}`).toMatch(/^application\/json/);
    }
  });
  it('the password routes are gone', async () => {
    for (const path of ['/api/admin/login', '/api/admin/logout']) expect((await call(req('POST', path, { body: '{}' }))).status, path).toBe(404);
  });
  it('answers 404 JSON, never cached, for unknown /api paths', async () => {
    for (const path of ['/api/nope', '/api/stations/', '/api/admin', '/api/admin/', '/api/admin/upload-token', '/api/__proto__', '/api/admin/constructor', '/']) {
      const r = await call(req('GET', path));
      expect(r.status, path).toBe(404);
      expect(r.headers.get('cache-control'), path).toBe('no-store');
      expect(await r.json(), path).toEqual({ error: 'not_found', message: 'Not found' });
    }
  });
  it('answers 405, never cached and with Allow, for a known path with the wrong method', async () => {
    const cases: [string, string, string][] = [
      ['POST', '/api/stations', 'GET'],
      ['HEAD', '/api/stations', 'GET'],
      ['POST', '/api/admin/session', 'GET'],
      ['DELETE', '/api/admin/stations', 'GET, PUT'],
      ['POST', '/api/admin/stations', 'GET, PUT'],
      ['GET', '/api/admin/upload', 'PUT'],
      ['POST', '/api/admin/upload', 'PUT'],
    ];
    for (const [method, path, allow] of cases) {
      const r = await call(req(method, path));
      expect(r.status, `${method} ${path}`).toBe(405);
      expect(r.headers.get('cache-control'), `${method} ${path}`).toBe('no-store');
      expect(r.headers.get('allow'), `${method} ${path}`).toBe(allow);
    }
  });
  it('turns an unexpected error into a 503, never a 500', async () => {
    const broken = new Proxy(env(), {
      get(target, p, receiver) {
        if (p === 'ADMIN_EMAILS') throw new Error('boom');
        return Reflect.get(target, p, receiver) as unknown;
      },
    });
    const r = await call(req('GET', '/api/admin/session', { headers: await authed() }), broken);
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('logs the route, method and error class of an unexpected error, never its message, body, cookie or secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const secret = env().AUTH_SECRET ?? '';
      const broken = new Proxy(env(), {
        get(target, p, receiver) {
          if (p === 'ADMIN_EMAILS') throw new RangeError(`boom ${secret}`);
          return Reflect.get(target, p, receiver) as unknown;
        },
      });
      const headers = await authed({ 'content-type': 'audio/mpeg' });
      const r = await call(req('PUT', '/api/admin/upload?folder=tracks&station=x&name=secret-name.mp3', { headers, body: 'private body' }), broken);
      expect(r.status).toBe(503);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toEqual(['api', '/api/admin/upload', 'PUT', 'RangeError']);
      const logged = JSON.stringify(log.mock.calls);
      for (const leak of ['boom', secret, 'private body', adminCookie, 'secret-name']) expect(logged).not.toContain(leak);
      expect(JSON.stringify(await r.json())).not.toContain('boom');

      log.mockClear();
      const odd = new Proxy(env(), {
        get() {
          throw 'a thrown string';
        },
      });
      expect((await call(req('GET', '/api/admin/session'), odd)).status).toBe(503);
      expect(log.mock.calls).toEqual([['api', '/api/admin/session', 'GET', 'error']]);
    } finally {
      log.mockRestore();
    }
  });
});

describe('origin check', () => {
  const writes: [string, string][] = [
    ['PUT', '/api/admin/stations'],
    ['PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3'],
    ['POST', '/api/auth/signout'],
    ['DELETE', '/api/me'],
  ];
  it('refuses writes without an Origin header, or from another origin, even with a session', async () => {
    for (const [method, path] of writes) {
      const type = path.startsWith('/api/admin/upload') ? 'audio/mpeg' : 'application/json';
      for (const origin of [null, 'https://evil.example', 'null', 'https://localhost', 'http://localhost:444']) {
        const r = await call(req(method, path, { origin, headers: await authed({ 'content-type': type, 'content-length': '2' }), body: '{}' }));
        expect(r.status, `${method} ${path} ${origin}`).toBe(403);
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('set-cookie')).toBeNull();
      }
    }
    expect(stored()).toEqual(v3);
  });
  it('does not apply to reads', async () => {
    expect((await call(req('GET', '/api/admin/stations', { headers: await authed() }))).status).toBe(200);
    expect((await call(req('GET', '/api/stations', { origin: 'https://evil.example' }))).status).toBe(200);
  });
});

describe('write checks and fake mode', () => {
  it('refuses a write that is not JSON anywhere but the raw-audio upload', async () => {
    const r = await call(req('PUT', '/api/admin/stations', { headers: { ...(await authed()), 'content-type': 'text/plain' }, body: '{}' }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'forbidden', message: 'Cross-origin request refused' });
    expect(stored()).toEqual(v3);
  });
  it('refuses every request with 500 misconfigured when fake sign-in is set on a non-local host', async () => {
    const r = await handle(new Request('https://aglow.example/api/stations'), env(), ctx);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'misconfigured', message: 'Sign-in is misconfigured.' });
    expect((await call(req('GET', '/api/stations'))).status).toBe(200);
  });
});

describe('admin session', () => {
  it('401 signed out, 403 for an account not in ADMIN_EMAILS, 200 for the admin', async () => {
    const out = await call(req('GET', '/api/admin/session'));
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: 'signed_out', message: 'Sign in first.' });
    const other = await signIn(env(), 'someone@example.com');
    const no = await call(req('GET', '/api/admin/session', { headers: { cookie: other } }));
    expect(no.status).toBe(403);
    expect(await no.json()).toEqual({ error: 'forbidden', message: 'This account is not the radio admin.' });
    const yes = await call(req('GET', '/api/admin/session', { headers: await authed() }));
    expect(yes.status).toBe(200);
    expect(await yes.json()).toEqual({ admin: true, name: null });
    expect(yes.headers.get('cache-control')).toBe('no-store');
  });
  it('matches ADMIN_EMAILS in any case, as a comma-separated list; nobody is the admin without it', async () => {
    const headers = await authed();
    expect((await call(req('GET', '/api/admin/session', { headers }), env({ ADMIN_EMAILS: ' other@example.com , ADMIN@Example.com ' }))).status).toBe(200);
    expect((await call(req('GET', '/api/admin/session', { headers }), env({ ADMIN_EMAILS: undefined }))).status).toBe(403);
  });
  it('answers 503 not_configured, never the editor, when AUTH_SECRET is unset', async () => {
    const r = await call(req('GET', '/api/admin/stations', { headers: await authed() }), env({ AUTH_SECRET: undefined }));
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('not_configured');
  });
});

```

2. In `describe('admin stations')`, replace the two tests `'requires a session'` and `'answers 503 instead of failing when a secret is unset'` with:

```ts
  it('requires the admin: 401 signed out, 403 for another account, and touches nothing', async () => {
    const other = await signIn(env(), 'someone@example.com');
    const cases: [Record<string, string>, number][] = [
      [{}, 401],
      [{ cookie: other }, 403],
    ];
    for (const [headers, status] of cases) {
      const get = await call(req('GET', '/api/admin/stations', { headers }));
      const put = await call(req('PUT', '/api/admin/stations', { headers, body: JSON.stringify({ expectedVersion: 3, stations: [] }) }));
      for (const r of [get, put]) {
        expect(r.status).toBe(status);
        expect(r.headers.get('cache-control')).toBe('no-store');
      }
    }
    expect(stored()).toEqual(v3);
  });
```

3. In `describe('uploads')`, replace the test `'requires a session (401), and answers 503 when a secret is unset, without touching the bucket'` with:

```ts
  it('requires the admin (401 signed out or forged, 403 for another account) without touching the bucket', async () => {
    const put = vi.spyOn(bucket, 'put');
    const q = 'folder=tracks&station=christmas-jazz&name=a.mp3';
    expect((await up(q, { headers: {} })).status).toBe(401);
    expect((await up(q, { headers: { cookie: `__Host-aglow_session=${'x'.repeat(43)}` } })).status).toBe(401);
    expect((await up(q, { headers: { cookie: await signIn(env(), 'someone@example.com') } })).status).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });
```

Everything else in the file stays as it is. Delete `tests/unit/worker/session.test.ts` and `tests/unit/worker/ratelimit.test.ts`. In `tests/unit/worker/imports.test.ts`, replace `expect(rel).toContain('worker/lib/session.ts');` with `expect(rel).toContain('worker/lib/users.ts');`.

- [ ] **Step 2: Update the admin page's e2e tests**

In `tests/e2e/admin.spec.ts`, replace the test `'admin page loads and asks for sign-in'` with these two:

```ts
test('admin page loads and asks for Google sign-in', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 401, json: { error: 'signed_out', message: 'Sign in first.' } }));
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Radio admin' })).toBeVisible();
  const google = page.getByRole('link', { name: 'Sign in with Google' });
  await expect(google).toBeFocused();
  await expect(google).toHaveAttribute('href', '/api/auth/google?return=%2Fadmin');
  await expect(google).not.toHaveAttribute('target', '_blank');
});

test('another Google account is told it is not authorized', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 403, json: { error: 'forbidden', message: 'This account is not the radio admin.' } }));
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another account' })).toBeFocused();
});
```

and replace the test `'an expired session goes back to sign-in and keeps the unsaved edits'` with:

```ts
test('an expired session goes back to sign-in and keeps the unsaved edits', async ({ page }) => {
  const api = await admin(page);
  await page.getByLabel('Track 1 title').fill('Sleigh Ride (Mono)');
  api.putStatus = { status: 401, error: 'Not signed in' };
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toHaveText('Your session expired. Sign in again.');
  // Leaving would lose the edits: Google opens in a new tab, and Continue checks again.
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('target', '_blank');
  const gets = api.gets;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Track 1 title')).toHaveValue('Sleigh Ride (Mono)');
  expect(api.gets).toBe(gets); // no load() over the edits
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v7 · unsaved changes');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/worker/admin.test.ts`
Expected: FAIL: `/api/admin/session` still answers `{ admin: false }` (200) signed out, the password routes still exist, and the admin routes refuse the Google session.

- [ ] **Step 4: Switch the Worker to the Google admin**

Delete `worker/lib/session.ts`, `worker/lib/ratelimit.ts`, `worker/routes/admin/login.ts` and `worker/routes/admin/logout.ts`.

In `worker/lib/http.ts`, delete the `import { adminSecrets, isAdmin } from './session.js';` line and the whole `requireAdmin` function (keep `notConfigured`: the upload route still answers it when `MUSIC_BASE_URL` is unusable).

In `worker/lib/env.ts`, delete `RateLimitBinding` and the `ADMIN_PASSWORD`, `SESSION_SECRET` and `LOGIN_LIMITER` members of `AppEnv`.

In `worker/index.ts`, delete those three members of `Env`, the `RateLimitBinding` import and `export type LimiterCheck …`. `Env` is now:

```ts
export interface Env {
  /** R2 bucket "aglow-music": stations/current.json plus uploaded tracks/ and covers/. */
  MUSIC: R2Bucket;
  /** Public origin of the bucket (R2 custom domain), no trailing slash. */
  MUSIC_BASE_URL: string;
  /** D1 database "aglow": users, sessions and games (migrations/). */
  DB: D1Database;
  AUTH_MODE?: string;
  /** Secret: 256 random bits keying session, claim and IP hashes. */
  AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Secret, pasted by Luke. */
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAILS?: string;
}
```

In `worker/router.ts`, delete the `login` and `logout` imports and their two routes.

`worker/routes/admin/session.ts`:

```ts
import type { AppEnv } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { requireAdmin } from '../../lib/users.js';

/** GET /api/admin/session: 200 for the admin, 401 signed out, 403 any other account (the page shows the editor, sign-in or "Not authorized"). */
export async function GET(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireAdmin(req, env);
  return json({ admin: true, name: user.name });
}
```

In `worker/routes/admin/stations.ts`, import `requireAdmin` from `'../../lib/users.js'` (drop it from the `http.js` import) and replace both

```ts
  const denied = await requireAdmin(req, env);
  if (denied) return denied;
```

with `await requireAdmin(req, env);`. Do the same in `worker/routes/admin/upload.ts` (keep its `notConfigured` import from `http.js`).

In `wrangler.jsonc`, delete the `// Login attempts per IP …` comment and the `"ratelimits"` entry, and change the secrets comment line to:

```jsonc
  // Secrets (AUTH_SECRET, GOOGLE_CLIENT_SECRET) are never in this file: see .dev.vars.example.
```

Replace `.dev.vars.example` with:

```
# Local values for `wrangler dev` (npm run dev:full). Copy to .dev.vars (git-ignored). Never commit values.
# Production secrets are set with `wrangler secret put` during rollout, never written to a committed file.

# 256 random bits that nobody needs to read, e.g. the output of `openssl rand -hex 32`. Changing it signs everyone out.
AUTH_SECRET=
# fake: sign in as /api/auth/google?as=<email> (or the aglow_fake_as cookie) without Google. Localhost only.
AUTH_MODE=fake
# Who gets the radio admin locally.
ADMIN_EMAILS=admin@example.com
# Only for a real-Google local check (AUTH_MODE=google on http://localhost:4173): the Web client's secret, pasted by Luke.
GOOGLE_CLIENT_SECRET=
```

In `package.json` `scripts`, add:

```json
    "dev:full": "npm run build && wrangler d1 migrations apply aglow --local && wrangler dev --port 8787 --local-upstream localhost:8787",
```

- [ ] **Step 5: Run the Worker tests to verify they pass**

Run: `npx vitest run tests/worker tests/unit/worker && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Switch the admin page to Google sign-in**

In `src/admin/api.ts`, replace `errorText` and the `session`/`login`/`logout` entries, and add `SIGN_IN_HREF`:

```ts
/** The Worker's `{error, message}` (or an older route's `{error: text}`) as one line. */
const errorText = (data: unknown, status: number): string => {
  const o = typeof data === 'object' && data !== null ? (data as { error?: unknown; message?: unknown }) : {};
  if (typeof o.message === 'string' && o.message) return o.message;
  return typeof o.error === 'string' && o.error ? o.error : `Request failed (${status})`;
};
```

```ts
  /** 200 for the admin; otherwise an ApiError with status 401 (signed out) or 403 (another Google account). */
  session: () => call<{ admin: true; name: string | null }>('GET', '/api/admin/session'),
  signOut: () => call<Record<string, never>>('POST', '/api/auth/signout', {}),
```

```ts
/** "Sign in with Google": Google (fake sign-in locally), then back to /admin. */
export const SIGN_IN_HREF = `/api/auth/google?return=${encodeURIComponent('/admin')}`;
```

In `src/admin/main.ts`:

1. Import `SIGN_IN_HREF` with `ApiError, api, audioDuration`, and change the screen type to `let screen: 'boot' | 'signin' | 'denied' | 'editor' = 'boot';`.
2. Replace the whole `// ---------- session ----------` section (from the comment through the end of `signOut`) with:

```ts
// ---------- session (the admin's Google account, spec 2026-10-07 §4) ----------

/** A 401 or 403 from any admin call: the sign-in or not-authorized card, keeping everything in memory. */
function authLost(e: ApiError): void {
  queue.pause();
  if (e.status === 403) renderDenied();
  else if (screen !== 'signin') renderSignIn(SESSION_EXPIRED);
}
const isAuthLost = (e: unknown): e is ApiError => e instanceof ApiError && (e.status === 401 || e.status === 403);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function boot(): Promise<void> {
  try {
    await api.session();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) renderSignIn();
    else if (e instanceof ApiError && e.status === 403) renderDenied();
    else renderFatal(errText(e));
    return;
  }
  await loadAndRender();
}

function renderFatal(text: string): void {
  screen = 'boot';
  root.replaceChildren(
    h('div', { class: 'card' }, h('p', { class: 'err', textContent: text }), h('button', { textContent: 'Try again', onclick: () => void boot() })),
  );
}

/** Leaving the page would lose unsaved edits or uploads: then Google opens in a new tab and Continue checks again. */
const mustKeepPage = (): boolean => loaded && (dirty() || queue.busy);

function renderSignIn(message = ''): void {
  screen = 'signin';
  const keep = mustKeepPage();
  const google = h('a', { class: 'button primary', href: SIGN_IN_HREF, textContent: 'Sign in with Google' });
  if (keep) {
    google.target = '_blank';
    google.rel = 'noopener';
  }
  const err = h('p', { class: 'err', textContent: message, attrs: { role: 'alert' } });
  const card = h(
    'div',
    { class: 'card login' },
    h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'),
    h('h1', { textContent: 'Radio admin' }),
    google,
    err,
    h('p', { class: 'note', textContent: keep ? 'Sign in in the new tab, then come back and continue. Your unsaved changes are still here.' : "Sign in with the radio admin's Google account." }),
  );
  if (keep) card.append(h('button', { textContent: 'Continue', onclick: () => void recheck(err) }));
  root.replaceChildren(card);
  google.focus();
}

/** Continue, after signing in in another tab: back to the editor with everything kept, or why not. */
async function recheck(err: HTMLElement): Promise<void> {
  try {
    await api.session();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) renderDenied();
    else err.textContent = e instanceof ApiError && e.status === 401 ? 'Still signed out. Sign in in the other tab first.' : errText(e);
    return;
  }
  await afterLogin();
}

function renderDenied(): void {
  screen = 'denied';
  const other = h('button', { class: 'primary', textContent: 'Use another account', onclick: () => void signOut() });
  root.replaceChildren(
    h(
      'div',
      { class: 'card login' },
      h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'),
      h('h1', { textContent: 'Not authorized' }),
      h('p', { class: 'note', textContent: 'This Google account is not the radio admin.' }),
      other,
      h('a', { class: 'button', href: '/', textContent: 'Back to Aglow' }),
    ),
  );
  other.focus();
}

async function afterLogin(): Promise<void> {
  // Signing in again after an expired session keeps unsaved edits and finished uploads: never load() over them.
  if (loaded && (dirty() || queue.busy)) {
    render();
    queue.resume();
    refreshUploads();
  } else {
    await loadAndRender();
    queue.resume();
  }
}

async function signOut(): Promise<void> {
  try {
    await api.signOut();
  } catch {
    // the response clears the cookie; a failed call still lands on the sign-in card
  }
  renderSignIn();
}
```

3. Replace each `if (isExpired(e)) expired();` (in `loadAndRender` and `save`) with `if (isAuthLost(e)) authLost(e);`, and the queue's `requeueOn` with:

```ts
  requeueOn: (e) => {
    if (!isAuthLost(e)) return false;
    authLost(e);
    return true;
  },
```

In `src/admin/admin.css`, let links look like the buttons:

```css
button, label.button, a.button {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--line); background: var(--panel);
  border-radius: 10px; padding: 7px 13px; white-space: nowrap; color: var(--ink); text-decoration: none;
}
button:hover, label.button:hover, a.button:hover { border-color: rgba(255, 236, 210, 0.3); }
button.primary, a.button.primary { background: var(--ink); color: #140b06; border-color: transparent; font-weight: 600; }
```

(replacing the first three button rules), change `.card button { align-self: flex-start; }` to `.card button, .card a.button { align-self: flex-start; }`, and `.login button.primary { … }` to `.login .primary { align-self: stretch; justify-content: center; }`.

- [ ] **Step 7: Update the README's Radio admin section**

Replace the bullets under `## Radio admin` (keep its first paragraph) with:

```md
- **Sign-in:** `/admin` signs in with Google. Only the accounts in `ADMIN_EMAILS` get the editor; any other account sees "Not authorized".
- **Run it locally:** copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in a random `AUTH_SECRET`, then `npm run dev:full` and open `http://localhost:8787/admin`. Local sign-in is fake (`AUTH_MODE=fake`): set the `aglow_fake_as` cookie (or add `?as=<email>` to `/api/auth/google`) to an address in `ADMIN_EMAILS`.
- **Deploy:** `npm run deploy` (see Accounts below for what it checks first).
- **After a deploy,** check that the admin is protected: signed out, `curl -i https://aglow.lukeghanna.com/api/admin/stations` must answer 401, not 503 (`AUTH_SECRET` missing).
- **Uploads that were never saved** stay in R2. They are harmless (no station refers to them); delete them in the Cloudflare dashboard if you want the space back.
- A saved change is live in the game within about a minute. Files removed from a station may stay cached at the edge for up to a week.
```

- [ ] **Step 8: Run everything to verify it passes**

Run: `npm run typecheck && npm test && npm run build && npx playwright test tests/e2e/admin.spec.ts`
Expected: PASS (the admin e2e still runs on `vite preview` with routed API calls; Task 7 moves e2e to the real Worker).

- [ ] **Step 9: Commit**

```bash
git add -A worker tests src/admin wrangler.jsonc .dev.vars.example package.json README.md
git commit -m "feat(admin): the radio admin signs in with Google (ADMIN_EMAILS); the password admin is removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser game flow: online start, tap log, finish, claims; e2e on the real Worker

The browser side of spec §5 without new UI: the API client, the session store, claim storage, `aglow.game` v2, and `App` changes (server start with a 1.5 s fallback to an offline tree, the tap log with pauses and reloads, finish with one retry, the won run kept for the sign-in round trip, claims once signed in with a name). Playwright moves from `vite preview` to `wrangler dev` (the real Worker, a fresh local D1, fake sign-in), so every later task can test end to end.

**Files:**
- Create: `src/api/client.ts`, `src/api/claims.ts`, `src/api/session.ts`, `src/api/outcome.ts`, `tests/unit/api/client.test.ts`, `tests/unit/api/claims.test.ts`, `tests/unit/api/session.test.ts`, `tests/e2e/helpers.ts`, `tests/e2e/online.spec.ts`
- Modify: `src/store/progress.ts` (whole file below), `tests/unit/store/progress.test.ts`, `src/app.ts`, `src/debug.ts`, `playwright.config.ts`, `package.json`

**Interfaces:**
- Consumes: Task 1 `GameLog`, `LogEntry`, `seededBoard`, `isSeed`, `parseLog`, `REVEAL_MS`; Task 3 types `User`, `MeResponse`, `NameCheck`, `StartResponse`, `FinishResult`, `ClaimResponse`, `BoardResponse`, `MyGamesResponse`, `MAX_CLAIMS_PER_REQUEST`.
- Produces:
  - `src/api/client.ts`: `class ApiError(status, code, message)` (status 0 = unreachable); `START_TIMEOUT_MS = 1500`; `FINISH_RETRY_MS = 800`; `api.{ me, checkName(n), setName(name), signOut, deleteAccount(confirm), start, finish(id, log), claim(claims), board, myGames }`; `signInHref(returnPath)`; `finishWithRetry(id, log, wait?)`; `setUnauthorizedHandler(fn | null)`.
  - `src/api/claims.ts`: `CLAIM_TTL_MS`, `MAX_STORED_CLAIMS`, `StoredClaim`, `readClaims(now)`, `addClaim(c, now)`, `removeClaims(ids)`, `claimBatches(claims, size?)`.
  - `src/api/session.ts`: `type SessionState = User | null | undefined`; `class Session { current; subscribe(fn): () => void; set(user); load(): Promise<User | null>; signOut(): Promise<void> }`.
  - `src/api/outcome.ts`: `type RunOutcome = { kind: 'offline' } | { kind: 'saving' } | { kind: 'failed' } | { kind: 'unverified' } | { kind: 'done'; result: FinishResult }`.
  - `src/store/progress.ts`: `OnlineRun`, `WonRun`, `GameSnapshot`, `LoadedGame`, `saveGame(board, elapsedMs, snap)`, `loadGame(g): LoadedGame | null`, `clearGame()`, `markReturn(gameId)`, `takeReturn()`.
  - `App`: `readonly session: Session`; `tapTile(i, now?)`; `newGame()`; `accountChanged()`; `retryFinish()`; getters `started`, `isStarting`, `gameId`, `runOutcome`, `logLength`; private `setOutcome(o)` (Task 9 makes it render the results ribbon), `online`, `won`.
  - Probe (`?test`): `tap(i)`, `game(): { id, outcome, reason, ranked, log }`, `newTree()`; `state().interactive` is false until a tree exists and while a new one starts.
  - npm script `serve:e2e`; e2e helpers `W`, `ready(page, path?)`, `waitInteractive(page)`, `game(page)`, `onlineTree(page)`, `solveByTapping(page, gapMs?)`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, FINISH_RETRY_MS, finishWithRetry, setUnauthorizedHandler, signInHref, START_TIMEOUT_MS } from '../../../src/api/client';
import type { FinishResult } from '../../../src/api/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('sends same-origin JSON and reads JSON', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: 'x', seed: 1, genVersion: 1, claim: null }));
    vi.stubGlobal('fetch', fetch);
    expect(await api.start()).toEqual({ id: 'x', seed: 1, genVersion: 1, claim: null });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/games');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });

  it('turns an error answer into ApiError(status, code, message), and an unreachable server into status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'taken', message: 'That name is taken.' }, { status: 409 })));
    await expect(api.setName('Comet')).rejects.toMatchObject({ status: 409, code: 'taken', message: 'That name is taken.' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'offline' });
  });

  it('gives up on a start after 1.5 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
    );
    const caught = api.start().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(await caught).toMatchObject({ status: 0 });
  });

  it('a 401 calls the signed-out handler', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'signed_out', message: 'Sign in first.' }, { status: 401 })));
    await expect(api.myGames()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('links to sign-in with a return path', () => {
    expect(signInHref('/?x=1')).toBe('/api/auth/google?return=%2F%3Fx%3D1');
  });
});

describe('finishWithRetry', () => {
  const result: FinishResult = { id: 'g', ranked: true, reason: null, ms: 1, rank: 1, total: 1, best: 1, newBest: true };

  it('retries once, 800 ms later, after a network error or a 5xx', async () => {
    const waits: number[] = [];
    const firsts = [async () => Promise.reject(new TypeError('offline')), async () => Response.json({ error: 'unavailable' }, { status: 503 })];
    for (const first of firsts) {
      const fetch = vi.fn().mockImplementationOnce(first).mockImplementationOnce(async () => Response.json(result));
      vi.stubGlobal('fetch', fetch);
      expect(await finishWithRetry('g', [], async (ms) => void waits.push(ms))).toEqual(result);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
    expect(waits).toEqual([FINISH_RETRY_MS, FINISH_RETRY_MS]);
  });

  it('never retries an answer (422 unverified), and gives up after a second failure', async () => {
    const refused = vi.fn(async () => Response.json({ error: 'unverified', message: "This run couldn't be verified." }, { status: 422 }));
    vi.stubGlobal('fetch', refused);
    await expect(finishWithRetry('g', [], async () => undefined)).rejects.toMatchObject({ status: 422 });
    expect(refused).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', down);
    await expect(finishWithRetry('g', [], async () => undefined)).rejects.toMatchObject({ status: 0 });
    expect(down).toHaveBeenCalledTimes(2);
  });
});
```

`tests/unit/api/claims.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { addClaim, CLAIM_TTL_MS, claimBatches, MAX_STORED_CLAIMS, readClaims, removeClaims } from '../../../src/api/claims';

beforeEach(() => localStorage.clear());

it('keeps a claim for 90 days', () => {
  addClaim({ id: 'a', claim: 'x' }, 1000);
  expect(readClaims(1000 + CLAIM_TTL_MS - 1)).toEqual([{ id: 'a', claim: 'x', at: 1000 }]);
  expect(readClaims(1000 + CLAIM_TTL_MS)).toEqual([]);
});

it('keeps at most 500, dropping the oldest, and replaces a repeat', () => {
  for (let k = 0; k < MAX_STORED_CLAIMS + 2; k++) addClaim({ id: `g${k}`, claim: 'x' }, k);
  const all = readClaims(MAX_STORED_CLAIMS + 2);
  expect(all).toHaveLength(MAX_STORED_CLAIMS);
  expect(all[0].id).toBe('g2');
  addClaim({ id: 'g2', claim: 'y' }, 999);
  expect(readClaims(999).filter((c) => c.id === 'g2')).toEqual([{ id: 'g2', claim: 'y', at: 999 }]);
});

it('removes the claims the server has seen, and the key once none are left', () => {
  addClaim({ id: 'a', claim: 'x' }, 1);
  addClaim({ id: 'b', claim: 'y' }, 2);
  removeClaims(['a']);
  expect(readClaims(3)).toEqual([{ id: 'b', claim: 'y', at: 2 }]);
  removeClaims(['b']);
  expect(localStorage.getItem('aglow.claims')).toBeNull();
});

it('ignores corrupt storage', () => {
  localStorage.setItem('aglow.claims', '{"no":1}');
  expect(readClaims(0)).toEqual([]);
  localStorage.setItem('aglow.claims', '[{"id":1}]');
  expect(readClaims(0)).toEqual([]);
});

it('sends 8 claims per request, without the timestamps', () => {
  const claims = Array.from({ length: 17 }, (_, k) => ({ id: `g${k}`, claim: 'x', at: k }));
  const batches = claimBatches(claims);
  expect(batches.map((b) => b.length)).toEqual([8, 8, 1]);
  expect(batches[0][0]).toEqual({ id: 'g0', claim: 'x' });
});
```

`tests/unit/api/session.test.ts`:

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { Session, type SessionState } from '../../../src/api/session';

afterEach(() => vi.unstubAllGlobals());

it('loads the user, tells subscribers, and treats an unreachable server as signed out', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ user: { name: 'Comet', isAdmin: false } })));
  const s = new Session();
  const seen: SessionState[] = [];
  const stop = s.subscribe((u) => seen.push(u));
  expect(s.current).toBeUndefined();
  expect(await s.load()).toEqual({ name: 'Comet', isAdmin: false });
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
  expect(await s.load()).toBeNull();
  stop();
  s.set({ name: 'X', isAdmin: false });
  expect(seen).toEqual([{ name: 'Comet', isAdmin: false }, null]);
});

it('signs out locally even when the server cannot be reached', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
  const s = new Session();
  s.set({ name: 'Comet', isAdmin: false });
  await s.signOut();
  expect(s.current).toBeNull();
});
```

In `tests/unit/store/progress.test.ts`: add `import type { GameSnapshot } from '../../../src/store/progress';` and `const SNAP: GameSnapshot = { startEpoch: 0, online: null, log: [], won: null };`, pass `SNAP` as the third argument to every existing `saveGame(b, …)` call, and in the "Mutation: v = 2" block set `raw.v = 3` (and its comment to `// Mutation: v = 3`). Then add:

```ts
it('v2 keeps the online run, its log and a won run', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: 'c'.repeat(32) };
  const log = [{ t: 10, a: GRID.ids[0] }, { t: 20, a: 'p' as const }];
  const won = {
    seconds: 81,
    score: 41_900,
    newBest: true,
    result: { id: 'g'.repeat(22), ranked: false, reason: 'anonymous' as const, ms: 80_400, rank: 3, total: 10, best: null, newBest: false },
  };
  saveGame(b, 5000, { startEpoch: 123, online, log, won });
  expect(loadGame(GRID)).toEqual({ state: { solution: [...b.solution], bits: b.bits, colors: [...b.colors] }, elapsedMs: 5000, startEpoch: 123, online, log, won });
});

it('a save from before accounts (v1) restores as a local tree', () => {
  const b = Board.random(GRID, mulberry32(4));
  localStorage.setItem('aglow.game', JSON.stringify({ v: 1, solution: b.solution, bits: b.bits, colors: b.colors, elapsedMs: 9000 }));
  expect(loadGame(GRID)).toMatchObject({ elapsedMs: 9000, online: null, log: [], won: null });
});

it('refuses a v2 save with a bad log, half an online run or a malformed result', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null };
  const mutations: ((raw: Record<string, unknown>) => void)[] = [
    (raw) => (raw.log = [{ t: 5, a: 'r' }]),
    (raw) => (raw.seed = null),
    (raw) => (raw.gameId = 'short'),
    (raw) => (raw.won = { seconds: 1, score: 1, newBest: false, result: { id: 'x' } }),
    (raw) => (raw.startEpoch = 'soon'),
  ];
  for (const mutate of mutations) {
    saveGame(b, 1000, { startEpoch: 1, online, log: [], won: null });
    const raw = JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as Record<string, unknown>;
    mutate(raw);
    localStorage.setItem('aglow.game', JSON.stringify(raw));
    expect(loadGame(GRID)).toBeNull();
  }
});

it('the return marker comes back once', () => {
  markReturn('g'.repeat(22));
  expect(takeReturn()).toBe('g'.repeat(22));
  expect(takeReturn()).toBeNull();
});
```

(and add `markReturn, takeReturn` to that file's import from `src/store/progress`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/api tests/unit/store/progress.test.ts`
Expected: FAIL: `src/api/client`, `src/api/claims`, `src/api/session` don't exist; `saveGame` takes no snapshot.

- [ ] **Step 3: Write `src/api/client.ts`, `src/api/claims.ts`, `src/api/session.ts`, `src/api/outcome.ts`**

`src/api/client.ts`:

```ts
import type { LogEntry } from '../core/log';
import type { BoardResponse, ClaimResponse, FinishResult, MeResponse, MyGamesResponse, NameCheck, StartResponse, User } from './types';

/** An API failure: the HTTP status (0 when the server couldn't be reached), the Worker's error code and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A new tree never waits longer than this for the server's seed; past it, it starts offline (spec §5.1). */
export const START_TIMEOUT_MS = 1500;
/** A failed finish is sent again once, this much later (spec §5.3). */
export const FINISH_RETRY_MS = 800;
const TIMEOUT_MS = 10_000;

let onUnauthorized: (() => void) | null = null;
/** A 401 on any call means the session is gone: the app signs out locally (spec §5.4). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      signal: abort.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const { error, message } = (typeof data === 'object' && data !== null ? data : {}) as { error?: unknown; message?: unknown };
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(res.status, typeof error === 'string' ? error : 'server', typeof message === 'string' ? message : 'Something went wrong.');
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline', "Couldn't reach Aglow.");
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  checkName: (n: string) => request<NameCheck>('GET', `/api/auth/name?n=${encodeURIComponent(n)}`),
  setName: (name: string) => request<{ user: User }>('POST', '/api/auth/name', { name }),
  signOut: () => request<Record<string, never>>('POST', '/api/auth/signout', {}),
  deleteAccount: (confirm: string) => request<Record<string, never>>('DELETE', '/api/me', { confirm }),
  start: () => request<StartResponse>('POST', '/api/games', {}, START_TIMEOUT_MS),
  finish: (id: string, log: readonly LogEntry[]) => request<FinishResult>('POST', `/api/games/${encodeURIComponent(id)}/finish`, { log }),
  claim: (claims: readonly { id: string; claim: string }[]) => request<ClaimResponse>('POST', '/api/games/claim', { claims }),
  board: () => request<BoardResponse>('GET', '/api/board'),
  myGames: () => request<MyGamesResponse>('GET', '/api/me/games'),
};

/** Where the browser goes to sign in; the Worker sends it on to Google and back to `returnPath`. */
export const signInHref = (returnPath: string): string => `/api/auth/google?return=${encodeURIComponent(returnPath)}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends a finish, and once more after FINISH_RETRY_MS on a network error or a 5xx. An answer (4xx) is final. */
export async function finishWithRetry(id: string, log: readonly LogEntry[], wait: (ms: number) => Promise<void> = sleep): Promise<FinishResult> {
  try {
    return await api.finish(id, log);
  } catch (e) {
    if (e instanceof ApiError && e.status > 0 && e.status < 500) throw e;
    await wait(FINISH_RETRY_MS);
    return api.finish(id, log);
  }
}
```

`src/api/claims.ts`:

```ts
import { readJSON, removeKey, writeJSON } from '../store/storage';
import { MAX_CLAIMS_PER_REQUEST } from './types';

/** Signed-out runs this browser can still claim (spec §5.4). The server keeps unclaimed finished games as long. */
const KEY = 'aglow.claims';
export const CLAIM_TTL_MS = 90 * 86_400_000;
/** Oldest claims go first past this many. */
export const MAX_STORED_CLAIMS = 500;

export interface StoredClaim {
  id: string;
  claim: string;
  at: number;
}

const isClaims = (v: unknown): v is StoredClaim[] =>
  Array.isArray(v) &&
  v.every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const o = c as Record<string, unknown>;
    return typeof o.id === 'string' && typeof o.claim === 'string' && typeof o.at === 'number' && Number.isFinite(o.at);
  });

export function readClaims(now: number): StoredClaim[] {
  return (readJSON(KEY, isClaims) ?? []).filter((c) => now - c.at < CLAIM_TTL_MS);
}

export function addClaim(c: { id: string; claim: string }, now: number): void {
  writeJSON(KEY, [...readClaims(now).filter((x) => x.id !== c.id), { id: c.id, claim: c.claim, at: now }].slice(-MAX_STORED_CLAIMS));
}

/** Drops the claims the server has seen (claimed or not: a refused claim never succeeds later). */
export function removeClaims(ids: readonly string[]): void {
  const drop = new Set(ids);
  const keep = (readJSON(KEY, isClaims) ?? []).filter((c) => !drop.has(c.id));
  if (keep.length) writeJSON(KEY, keep);
  else removeKey(KEY);
}

export function claimBatches(claims: readonly StoredClaim[], size = MAX_CLAIMS_PER_REQUEST): { id: string; claim: string }[][] {
  const out: { id: string; claim: string }[][] = [];
  for (let i = 0; i < claims.length; i += size) out.push(claims.slice(i, i + size).map(({ id, claim }) => ({ id, claim })));
  return out;
}
```

`src/api/session.ts`:

```ts
import { api } from './client';
import type { User } from './types';

/** undefined while the first /api/me is in flight; null when signed out (or the server is unreachable). */
export type SessionState = User | null | undefined;

export class Session {
  private state: SessionState = undefined;
  private readonly listeners = new Set<(s: SessionState) => void>();

  get current(): SessionState {
    return this.state;
  }

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  set(user: User | null): void {
    this.state = user;
    for (const fn of [...this.listeners]) fn(user);
  }

  async load(): Promise<User | null> {
    let user: User | null = null;
    try {
      user = (await api.me()).user;
    } catch {
      // offline: play signed out
    }
    this.set(user);
    return user;
  }

  async signOut(): Promise<void> {
    try {
      await api.signOut();
    } catch {
      // the next /api/me tells if the cookie outlived this
    }
    this.set(null);
  }
}
```

`src/api/outcome.ts`:

```ts
import type { FinishResult } from './types';

/** What became of the run on the results tag (spec §5, §8). */
export type RunOutcome =
  /** A local tree: the server didn't answer the start in time, or a save from before accounts. */
  | { kind: 'offline' }
  /** The finish is on its way. */
  | { kind: 'saving' }
  /** The finish didn't reach the server, even after the retry. */
  | { kind: 'failed' }
  /** The server couldn't replay the log (422) and dropped the game. */
  | { kind: 'unverified' }
  | { kind: 'done'; result: FinishResult };
```

- [ ] **Step 4: Rewrite `src/store/progress.ts` as v2**

```ts
import type { FinishResult } from '../api/types';
import { computeLighting, type Board, type BoardState } from '../core/board';
import { parseLog, type LogEntry } from '../core/log';
import type { Grid } from '../core/mask';
import { orientationsOf } from '../core/scramble';
import { isSeed } from '../core/seeded';
import { readJSON, removeKey, writeJSON } from './storage';

/** The server game behind the tree on screen. null: a local, unranked ("offline") tree. */
export interface OnlineRun {
  gameId: string;
  seed: number;
  genVersion: number;
  /** Signed-out games only: proves ownership when the run is claimed after sign-in. */
  claim: string | null;
}

/** A solved tree whose run still matters: what its results tag shows, and the server's answer once there is one. */
export interface WonRun {
  seconds: number;
  score: number;
  newBest: boolean;
  result: FinishResult | null;
}

export interface GameSnapshot {
  /** Date.now() when this tree began locally: log times count from here. */
  startEpoch: number;
  online: OnlineRun | null;
  log: readonly LogEntry[];
  won: WonRun | null;
}

export interface LoadedGame extends GameSnapshot {
  state: BoardState;
  elapsedMs: number;
  log: LogEntry[];
}

interface SavedV1 {
  v: 1;
  solution: number[];
  bits: number[];
  colors: number[];
  elapsedMs: number;
}

interface SavedV2 extends Omit<SavedV1, 'v'> {
  v: 2;
  startEpoch: number;
  gameId: string | null;
  seed: number | null;
  genVersion: number | null;
  claim: string | null;
  log: LogEntry[];
  won: WonRun | null;
}

const KEY = 'aglow.game';
const RETURN_KEY = 'aglow.return';
const GAME_ID = /^[A-Za-z0-9_-]{16,64}$/;
const REASONS: readonly unknown[] = ['anonymous', 'paused', 'too_fast', 'clock'];

export function saveGame(board: Board, elapsedMs: number, snap: GameSnapshot): void {
  const saved: SavedV2 = {
    v: 2,
    solution: [...board.solution],
    bits: board.settledBits(),
    colors: [...board.colors],
    elapsedMs: Math.round(elapsedMs),
    startEpoch: snap.startEpoch,
    gameId: snap.online?.gameId ?? null,
    seed: snap.online?.seed ?? null,
    genVersion: snap.online?.genVersion ?? null,
    claim: snap.online?.claim ?? null,
    log: [...snap.log],
    won: snap.won,
  };
  writeJSON(KEY, saved);
}

export const clearGame = (): void => removeKey(KEY);

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown): boolean => x === null || num(x);

function isFinishResult(v: unknown): v is FinishResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.ranked === 'boolean' &&
    (r.reason === null || REASONS.includes(r.reason)) &&
    num(r.ms) &&
    numOrNull(r.rank) &&
    num(r.total) &&
    numOrNull(r.best) &&
    typeof r.newBest === 'boolean'
  );
}

function isWon(v: unknown): v is WonRun {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  return Number.isInteger(w.seconds) && (w.seconds as number) >= 0 && Number.isInteger(w.score) && typeof w.newBest === 'boolean' && (w.result === null || isFinishResult(w.result));
}

/** Validates a save against the mask: right sizes, legal orientations, a solution that lights every tile; v2 adds the run. */
function validator(g: Grid) {
  return (v: unknown): v is SavedV1 | SavedV2 => {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    const n = g.w * g.h;
    const isArr = (x: unknown): x is number[] => Array.isArray(x) && x.length === n && x.every((e) => Number.isInteger(e));
    if ((o.v !== 1 && o.v !== 2) || !isArr(o.solution) || !isArr(o.bits) || !isArr(o.colors)) return false;
    if (typeof o.elapsedMs !== 'number' || !Number.isFinite(o.elapsedMs) || o.elapsedMs < 0) return false;
    if (o.v === 2) {
      if (!num(o.startEpoch) || parseLog(o.log, g) === null || !(o.won === null || isWon(o.won))) return false;
      const online =
        typeof o.gameId === 'string' && GAME_ID.test(o.gameId) && isSeed(o.seed) && Number.isInteger(o.genVersion) && (o.claim === null || typeof o.claim === 'string');
      const offline = o.gameId === null && o.seed === null && o.genVersion === null && o.claim === null;
      if (!online && !offline) return false;
    }
    const solution = o.solution as number[];
    const bits = o.bits as number[];
    const colors = o.colors as number[];
    for (let i = 0; i < n; i++) {
      if (!g.cells[i]) {
        if (solution[i] !== 0 || bits[i] !== 0) return false;
        continue;
      }
      try {
        if (!orientationsOf(solution[i]).includes(bits[i])) return false;
      } catch {
        return false;
      }
      if (colors[i] < 0 || colors[i] > 5) return false;
    }
    return computeLighting(g, solution).count === g.ids.length;
  };
}

export function loadGame(g: Grid): LoadedGame | null {
  const s = readJSON(KEY, validator(g));
  if (!s) return null;
  const state: BoardState = { solution: s.solution, bits: s.bits, colors: s.colors };
  // A save from before accounts restores, as a local tree.
  if (s.v === 1) return { state, elapsedMs: s.elapsedMs, startEpoch: Date.now() - s.elapsedMs, online: null, log: [], won: null };
  const online = s.gameId !== null && s.seed !== null && s.genVersion !== null ? { gameId: s.gameId, seed: s.seed, genVersion: s.genVersion, claim: s.claim } : null;
  return { state, elapsedMs: s.elapsedMs, startEpoch: s.startEpoch, online, log: s.log, won: s.won };
}

/** "Save to leaderboard": after the round trip to Google, this run's results tag comes back (spec §6). */
export function markReturn(gameId: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, gameId);
  } catch {
    // storage blocked: the results tag just doesn't come back
  }
}

/** The run to come back to, once: reading it clears it. */
export function takeReturn(): string | null {
  try {
    const id = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return id;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `npx vitest run tests/unit/api tests/unit/store`
Expected: PASS. (`npm run typecheck` still fails until `app.ts` is updated in the next step.)

- [ ] **Step 6: Wire the online game into `src/app.ts`**

1. Imports: replace the `core/board`, `core/clock`, `core/score` and `store/progress` imports, and add the new ones:

```ts
import { ApiError, api, finishWithRetry, setUnauthorizedHandler } from './api/client';
import { addClaim, claimBatches, readClaims, removeClaims } from './api/claims';
import type { RunOutcome } from './api/outcome';
import { Session } from './api/session';
import type { ClaimResponse, FinishResult } from './api/types';
import { Board, type BoardEvent } from './core/board';
import { GameClock, REVEAL_MS } from './core/clock';
import { GameLog, type LogEntry } from './core/log';
import { formatTime, scoreFor, wholeSeconds } from './core/score';
import { seededBoard } from './core/seeded';
import { clearGame, loadGame, saveGame, takeReturn, type LoadedGame, type OnlineRun, type WonRun } from './store/progress';
```

2. Fields: add after `private readonly radioPanel: RadioPanel;`:

```ts
  /** The signed-in player (spec 2026-10-07): loaded at start, changed by sign-in, naming and sign-out. */
  readonly session = new Session();
  /** A board exists: the first tree waits for the server (1.5 s at most). */
  private live = false;
  /** A new tree is waiting for the server's seed. */
  private starting = false;
  private online: OnlineRun | null = null;
  private startEpoch = 0;
  /** performance.now() + logOffset = log time (ms since startEpoch). */
  private logOffset = 0;
  private log = new GameLog();
  /** The solved tree's results-tag data while its run still matters. */
  private won: WonRun | null = null;
  private outcome: RunOutcome | null = null;
  private claiming = false;
```

3. At the end of the constructor:

```ts
    // A 401 on any signed-in call means the session is gone: sign out locally (spec §5.4).
    setUnauthorizedHandler(() => this.session.set(null));
    this.session.subscribe(() => this.accountChanged());
```

4. In the constructor's `Menu` handlers, guard `needsConfirm`: `needsConfirm: () => this.live && this.winAt === null && this.board.lighting.count > 0 && this.clock.elapsedMs(performance.now()) > 3000,`.

5. Replace `start()` with `start()` + `boot()`:

```ts
  start(): void {
    this.applySettings(this.settings, false);
    this.resize();
    addEventListener('resize', () => {
      if (this.resizeQueued) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        this.resize();
      });
    });
    void document.fonts?.ready.then(() => this.fitHud());
    this.bindControls();
    this.bindLifecycle();
    setInterval(() => this.refreshAutoScene(), 60_000);
    void this.session.load();
    void this.boot();
  }

  /** The first tree: a saved game resumes; otherwise a new one starts (online when the server answers in time). */
  private async boot(): Promise<void> {
    const now = performance.now();
    const saved = loadGame(GRID);
    const returning = takeReturn();
    if (saved?.won && saved.online && (saved.won.result === null || returning === saved.online.gameId)) {
      this.restoreWin(saved, saved.won, now);
    } else if (saved && !saved.won) {
      this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs, saved);
      this.moved = true;
      this.toast.show(`Welcome back · ${formatTime(wholeSeconds(saved.elapsedMs))}`, 2600);
      // A reload counts as a pause (spec §5.2): the log resumes when the clock does, after the reveal.
      this.log.pause(this.logNow(now));
      // Saved during the final turn: the restored board is already solved, so finish the win properly.
      if (this.board.lighting.count === GRID.ids.length) this.handle(this.board.settleWin(), now);
    } else {
      if (saved) clearGame();
      await this.freshTree();
    }
    if (!this.board.won) this.showIntro();
    requestAnimationFrame((t) => this.loop(t));
  }
```

6. Replace `beginGame` and `newGame` with:

```ts
  private beginGame(now: number, board: Board, elapsedMs: number, run: { online: OnlineRun | null; startEpoch: number; log: readonly LogEntry[] }): void {
    this.board = board;
    this.live = true;
    this.online = run.online;
    this.startEpoch = run.startEpoch;
    this.logOffset = Date.now() - run.startEpoch - performance.now();
    this.log = new GameLog(run.log);
    this.won = null;
    this.setOutcome(null);
    this.vis = new VisualState(GRID.w * GRID.h);
    this.clock = new GameClock(elapsedMs);
    this.revealAt = now;
    this.interactiveAt = now + REVEAL_MS;
    this.winAt = null;
    this.shareImage = null;
    this.moved = false;
    this.camera = IDENTITY;
    this.setPaused(false);
    this.results.hide();
    el('corner-new').hidden = true;
    el('zoom-reset').hidden = true;
    // The source "switches on" as the reveal finishes and the initial connected region flows out.
    this.vis.onLightingChanged(board, board.lighting.order, [], this.interactiveAt - 200, false);
  }

  /** A new tree: from the server's seed when it answers within 1.5 s, else a local tree (unranked "offline"). */
  private async freshTree(): Promise<void> {
    this.starting = true;
    let online: OnlineRun | null = null;
    let board: Board | null = null;
    try {
      const s = await api.start();
      board = seededBoard(s.seed, s.genVersion);
      if (board) online = { gameId: s.id, seed: s.seed, genVersion: s.genVersion, claim: s.claim };
    } catch {
      // Unreachable, slow, rate-limited (429) or not configured: play a local tree. Play is never blocked.
    }
    this.starting = false;
    this.beginGame(performance.now(), board ?? Board.random(GRID, Math.random), 0, { online, startEpoch: Date.now(), log: [] });
  }

  newGame(): void {
    if (this.starting) return;
    clearGame();
    void this.freshTree();
  }

  /** Log time (integer ms since this tree began locally) of a performance.now() instant. */
  private logNow(now: number): number {
    return Math.round(now + this.logOffset);
  }

  private snapshot(won: WonRun | null = null) {
    return { startEpoch: this.startEpoch, online: this.online, log: this.log.entries, won };
  }

  private save(now: number): void {
    saveGame(this.board, this.clock.elapsedMs(now), this.snapshot());
  }

  /** The solved tree and its run stay in aglow.game until a new tree starts (spec §8): resent after a reload, back after sign-in. */
  private saveWon(): void {
    if (this.won) saveGame(this.board, this.clock.elapsedMs(performance.now()), this.snapshot(this.won));
  }
```

7. In `handle()`, change the last line to `if (settled && !this.board.won) this.save(now);`.

8. Replace `onWin` with `onWin`, `presentWin`, `restoreWin`, `sendFinish`, `retryFinish`, `claimAll`, `onClaimed`, `accountChanged` and `setOutcome`:

```ts
  private onWin(now: number): void {
    // A buffered turn can win under the pause overlay: lift it, and let the results card take over focus.
    if (this.paused) this.setPaused(false);
    this.clock.pause(now);
    const seconds = wholeSeconds(this.clock.elapsedMs(now));
    const score = scoreFor(seconds);
    const { stats, newBest } = recordWin(this.stats, seconds, score, localDay(new Date()));
    this.stats = stats;
    saveStats(stats);
    this.won = { seconds, score, newBest, result: null };
    if (this.online) {
      this.saveWon();
      void this.sendFinish();
    } else {
      clearGame();
      this.setOutcome({ kind: 'offline' });
    }
    this.presentWin(now, this.won, true);
  }

  /** The win's staging: the tree lights up, then (1.5 s after the last bulb) the results tag. */
  private presentWin(now: number, won: WonRun, sound: boolean): void {
    this.menu.close();
    this.radioPanel.close();
    this.hideIntro();
    this.camera = IDENTITY;
    el('zoom-reset').hidden = true;
    this.lastSeconds = won.seconds;
    this.winAt = this.vis.lastLitAt(this.board);
    const game = this.board;
    const delay = Math.max(0, this.winAt - now);
    if (sound) setTimeout(() => this.board === game && this.sfx.win(), delay);
    setTimeout(() => {
      if (this.board !== game) return;
      this.prepareShare();
      this.results.show({ seconds: won.seconds, score: won.score, newBest: won.newBest, stats: this.stats });
    }, delay + 1500);
  }

  /** Back from sign-in, or a reload before the finish was answered: the solved tree and its results tag again (stats were recorded at the win). */
  private restoreWin(saved: LoadedGame, won: WonRun, now: number): void {
    this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs, saved);
    this.moved = true;
    this.board.settleWin();
    this.won = won;
    this.presentWin(now, won, false);
    if (won.result) this.setOutcome({ kind: 'done', result: won.result });
    else void this.sendFinish();
  }

  /** Sends the finished run (retrying once), then keeps and shows the server's answer. */
  private async sendFinish(): Promise<void> {
    const run = this.online;
    const won = this.won;
    if (!run || !won) return;
    const game = this.board;
    this.setOutcome({ kind: 'saving' });
    try {
      const result = await finishWithRetry(run.gameId, this.log.entries);
      if (this.board !== game) return;
      won.result = result;
      // Signed out: the run waits on this browser to be claimed (90 days).
      if (result.reason === 'anonymous' && run.claim) addClaim({ id: run.gameId, claim: run.claim }, Date.now());
      this.saveWon();
      this.setOutcome({ kind: 'done', result });
      void this.claimAll();
    } catch (e) {
      if (this.board !== game) return;
      // 422: the log didn't replay and the server dropped the game; 404: it was already gone.
      if (e instanceof ApiError && (e.status === 422 || e.status === 404)) {
        clearGame();
        this.setOutcome({ kind: 'unverified' });
      } else this.setOutcome({ kind: 'failed' });
    }
  }

  /** The results tag's Retry, after "Couldn't save this run". */
  retryFinish(): void {
    if (this.outcome?.kind === 'failed') void this.sendFinish();
  }

  /** Signed-out runs saved on this browser join the account, 8 per request, once it has a name (spec §5.4). */
  private async claimAll(): Promise<void> {
    if (this.claiming || !this.session.current?.name) return;
    this.claiming = true;
    try {
      for (const batch of claimBatches(readClaims(Date.now()))) {
        let res: ClaimResponse;
        try {
          res = await api.claim(batch);
        } catch {
          return; // keep them for next time
        }
        removeClaims(batch.map((c) => c.id));
        for (const r of res.results) this.onClaimed(r);
      }
    } finally {
      this.claiming = false;
    }
  }

  private onClaimed(r: FinishResult): void {
    if (!this.won || this.online?.gameId !== r.id) return;
    this.won.result = r;
    this.saveWon();
    this.setOutcome({ kind: 'done', result: r });
  }

  /** Who is playing changed (sign-in, a new name, sign-out): claim what waits here, and redraw the run's outcome. */
  accountChanged(): void {
    void this.claimAll();
    this.setOutcome(this.outcome);
  }

  /** The run's outcome on the results tag. */
  private setOutcome(o: RunOutcome | null): void {
    this.outcome = o;
  }
```

9. In `loop()`, replace the clock-resume line with:

```ts
    if (!this.paused && this.winAt === null && !this.clock.running && now >= this.interactiveAt) {
      this.clock.resume(now);
      this.log.resume(this.logNow(now)); // after a pause or a reload; nothing to log at the first start
    }
```

10. Replace the end of `tap()` (from `if (now < this.interactiveAt) return;` to the end of the method) and add `tapTile`:

```ts
    const [wx, wy] = toWorld(this.camera, x, y);
    const i = tileAt(this.renderer.layout, GRID, wx, wy);
    if (i >= 0) this.tapTile(i, now);
  }

  /** A tap on tile `i` (also the e2e probe's way in). Turns are ticked first: the same order the server's replay uses. */
  tapTile(i: number, now = performance.now()): void {
    if (!this.live || this.starting || this.paused || now < this.interactiveAt) return;
    this.hideIntro();
    // The first tile tap fades the music in (spec §5.2); it must run synchronously inside the gesture.
    this.radio.firstGesture();
    this.handle(this.board.tick(now), now);
    const events = this.board.tap(i, now);
    if (events.length) this.log.tap(this.logNow(now), i);
    this.handle(events, now);
  }
```

11. In `bindLifecycle()`, replace the `visibilitychange` and `pagehide` listeners with:

```ts
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || !this.live) return;
      const now = performance.now();
      if (this.canPause(now)) this.pause(false);
      // During the reveal the clock hasn't started: nothing to pause, but a restored game is still saved.
      else if (this.winAt === null && this.moved) this.save(now);
    });
    addEventListener('pagehide', () => {
      if (!this.live || this.winAt !== null) return;
      const now = performance.now();
      // A reload counts as a pause (spec §5.2): the log says so, and a page back from the back-forward cache shows the pause overlay.
      if (this.canPause(now)) this.pause(false);
      else this.log.pause(this.logNow(now));
      if (this.moved) this.save(now);
    });
```

12. Replace `canPause` and `pause`:

```ts
  /** Pausing makes sense only while the clock can run: a tree on screen, after the reveal and before the win. */
  private canPause(now: number): boolean {
    return this.live && !this.starting && now >= this.interactiveAt && this.winAt === null;
  }

  private pause(focus: boolean): void {
    const now = performance.now();
    if (this.paused || !this.canPause(now)) return;
    this.clock.pause(now);
    this.log.pause(this.logNow(now));
    this.setPaused(true);
    if (focus) el('pause').focus({ preventScroll: true });
    if (this.moved) this.save(now);
  }
```

13. Guard `debugSolve` with `if (!this.live) return;` as its first line, and add the probe getters after it:

```ts
  get started(): boolean {
    return this.live;
  }
  get isStarting(): boolean {
    return this.starting;
  }
  get gameId(): string | null {
    return this.online?.gameId ?? null;
  }
  get runOutcome(): RunOutcome | null {
    return this.outcome;
  }
  get logLength(): number {
    return this.log.entries.length;
  }
```

Remove the now-unused imports (`saveGame` stays; nothing else from the old code is left unused) and run `npm run typecheck` until it is clean.

- [ ] **Step 7: Extend the test probe**

In `src/debug.ts`, add `import type { RunOutcome } from './api/outcome';`, extend `AglowProbe`:

```ts
  /** A real tap on tile i, through the game (logged, as a finger's would be). */
  tap(i: number): void;
  /** The server game behind the tree, what became of its run, and the log's length. */
  game(): { id: string | null; outcome: RunOutcome['kind'] | null; reason: string | null; ranked: boolean | null; log: number };
  newTree(): void;
```

and make `state()` safe before the first tree, then add the three members:

```ts
    state: () =>
      app.started
        ? {
            bits: [...app.board.bits],
            solution: [...app.board.solution],
            litCount: app.board.lighting.count,
            won: app.board.won,
            rotating: app.board.rotating.size,
            interactive: !app.isStarting && performance.now() >= app.interactiveAt,
          }
        : { bits: [], solution: [], litCount: 0, won: false, rotating: 0, interactive: false },
    tap: (i) => app.tapTile(i),
    game: () => {
      const o = app.runOutcome;
      const result = o?.kind === 'done' ? o.result : null;
      return { id: app.gameId, outcome: o?.kind ?? null, reason: result?.reason ?? null, ranked: result ? result.ranked : null, log: app.logLength };
    },
    newTree: () => app.newGame(),
```

- [ ] **Step 8: Move Playwright onto the real Worker**

In `package.json` `scripts`, add:

```json
    "serve:e2e": "rm -rf .wrangler/e2e && wrangler d1 migrations apply aglow --local --persist-to .wrangler/e2e && wrangler dev --port 4173 --local-upstream localhost:4173 --persist-to .wrangler/e2e --var AUTH_MODE:fake --var AUTH_SECRET:e2e-secret-not-real --var GOOGLE_CLIENT_SECRET:unused --var ADMIN_EMAILS:admin@example.com",
```

(`--local-upstream` makes the Worker see `localhost:4173`, so fake sign-in is allowed and `Origin` matches.)

Replace `playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // The real Worker (wrangler dev) over the production build, a fresh local D1 and R2, and fake sign-in (localhost only).
  webServer: {
    command: 'npm run build && npm run serve:e2e',
    url: 'http://localhost:4173',
    // Never reuse a stale server: the tests need a fresh local D1 and the current build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
```

`tests/e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import type { AglowProbe } from '../../src/debug';

export type W = Window & { __aglow: AglowProbe };

/** Opens the game with the test probe and waits until the tree takes taps. */
export async function ready(page: Page, path = '/?test'): Promise<void> {
  await page.goto(path);
  await waitInteractive(page);
}

export async function waitInteractive(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}

export const game = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.game());

/** The id of a tree the server started. A cold local Worker can miss the 1.5 s start; then a new tree is asked for. */
export async function onlineTree(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitInteractive(page);
    const { id } = await game(page);
    if (id) return id;
    await page.evaluate(() => (window as unknown as W).__aglow.newTree());
    await page.waitForTimeout(300);
  }
  throw new Error('the local Worker never started an online tree');
}

/** Solves the tree like a person: real taps through the game, `gapMs` apart (the server ranks gaps of 40 ms and up). */
export async function solveByTapping(page: Page, gapMs = 50): Promise<void> {
  await page.evaluate(async (gap) => {
    const a = (window as unknown as W).__aglow;
    // 90° clockwise: U→R, R→D, D→L, L→U (U=1, D=2, L=4, R=8).
    const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
    const s = a.state();
    for (const i of a.ids) {
      for (let b = s.bits[i], k = 0; b !== s.solution[i] && k < 4; b = rot(b), k++) {
        a.tap(i);
        await new Promise((r) => setTimeout(r, gap));
      }
    }
  }, gapMs);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__aglow.state().won)).toBe(true);
}
```

`tests/e2e/online.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { game, onlineTree, ready, solveByTapping, waitInteractive, type W } from './helpers';

test('a tree solved by tapping is replayed by the server and saved as an anonymous run', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous', ranked: false });
});

test('a lost finish response is retried once, so the run still saves', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/games/*/finish', (route) => (++attempts === 1 ? route.abort() : route.continue()));
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(async () => (await game(page)).outcome).toBe('done');
  expect(attempts).toBe(2);
});

test('when the server does not answer the start, the tree is local and unranked (offline)', async ({ page }) => {
  await page.route('**/api/games', (route) => route.abort());
  await ready(page);
  expect((await game(page)).id).toBeNull();
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect.poll(async () => (await game(page)).outcome).toBe('offline');
});

test('a reload mid-game resumes the same server game and logs the reload as a pause', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    a.tap(a.ids[3]);
  });
  await page.waitForTimeout(300);
  const before = (await game(page)).log;
  await page.reload();
  await waitInteractive(page);
  expect((await game(page)).id).toBe(id);
  await expect.poll(async () => (await game(page)).log).toBeGreaterThan(before);
});
```

- [ ] **Step 9: Run everything to verify it passes**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: PASS: the new online tests and every existing smoke, radio and admin e2e test, now on `wrangler dev` (the radio and admin tests route their API calls as before; the game itself now talks to the local Worker).

- [ ] **Step 10: Commit**

```bash
git add src tests package.json playwright.config.ts
git commit -m "feat(game): server-seeded trees, tap log with pauses, verified finish with retry, claims; e2e on wrangler dev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Account UI: HUD chip and menu, glass sheets (leaderboard, Your games), sign-in, name and delete cards

Pick 1A (a HUD name chip beside the ··· button, with a menu) and pick 2C (sheets in the radio panel's dark glass), ported from the approved mockups (`.claude/worktrees/agent-aeaddf57b5d538524/src/mock/{index.ts,mock.css,icons.ts}`, entry A, skin "glass"; that worktree is throwaway: its other variants and its mock layer are not ported). Sheets pause a game in progress, close on Escape or a tap outside, trap focus, and sit above the pause overlay; the account menu joins `setPaused`'s inert list.

**Files:**
- Create: `src/ui/account.css` (complete below), `src/ui/icons.ts`, `src/ui/format.ts`, `src/ui/sheet.ts`, `src/ui/account-menu.ts`, `src/ui/account-cards.ts`, `src/ui/board-sheets.ts`, `src/ui/accounts.ts`, `tests/unit/ui/format.test.ts`, `tests/unit/ui/account-cards.test.ts`, `tests/unit/ui/board-sheets.test.ts`, `tests/unit/ui/sheet.test.ts`, `tests/e2e/accounts.spec.ts`
- Modify: `src/main.ts`, `src/app.ts`, `tests/e2e/helpers.ts`

**Interfaces:**
- Consumes: Task 7 `api`, `ApiError`, `signInHref`, `Session`, `SessionState`; Task 3 `cleanName`, `isReserved`, `NAME_RULE`, `User`, `BoardResponse`, `BoardRow`, `MyGamesResponse`, `RecentGame`, `UnrankedReason`.
- Produces:
  - `src/ui/format.ts`: `formatMs(ms)` (`m:ss.t`), `formatDay(at, now)`, `formatWhen(at, now)`, `plural(n, word)`, `esc(s)`, `initial(name)`, `UNRANKED_TEXT: Record<UnrankedReason | 'offline' | 'unverified', string>`.
  - `src/ui/icons.ts`: `G_LOGO`, `I` (`trophy`, `person`, `list`, `pen`, `close`, `check`, `cross`, `warn`, `star`, `out`, `radio`), `bow(id)`.
  - `src/ui/sheet.ts`: `SheetView { label; card; render(inner); focus? }`, `SheetHooks { onOpen(); onAct(act, el) }`, `class Sheet { isOpen; current; body; open(view, opener?); update(view); close() }`.
  - `src/ui/account-menu.ts`: `MenuSummary { rank: number | null; best: number | null }`, `AccountMenuHooks`, `class AccountMenu { chip; isOpen; hasFocus; render(user, summary?); open(); close(focusChip) }` (chip id `account-chip`, menu id `account-menu`).
  - `src/ui/account-cards.ts`: `SignInOptions { pendingMs?; beforeLeave?; returnPath? }`, `signInView(o, peek)`, `NameStatus`, `NameState`, `nameMessage(s)`, `canSaveName(status)`, `nameView(hooks)`, `paintName(inner, s)`, `confirmMatches(user, typed)`, `deleteView(user)`.
  - `src/ui/board-sheets.ts`: `ListTab = 'board' | 'games'`, `Loadable<T>`, `listView(tab, board, games, user, now)`.
  - `src/ui/accounts.ts`: `AccountsHooks { pause(); closeOthers(); fitHud(); toast(text, ms?) }`, `class Accounts { blocksKeys; menuOpen; sheetOpen; closeMenu(); openSignIn(o?, from?); openName(from?); openDelete(from?); openBoard(from?); openGames(from?) }`.
  - App: `private readonly accounts: Accounts` (Task 9 calls `openBoard` and `openSignIn`).
  - e2e helpers: `asPlayer(page)`, `signInFromChip(page)`, `pickName(page, name)`, `resumeIfPaused(page)`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/ui/format.test.ts`:

```ts
import { expect, it } from 'vitest';
import { esc, formatDay, formatMs, formatWhen, initial, plural, UNRANKED_TEXT } from '../../../src/ui/format';

it('formats ranked times as m:ss.t, never rounding a time up', () => {
  expect(formatMs(81_049)).toBe('1:21.0');
  expect(formatMs(81_099)).toBe('1:21.0');
  expect(formatMs(59_999)).toBe('0:59.9');
  expect(formatMs(600_000)).toBe('10:00.0');
  expect(formatMs(-5)).toBe('0:00.0');
});

it('dates: today and yesterday by name, else month and day (with the year when it differs)', () => {
  const now = new Date(2026, 11, 3, 22, 0).getTime();
  expect(formatWhen(new Date(2026, 11, 3, 21, 41).getTime(), now)).toBe('Today · 9:41 pm');
  expect(formatWhen(new Date(2026, 11, 2, 0, 5).getTime(), now)).toBe('Yesterday · 12:05 am');
  expect(formatWhen(new Date(2026, 10, 30, 12, 0).getTime(), now)).toBe('Nov 30 · 12:00 pm');
  expect(formatDay(new Date(2025, 11, 24).getTime(), now)).toBe('Dec 24, 2025');
  expect(formatDay(new Date(2026, 0, 2).getTime(), now)).toBe('Jan 2');
});

it('escapes, initials, plurals and the unranked reasons', () => {
  expect(esc(`<b a="1">'&`)).toBe('&#60;b a=&#34;1&#34;&#62;&#39;&#38;');
  expect(initial(' comet')).toBe('C');
  expect(plural(1, 'run')).toBe('1 run');
  expect(plural(1340, 'run')).toBe('1,340 runs');
  expect(UNRANKED_TEXT).toEqual({
    anonymous: 'not signed in',
    paused: 'paused too long',
    too_fast: 'too fast',
    clock: "couldn't verify the clock",
    offline: 'offline',
    unverified: "couldn't verify this run",
  });
});
```

`tests/unit/ui/account-cards.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canSaveName, confirmMatches, deleteView, nameMessage, nameView, paintName, signInView } from '../../../src/ui/account-cards';

describe('the name card', () => {
  it('says what the check found, escaped', () => {
    expect(nameMessage({ status: 'available', value: ' Comet ' })).toContain('“Comet” is available');
    expect(nameMessage({ status: 'taken', value: 'Comet' })).toContain('“Comet” is taken. Try another.');
    expect(nameMessage({ status: 'reserved', value: 'Santa' })).toContain('That name is reserved');
    expect(nameMessage({ status: 'invalid', value: 'ab' })).toContain('At least 3 characters');
    expect(nameMessage({ status: 'invalid', value: 'ab!' })).toContain('Letters, numbers, spaces, - and _ only');
    expect(nameMessage({ status: 'available', value: '<b>' })).not.toContain('<b>');
  });

  it('allows Save for an available name, or when the check or the save could not run', () => {
    for (const s of ['available', 'error', 'failed'] as const) expect(canSaveName(s), s).toBe(true);
    for (const s of ['empty', 'checking', 'saving', 'taken', 'reserved', 'invalid'] as const) expect(canSaveName(s), s).toBe(false);
  });

  it('reports typing and Enter, and paints a state without re-rendering the field', () => {
    const inner = document.createElement('div');
    const input = vi.fn();
    const save = vi.fn();
    nameView({ input, save }).render(inner);
    const field = inner.querySelector('input');
    if (!field) throw new Error('no field');
    field.value = 'Comet';
    field.dispatchEvent(new Event('input'));
    expect(input).toHaveBeenCalledWith('Comet');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(save).toHaveBeenCalledTimes(1);
    paintName(inner, { status: 'available', value: 'Comet' });
    expect(inner.querySelector('.acct-check')?.getAttribute('data-state')).toBe('available');
    expect(inner.querySelector<HTMLButtonElement>('[data-act="save-name"]')?.disabled).toBe(false);
    expect(inner.querySelector('.acct-count')?.textContent).toBe('5/20');
    expect(inner.querySelector('input')).toBe(field);
  });
});

describe('the sign-in card', () => {
  it('links to Google with the return path, says the name is the one you pick, links the privacy page, and runs beforeLeave', () => {
    const inner = document.createElement('div');
    const beforeLeave = vi.fn();
    signInView({ pendingMs: 81_000, beforeLeave, returnPath: '/?test' }, false).render(inner);
    const google = inner.querySelector<HTMLAnchorElement>('a.acct-google');
    expect(google?.getAttribute('href')).toBe('/api/auth/google?return=%2F%3Ftest');
    expect(google?.textContent).toBe('Continue with Google');
    expect(inner.textContent).toContain('Your name on the leaderboard is the one you pick. We never show your email.');
    expect(inner.textContent).toContain('Your 1:21.0 is waiting on this device.');
    expect(inner.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(inner.querySelector('[data-act="peek"]')).toBeNull();
    google?.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate
    google?.click();
    expect(beforeLeave).toHaveBeenCalledTimes(1);
  });
});

describe('the delete card', () => {
  it('enables Delete once the name is typed (any case); an account without a name types its email', () => {
    const inner = document.createElement('div');
    deleteView({ name: 'Comet', isAdmin: false }).render(inner);
    const input = inner.querySelector<HTMLInputElement>('#acct-confirm');
    const go = inner.querySelector<HTMLButtonElement>('[data-act="confirm-delete"]');
    expect(inner.querySelector('label')?.textContent).toBe('Type your name, Comet, to confirm');
    expect(go?.disabled).toBe(true);
    if (!input) throw new Error('no input');
    input.value = ' comet ';
    input.dispatchEvent(new Event('input'));
    expect(go?.disabled).toBe(false);
    expect(confirmMatches({ name: null, isAdmin: false }, 'ana@example.com')).toBe(true);
    expect(confirmMatches({ name: null, isAdmin: false }, 'ana')).toBe(false);
  });
});
```

`tests/unit/ui/board-sheets.test.ts`:

```ts
// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { BoardResponse, MyGamesResponse } from '../../../src/api/types';
import { listView } from '../../../src/ui/board-sheets';

const now = new Date(2026, 11, 3, 22, 0).getTime();
const day = new Date(2026, 11, 1, 20, 0).getTime();
const me = { name: 'Meridian', isAdmin: false };
const board: BoardResponse = {
  rows: [
    { rank: 1, name: 'Comet', ms: 48_200, finishedAt: day, mine: false },
    { rank: 2, name: 'Meridian', ms: 51_700, finishedAt: day, mine: true },
  ],
  total: 340,
  you: null,
};
function render(...args: Parameters<typeof listView>): HTMLElement {
  const inner = document.createElement('div');
  listView(...args).render(inner);
  return inner;
}
const texts = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)].map((n) => n.textContent);

it('the leaderboard: rank, name, time and date; your rows marked; the total', () => {
  const el = render('board', { status: 'ready', data: board }, { status: 'loading' }, me, now);
  expect(listView('board', { status: 'loading' }, { status: 'loading' }, me, now).label).toBe('Leaderboard');
  expect(texts(el, '.acct-row .acct-rank')).toEqual(['1', '2']);
  expect(texts(el, '.acct-row .acct-nm')).toEqual(['Comet', 'Meridian']);
  expect(texts(el, '.acct-row .acct-time')).toEqual(['0:48.2', '0:51.7']);
  expect(texts(el, '.acct-row .acct-date')).toEqual(['Dec 1', 'Dec 1']);
  expect(el.querySelectorAll('.acct-me')).toHaveLength(1);
  expect(el.querySelector('.acct-me .acct-you')?.textContent).toBe('You');
  expect(el.querySelector('.acct-sub')?.textContent).toBe('All-time · 340 ranked runs');
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('340 ranked runs');
  expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Leaderboard');
});

it('pins your best below the list when it is outside the top 50', () => {
  const you = { rank: 87, name: 'Meridian', ms: 152_000, finishedAt: day, mine: true };
  const el = render('board', { status: 'ready', data: { ...board, rows: [board.rows[0]], you } }, { status: 'loading' }, me, now);
  expect(el.querySelector('.acct-pin .acct-me .acct-rank')?.textContent).toBe('87');
  expect(el.querySelector('.acct-pin-note')?.textContent).toBe('Your best · #87 of 340 runs');
});

it('signed out or without a name: a call to action instead of your row', () => {
  const out = render('board', { status: 'ready', data: board }, { status: 'loading' }, null, now);
  expect(out.querySelector('.acct-pin-cta')?.textContent).toContain('Sign in to see your name on the list');
  expect(out.querySelector('.acct-pin [data-act="signin"]')).not.toBeNull();
  const nameless = render('board', { status: 'ready', data: board }, { status: 'loading' }, { name: null, isAdmin: false }, now);
  expect(nameless.querySelector('.acct-pin [data-act="name"]')).not.toBeNull();
});

it('loading, empty and error states', () => {
  expect(render('board', { status: 'loading' }, { status: 'loading' }, me, now).querySelector('.acct-note')?.textContent).toBe('Loading…');
  expect(render('board', { status: 'ready', data: { rows: [], total: 0, you: null } }, { status: 'loading' }, me, now).querySelector('.acct-note')?.textContent).toBe(
    'No ranked runs yet. Light a tree and be the first.',
  );
  const failed = render('board', { status: 'error' }, { status: 'loading' }, me, now);
  expect(failed.querySelector('.acct-note')?.textContent).toBe("Couldn't load the leaderboard.");
  expect(failed.querySelector('[data-act="reload"]')).not.toBeNull();
});

it('your games: best, rank, top-50 count, then recent games with their status', () => {
  const games: MyGamesResponse = {
    best: { ms: 81_000, rank: 12, finishedAt: day },
    inTop: 2,
    total: 340,
    games: [
      { id: 'a', ms: 94_200, finishedAt: now - 3_600_000, ranked: true, reason: null, isBest: false },
      { id: 'b', ms: 125_100, finishedAt: day, ranked: false, reason: 'paused', isBest: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true },
    ],
  };
  const el = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now);
  expect(listView('games', { status: 'loading' }, { status: 'ready', data: games }, me, now).label).toBe('Your games');
  expect(texts(el, '.acct-stats b')).toEqual(['1:21.0', '#12', '2']);
  expect(texts(el, '.acct-status')).toEqual(['Ranked', 'Unranked · paused too long', 'Personal best']);
  expect(el.querySelector('.acct-when')?.textContent).toBe('Today · 9:00 pm');
  expect(el.querySelector('[data-act="delete"]')).not.toBeNull();
  expect(el.querySelector('.acct-pin')).toBeNull();
});

it('your games, signed out: an invitation to sign in', () => {
  const el = render('games', { status: 'loading' }, { status: 'loading' }, null, now);
  expect(el.querySelector('.acct-empty h3')?.textContent).toBe('Keep every tree');
  expect(el.querySelector('[data-act="signin"]')).not.toBeNull();
});
```

`tests/unit/ui/sheet.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Sheet, type SheetView } from '../../../src/ui/sheet';

let sheets: Sheet[] = [];
afterEach(() => {
  for (const s of sheets) s.close();
  sheets = [];
  document.body.innerHTML = '';
});
const make = (onOpen = vi.fn(), onAct = vi.fn()) => {
  const s = new Sheet({ onOpen, onAct });
  sheets.push(s);
  return s;
};
const view = (label: string): SheetView => ({
  label,
  card: true,
  render: (inner) => {
    inner.innerHTML = '<button type="button" data-act="go">Go</button>';
  },
});
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

it('opens as a labelled modal dialog over a scrim, telling the app once', () => {
  const onOpen = vi.fn();
  const sheet = make(onOpen);
  sheet.open(view('Sign in'));
  expect(dialog()?.hidden).toBe(false);
  expect(dialog()?.getAttribute('aria-label')).toBe('Sign in');
  expect(dialog()?.getAttribute('aria-modal')).toBe('true');
  expect(document.querySelector<HTMLElement>('.acct-scrim')?.hidden).toBe(false);
  sheet.open(view('Pick a display name'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(dialog()?.getAttribute('aria-label')).toBe('Pick a display name');
});

it('routes [data-act] clicks, and closes on its close button, Escape or the scrim', () => {
  const onAct = vi.fn();
  const sheet = make(vi.fn(), onAct);
  sheet.open(view('A'));
  document.querySelector<HTMLElement>('[data-act="go"]')?.click();
  expect(onAct).toHaveBeenCalledWith('go', expect.any(HTMLElement));
  document.querySelector<HTMLElement>('.acct-x')?.click();
  expect(sheet.isOpen).toBe(false);
  sheet.open(view('A'));
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(sheet.isOpen).toBe(false);
  sheet.open(view('A'));
  document.querySelector<HTMLElement>('.acct-scrim')?.click();
  expect(sheet.isOpen).toBe(false);
});

it('keeps P (pause) from reaching the game while open', () => {
  const sheet = make();
  sheet.open(view('A'));
  const seen = vi.fn();
  document.addEventListener('keydown', seen);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  expect(seen).not.toHaveBeenCalled();
  document.removeEventListener('keydown', seen);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/ui`
Expected: FAIL: the `src/ui/*` modules don't exist.

- [ ] **Step 3: Write `src/ui/format.ts` and `src/ui/icons.ts`**

`src/ui/format.ts`:

```ts
import type { UnrankedReason } from '../api/types';

/** A ranked time as m:ss.t, rounded down so a time never reads faster than it was. */
export function formatMs(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Dec 3", or "Dec 3, 2025" in another year. */
export function formatDay(at: number, now: number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === new Date(now).getFullYear() ? '' : `, ${d.getFullYear()}`}`;
}

/** "Today · 9:41 pm", "Yesterday · 10:15 pm" or "Dec 3 · 6:12 pm". */
export function formatWhen(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const day = sameDay(d, today) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday' : formatDay(at, now);
  const h = d.getHours();
  return `${day} · ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export const plural = (n: number, word: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? word : `${word}s`}`;

/** For text placed into HTML templates. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const initial = (name: string): string => esc((name.trim()[0] ?? '?').toUpperCase());

/** "Unranked: …" on the results tag and in Your games (spec §6). */
export const UNRANKED_TEXT: Readonly<Record<UnrankedReason | 'offline' | 'unverified', string>> = {
  anonymous: 'not signed in',
  paused: 'paused too long',
  too_fast: 'too fast',
  clock: "couldn't verify the clock",
  offline: 'offline',
  unverified: "couldn't verify this run",
};
```

`src/ui/icons.ts`:

```ts
/** Static icon markup for the account UI (from the approved mockups). */

export const G_LOGO = `<svg class="acct-g" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

export const I = {
  trophy: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M7 3.2h10a.8.8 0 0 1 .8.8v1h2.4a.8.8 0 0 1 .8.8v1.6a4.4 4.4 0 0 1-4.1 4.4 6 6 0 0 1-4 3.3v2.5h2.6a1.6 1.6 0 0 1 1.6 1.6v1.4H6.9v-1.4a1.6 1.6 0 0 1 1.6-1.6h2.6v-2.5a6 6 0 0 1-4-3.3A4.4 4.4 0 0 1 3 7.4V5.8a.8.8 0 0 1 .8-.8h2.4V4a.8.8 0 0 1 .8-.8zm10.8 3.4v2.8a2.8 2.8 0 0 0 1.6-2.5v-.3zM4.6 6.6v.3a2.8 2.8 0 0 0 1.6 2.5V6.6z"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="8.2" r="4.2"/><path d="M3.8 20.2c.7-4.3 4-6.7 8.2-6.7s7.5 2.4 8.2 6.7a.9.9 0 0 1-.9 1H4.7a.9.9 0 0 1-.9-1z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15.5 4.5l4 4L8.5 19.5l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 3.5c.5 0 .9.3 1.2.7l8 14.2a1.3 1.3 0 0 1-1.2 2H4a1.3 1.3 0 0 1-1.2-2l8-14.2c.3-.4.7-.7 1.2-.7zm-1 6v5h2v-5zm0 6.5v2h2v-2z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="m12 3.2 2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2l-5.2 2.9L8 13.3l-4.4-4 5.9-.7z"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="8" width="17" height="12" rx="2.5"/><path d="M7 8l9-4"/><circle cx="15.5" cy="14" r="2.6"/><path d="M7 12.5h3M7 15.5h3"/></svg>',
};

/** The settings menu's gold bow, with gradient ids unique to `p`. */
export function bow(p: string): string {
  return `<svg class="bow" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${p}-loop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a4"/><stop offset=".45" stop-color="#d9a74e"/><stop offset="1" stop-color="#8f5f1e"/></linearGradient>
    <linearGradient id="${p}-tail" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c16c"/><stop offset="1" stop-color="#90601f"/></linearGradient>
    <radialGradient id="${p}-knot" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff2c8"/><stop offset=".5" stop-color="#e2b25a"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient>
  </defs>
  <path d="M29 22l-10 16 6-2.2 3.4 3.6 3.2-16.4zM35 22l10 16-6-2.2-3.4 3.6-3.2-16.4z" fill="url(#${p}-tail)" />
  <path d="M32 20C22 4 5 3 7 15c1 8 14 9 25 5z" fill="url(#${p}-loop)" />
  <path d="M32 20C42 4 59 3 57 15c-1 8-14 9-25 5z" fill="url(#${p}-loop)" />
  <path d="M30 19C22 9 12 7 11 13c0 3 4 5 10 5M34 19C42 9 52 7 53 13c0 3-4 5-10 5" fill="none" stroke="rgba(90,52,10,.45)" stroke-width="1.2" />
  <path d="M12 9.5c4-3 10-1 15 5M52 9.5c-4-3-10-1-15 5" fill="none" stroke="rgba(255,248,220,.7)" stroke-width=".9" stroke-linecap="round" />
  <ellipse cx="32" cy="20" rx="5.2" ry="4.6" fill="url(#${p}-knot)" />
</svg>`;
}
```

- [ ] **Step 4: Write `src/ui/sheet.ts`**

```ts
import { bow, I } from './icons';

/** One view in the account sheet: a list (leaderboard, Your games) or a small card (sign-in, name, delete). */
export interface SheetView {
  /** The dialog's accessible name. */
  label: string;
  card: boolean;
  /** Fills the sheet. Called on open and on every update(); it may bind listeners to what it creates. */
  render(inner: HTMLElement): void;
  /** Selector of the element that takes focus on open (default: the dialog itself). */
  focus?: string;
}

export interface SheetHooks {
  /** The sheet is about to cover the game (it pauses a game in progress). */
  onOpen(): void;
  /** A [data-act] control inside the sheet was activated. */
  onAct(act: string, el: HTMLElement): void;
}

/**
 * The account sheet in the radio panel's dark glass (pick 2C): a popover under the HUD on desktop, a bottom sheet on
 * phones. Modal: a scrim covers the game, Tab stays inside, and Escape, the close button or a tap on the scrim closes it.
 */
export class Sheet {
  private readonly scrim = document.createElement('div');
  private readonly root = document.createElement('div');
  private readonly inner = document.createElement('div');
  private view: SheetView | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly hooks: SheetHooks) {
    this.scrim.className = 'acct-scrim';
    this.scrim.hidden = true;
    this.root.className = 'acct-sheet';
    this.root.id = 'account-sheet';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.tabIndex = -1;
    this.root.hidden = true;
    this.root.innerHTML = `<div class="acct-grab" aria-hidden="true"></div>${bow('acct-sbow')}<button class="acct-x" type="button" data-act="close" aria-label="Close">${I.close}</button>`;
    this.inner.className = 'acct-inner';
    this.root.append(this.inner);
    document.body.append(this.scrim, this.root);
    this.scrim.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!t || !this.root.contains(t)) return; // links (Continue with Google, Privacy) navigate
      e.preventDefault();
      if (t.dataset.act === 'close') this.close();
      else this.hooks.onAct(t.dataset.act ?? '', t);
    });
    addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get current(): SheetView | null {
    return this.view;
  }

  /** The open view's content, for updates in place (the name card's check line). */
  get body(): HTMLElement {
    return this.inner;
  }

  open(view: SheetView, opener?: HTMLElement | null): void {
    if (!this.isOpen) {
      this.hooks.onOpen();
      this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    this.view = view;
    this.scrim.hidden = false;
    this.root.hidden = false;
    this.refresh();
    const target = view.focus ? this.root.querySelector<HTMLElement>(view.focus) : null;
    (target ?? this.root).focus({ preventScroll: true });
  }

  /** Shows `view` in the open sheet (new data, another tab), keeping focus inside. */
  update(view: SheetView): void {
    if (!this.isOpen) return;
    this.view = view;
    this.refresh();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.scrim.hidden = true;
    this.view = null;
    const o = this.opener;
    this.opener = null;
    // Back to what opened it, unless that is out of reach under the pause overlay (the HUD is inert while paused).
    if (o && o.isConnected && !o.closest('[inert]') && o.getClientRects().length) o.focus({ preventScroll: true });
    else if (document.body.classList.contains('paused')) document.getElementById('pause')?.focus({ preventScroll: true });
  }

  private refresh(): void {
    const view = this.view;
    if (!view) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.root.className = `acct-sheet ${view.card ? 'acct-card' : 'acct-list'}`;
    this.root.setAttribute('aria-label', view.label);
    view.render(this.inner);
    if (hadFocus && !this.root.contains(document.activeElement)) this.root.focus({ preventScroll: true });
  }

  /** Escape closes; Tab stays inside; P never reaches the game's pause key. Capture phase, so nothing else sees them. */
  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      const stops = [...this.root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter(
        (n) => !(n instanceof HTMLButtonElement && n.disabled) && n.getClientRects().length > 0,
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!this.root.contains(at) || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.stopPropagation();
    }
  }
}
```

- [ ] **Step 5: Write `src/ui/account-cards.ts` and `src/ui/board-sheets.ts`**

`src/ui/account-cards.ts`:

```ts
import { signInHref } from '../api/client';
import { NAME_RULE } from '../api/names';
import type { User } from '../api/types';
import { esc, formatMs } from './format';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export interface SignInOptions {
  /** A finished signed-out run waiting to be saved: its ranked time. */
  pendingMs?: number | null;
  /** Runs just before the browser leaves for Google (Save to leaderboard marks its run here). */
  beforeLeave?: () => void;
  /** Where to land after signing in (default: this page). */
  returnPath?: string;
}

/** Sign-in (spec §6): Google's own button, one line about names and email, and the privacy link. */
export function signInView(o: SignInOptions, peek: boolean): SheetView {
  return {
    label: 'Sign in',
    card: true,
    focus: '.acct-google',
    render(inner) {
      const pending = o.pendingMs != null;
      inner.innerHTML = `<div class="acct-emb">${I.trophy}</div>
        <h2 class="acct-title">${pending ? 'Save this time' : 'Join the leaderboard'}</h2>
        ${pending ? `<p class="acct-pending">Your <b>${formatMs(o.pendingMs ?? 0)}</b> is waiting on this device.</p>` : '<p class="acct-lede">Put your fastest trees on the all-time leaderboard.</p>'}
        <a class="acct-google" href="${esc(signInHref(o.returnPath ?? location.pathname + location.search))}">${G_LOGO}<span>Continue with Google</span></a>
        <p class="acct-fine">Your name on the leaderboard is the one you pick. We never show your email. <a href="/privacy">Privacy</a></p>
        ${peek ? '<button class="acct-text" type="button" data-act="peek">Just looking? See the leaderboard</button>' : ''}`;
      inner.querySelector('.acct-google')?.addEventListener('click', () => o.beforeLeave?.());
    },
  };
}

export type NameStatus = 'empty' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'error' | 'saving' | 'failed';
export interface NameState {
  status: NameStatus;
  value: string;
}

/** The line under the name field, as HTML. */
export function nameMessage(s: NameState): string {
  const n = `“${esc(s.value.trim())}”`;
  switch (s.status) {
    case 'empty':
      return `<span class="acct-ci">${I.pen}</span><span>Pick something festive, or just your name.</span>`;
    case 'checking':
      return `<span class="acct-spin" aria-hidden="true"></span><span>Checking ${n}…</span>`;
    case 'saving':
      return `<span class="acct-spin" aria-hidden="true"></span><span>Saving ${n}…</span>`;
    case 'available':
      return `<span class="acct-ci">${I.check}</span><span>${n} is available</span>`;
    case 'taken':
      return `<span class="acct-ci">${I.cross}</span><span>${n} is taken. Try another.</span>`;
    case 'reserved':
      return `<span class="acct-ci">${I.cross}</span><span>That name is reserved</span>`;
    case 'invalid':
      return `<span class="acct-ci">${I.warn}</span><span>${s.value.trim().length < 3 ? 'At least 3 characters' : 'Letters, numbers, spaces, - and _ only'}</span>`;
    case 'error':
      return `<span class="acct-ci">${I.warn}</span><span>Couldn't check that name. You can still try to save it.</span>`;
    case 'failed':
      return `<span class="acct-ci">${I.warn}</span><span>Couldn't save your name. Try again.</span>`;
  }
}

export const canSaveName = (s: NameStatus): boolean => s === 'available' || s === 'error' || s === 'failed';

export interface NameCardHooks {
  input(value: string): void;
  save(): void;
}

/** Shown once after the first sign-in (spec §6). A name is chosen once. */
export function nameView(h: NameCardHooks): SheetView {
  return {
    label: 'Pick a display name',
    card: true,
    focus: '.acct-input',
    render(inner) {
      inner.innerHTML = `<div class="acct-emb">${I.pen}</div>
        <h2 class="acct-title">Pick a display name</h2>
        <p class="acct-lede">This is how you'll appear on the leaderboard. It can't be changed later.</p>
        <div class="acct-field"><input class="acct-input" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" aria-label="Display name" aria-describedby="acct-check"><span class="acct-count" aria-hidden="true">0/20</span></div>
        <p class="acct-check" id="acct-check" aria-live="polite"></p>
        <button class="acct-primary" type="button" data-act="save-name" disabled>Save name</button>
        <p class="acct-fine">${NAME_RULE}. Keep it kind.</p>`;
      const field = inner.querySelector<HTMLInputElement>('.acct-input');
      field?.addEventListener('input', () => h.input(field.value));
      field?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        h.save();
      });
    },
  };
}

/** Paints a name state into the open name card without re-rendering it, so the field keeps focus. */
export function paintName(inner: HTMLElement, s: NameState): void {
  const line = inner.querySelector<HTMLElement>('.acct-check');
  const field = inner.querySelector<HTMLElement>('.acct-field');
  const save = inner.querySelector<HTMLButtonElement>('[data-act="save-name"]');
  const count = inner.querySelector<HTMLElement>('.acct-count');
  if (!line || !field || !save) return;
  line.dataset.state = s.status;
  field.dataset.state = s.status;
  line.innerHTML = nameMessage(s);
  save.disabled = !canSaveName(s.status);
  if (count) count.textContent = `${s.value.trim().length}/20`;
}

/** The delete card's confirmation: the name in any case, or (before a name is picked) the Google email. */
export function confirmMatches(user: User, typed: string): boolean {
  const t = typed.trim().toLowerCase();
  return user.name ? t === user.name.toLowerCase() : /^[^\s@]+@[^\s@]+$/.test(t);
}

/** Delete account (spec §6): type your name to confirm. The user, sessions and games go. */
export function deleteView(user: User): SheetView {
  return {
    label: 'Delete account',
    card: true,
    focus: '#acct-confirm',
    render(inner) {
      const what = user.name ? `your name, <b>${esc(user.name)}</b>,` : 'the email of your Google account';
      inner.innerHTML = `<div class="acct-emb danger">${I.warn}</div>
        <h2 class="acct-title">Delete your account?</h2>
        <p class="acct-lede">Your name and every game you saved leave the leaderboard for good. This can't be undone.</p>
        <label class="acct-confirm-l" for="acct-confirm">Type ${what} to confirm</label>
        <div class="acct-field"><input class="acct-input" id="acct-confirm" type="text" autocomplete="off" spellcheck="false"></div>
        <p class="acct-check" aria-live="polite"></p>
        <div class="acct-btnrow"><button class="acct-secondary" type="button" data-act="cancel">Keep account</button><button class="acct-danger" type="button" data-act="confirm-delete" disabled>Delete account</button></div>
        <p class="acct-fine">Games on this device stay here, unranked.</p>`;
      const input = inner.querySelector<HTMLInputElement>('#acct-confirm');
      const go = inner.querySelector<HTMLButtonElement>('[data-act="confirm-delete"]');
      input?.addEventListener('input', () => {
        if (go) go.disabled = !confirmMatches(user, input.value);
      });
    },
  };
}
```

`src/ui/board-sheets.ts`:

```ts
import type { BoardResponse, BoardRow, MyGamesResponse, RecentGame, User } from '../api/types';
import { esc, formatDay, formatMs, formatWhen, plural, UNRANKED_TEXT } from './format';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export type ListTab = 'board' | 'games';
export type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

function rowHtml(r: BoardRow, now: number): string {
  const top = r.rank <= 3 ? ` acct-top acct-top${r.rank}` : '';
  return `<li class="acct-row${top}${r.mine ? ' acct-me' : ''}"${r.mine ? ' aria-current="true"' : ''}>
    <span class="acct-rank">${r.rank}</span>
    <span class="acct-name"><span class="acct-nm">${esc(r.name)}</span>${r.mine ? '<span class="acct-you">You</span>' : ''}</span>
    <span class="acct-lead" aria-hidden="true"></span>
    <span class="acct-time">${formatMs(r.ms)}</span>
    <span class="acct-date">${formatDay(r.finishedAt, now)}</span></li>`;
}

function boardBody(b: Loadable<BoardResponse>, now: number): string {
  if (b.status === 'loading') return '<p class="acct-note">Loading…</p>';
  if (b.status === 'error') return `<p class="acct-note">Couldn't load the leaderboard.</p><button class="acct-text" type="button" data-act="reload">Try again</button>`;
  if (!b.data.rows.length) return '<p class="acct-note">No ranked runs yet. Light a tree and be the first.</p>';
  return `<ol class="acct-rows">${b.data.rows.map((r) => rowHtml(r, now)).join('')}</ol>`;
}

function boardPin(b: Loadable<BoardResponse>, user: User | null | undefined, now: number): string {
  if (!user)
    return `<div class="acct-pin-cta"><span>Sign in to see your name on the list</span><button class="acct-google sm" type="button" data-act="signin">${G_LOGO}<span>Sign in</span></button></div>`;
  if (user.name === null) return '<div class="acct-pin-cta"><span>Pick a display name to join the board</span><button class="acct-text" type="button" data-act="name">Pick a name</button></div>';
  if (b.status !== 'ready') return '';
  const you = b.data.you;
  return you
    ? `<ol class="acct-rows">${rowHtml(you, now)}</ol><p class="acct-pin-note">Your best · #${you.rank} of ${plural(b.data.total, 'run')}</p>`
    : `<p class="acct-pin-note">${plural(b.data.total, 'ranked run')}</p>`;
}

function gameHtml(g: RecentGame, now: number): string {
  const [cls, label] = g.isBest ? ['s-best', 'Personal best'] : g.ranked ? ['s-counted', 'Ranked'] : ['', `Unranked · ${UNRANKED_TEXT[g.reason ?? 'anonymous']}`];
  return `<li class="acct-game${g.ranked ? '' : ' un'}">
    <span class="acct-gt">${formatMs(g.ms)}${g.isBest ? `<span class="acct-star">${I.star}</span>` : ''}</span>
    <span class="acct-when">${esc(formatWhen(g.finishedAt, now))}</span>
    <span class="acct-status ${cls}">${label}</span></li>`;
}

function gamesBody(g: Loadable<MyGamesResponse>, user: User | null | undefined, now: number): string {
  if (!user)
    return `<div class="acct-empty"><div class="acct-emb">${I.list}</div><h3>Keep every tree</h3>
      <p class="acct-lede">Sign in to keep your games and put your best time on the leaderboard.</p>
      <button class="acct-google" type="button" data-act="signin">${G_LOGO}<span>Continue with Google</span></button>
      <p class="acct-fine">Wins on this device are added when you sign in.</p></div>`;
  if (g.status === 'loading') return '<p class="acct-note">Loading…</p>';
  if (g.status === 'error') return `<p class="acct-note">Couldn't load your games.</p><button class="acct-text" type="button" data-act="reload">Try again</button>`;
  const d = g.data;
  const stats = `<div class="acct-stats">
      <div><b>${d.best ? formatMs(d.best.ms) : '–'}</b><span>Your best</span></div>
      <div><b>${d.best?.rank ? `#${d.best.rank}` : '–'}</b><span>of ${plural(d.total, 'run')}</span></div>
      <div><b>${d.inTop}</b><span>In the top 50</span></div></div>`;
  const list = d.games.length ? `<ul class="acct-games">${d.games.map((x) => gameHtml(x, now)).join('')}</ul>` : '<p class="acct-note">No games yet. Light a tree to see it here.</p>';
  const links = `<div class="acct-links"><p>Signed in with Google${user.name ? ` as <b>${esc(user.name)}</b>` : ''}</p>
      <div><button type="button" data-act="signout">Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div></div>`;
  return `${stats}<h3 class="acct-h3">Recent games</h3>${list}${links}`;
}

/** The leaderboard and Your games: one sheet, two tabs (spec §6, pick 2C). */
export function listView(tab: ListTab, board: Loadable<BoardResponse>, games: Loadable<MyGamesResponse>, user: User | null | undefined, now: number): SheetView {
  return {
    label: tab === 'board' ? 'Leaderboard' : 'Your games',
    card: false,
    render(inner) {
      const sub =
        tab === 'board' ? `All-time · ${board.status === 'ready' ? plural(board.data.total, 'ranked run') : 'fastest trees'}` : user?.name ? `${esc(user.name)} · your trees` : 'Not signed in';
      inner.innerHTML = `<header class="acct-head">
          <div class="acct-emb">${I.trophy}</div>
          <div class="acct-titles"><h2 class="acct-title">${tab === 'board' ? 'Leaderboard' : 'Your games'}</h2><p class="acct-sub">${sub}</p></div>
          <div class="acct-tabs" role="tablist" aria-label="Leaderboard views">
            <button role="tab" type="button" data-act="tab-board" aria-selected="${tab === 'board'}">Leaderboard</button>
            <button role="tab" type="button" data-act="tab-games" aria-selected="${tab === 'games'}">Your games</button>
          </div>
        </header>
        <div class="acct-body">${tab === 'board' ? boardBody(board, now) : gamesBody(games, user, now)}</div>
        ${tab === 'board' ? `<footer class="acct-pin">${boardPin(board, user, now)}</footer>` : ''}`;
    },
  };
}
```

- [ ] **Step 6: Write `src/ui/account-menu.ts` and `src/ui/accounts.ts`**

`src/ui/account-menu.ts`:

```ts
import type { SessionState } from '../api/session';
import { esc, formatMs, initial } from './format';
import { bow, I } from './icons';

/** The menu head's line under the name. */
export interface MenuSummary {
  rank: number | null;
  best: number | null;
}

export interface AccountMenuHooks {
  /** The menu is opening (the app closes its other dialogs; the summary loads). */
  open(): void;
  /** A [data-act] item was chosen; `chip` is where focus goes back to. */
  act(act: string, chip: HTMLElement): void;
  /** Signed out, the chip opens the sign-in card instead of the menu. */
  signIn(chip: HTMLElement): void;
  /** The chip changed width: the HUD refits. */
  fit(): void;
}

/** The HUD account chip beside the ··· button, and its menu (pick 1A). */
export class AccountMenu {
  readonly chip = document.createElement('button');
  private readonly drop = document.createElement('div');
  private user: SessionState = undefined;
  private summary: MenuSummary | null = null;

  constructor(private readonly hooks: AccountMenuHooks) {
    const chip = this.chip;
    chip.type = 'button';
    chip.className = 'pill acct-chip';
    chip.id = 'account-chip';
    chip.hidden = true; // until /api/me answers
    document.getElementById('menu-btn')?.before(chip);
    this.drop.className = 'acct-drop';
    this.drop.id = 'account-menu';
    this.drop.setAttribute('role', 'dialog');
    this.drop.setAttribute('aria-label', 'Account');
    this.drop.hidden = true;
    document.body.append(this.drop);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.user) this.hooks.signIn(chip);
      else if (this.drop.hidden) this.open();
      else this.close(true);
    });
    this.drop.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!t) return; // Radio admin and Privacy are links
      e.preventDefault();
      this.close(false);
      this.hooks.act(t.dataset.act ?? '', chip);
    });
    // An outside tap closes the menu; a tap on the stage only closes it (App.tap checks menuOpen), as with the settings menu.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!this.drop.hidden && t && !this.drop.contains(t) && !chip.contains(t) && t !== document.getElementById('stage')) this.close(false);
    });
    addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || this.drop.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.drop.hidden;
  }

  get hasFocus(): boolean {
    return this.drop.contains(document.activeElement);
  }

  render(user: SessionState, summary: MenuSummary | null = this.summary): void {
    this.user = user;
    this.summary = summary;
    const chip = this.chip;
    chip.hidden = user === undefined;
    if (!user) {
      this.close(false);
      chip.classList.remove('me');
      chip.innerHTML = `${I.person}<span class="acct-chip-l">Sign in</span>`;
      chip.setAttribute('aria-label', 'Sign in');
      chip.removeAttribute('aria-haspopup');
      chip.removeAttribute('aria-expanded');
    } else {
      const shown = user.name ?? 'Account';
      const refocus = this.hasFocus;
      chip.classList.add('me');
      chip.innerHTML = `<span class="acct-av">${initial(shown)}</span><span class="acct-chip-l">${esc(shown)}</span>`;
      chip.setAttribute('aria-label', `Account: ${shown}`);
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.setAttribute('aria-expanded', String(!this.drop.hidden));
      const sub = !summary ? '&nbsp;' : summary.best === null ? 'No ranked runs yet' : `${summary.rank === null ? '' : `#${summary.rank} all-time · `}best ${formatMs(summary.best)}`;
      this.drop.innerHTML = `<span class="acct-band" aria-hidden="true"></span>${bow('acct-dbow')}
        <div class="acct-drop-head"><span class="acct-av lg">${initial(shown)}</span><div><b>${esc(user.name ?? 'No name yet')}</b><small>${sub}</small></div></div>
        ${user.name === null ? `<button class="acct-item" type="button" data-act="name"><span class="acct-dot">${I.pen}</span><span>Pick a display name</span></button>` : ''}
        <button class="acct-item" type="button" data-act="board"><span class="acct-dot">${I.trophy}</span><span>Leaderboard</span>${summary?.rank ? `<span class="acct-r">#${summary.rank}</span>` : ''}</button>
        <button class="acct-item" type="button" data-act="games"><span class="acct-dot">${I.list}</span><span>Your games</span></button>
        ${user.isAdmin ? `<a class="acct-item" href="/admin"><span class="acct-dot">${I.radio}</span><span>Radio admin</span></a>` : ''}
        <div class="acct-drop-foot"><button type="button" data-act="signout">${I.out}Sign out</button><button type="button" class="danger" data-act="delete">Delete account</button><a href="/privacy">Privacy</a></div>`;
      if (refocus) this.drop.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true });
    }
    this.hooks.fit();
  }

  open(): void {
    this.hooks.open();
    this.drop.hidden = false;
    this.chip.setAttribute('aria-expanded', 'true');
    this.drop.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true });
  }

  close(focusChip: boolean): void {
    if (this.drop.hidden) return;
    const active = document.activeElement;
    this.drop.hidden = true;
    this.chip.setAttribute('aria-expanded', 'false');
    if (focusChip || this.drop.contains(active)) this.chip.focus({ preventScroll: true });
  }
}
```

`src/ui/accounts.ts`:

```ts
import { api, ApiError } from '../api/client';
import { cleanName, isReserved } from '../api/names';
import type { Session, SessionState } from '../api/session';
import type { BoardResponse, MyGamesResponse } from '../api/types';
import { canSaveName, deleteView, nameView, paintName, signInView, type NameState, type NameStatus, type SignInOptions } from './account-cards';
import { AccountMenu } from './account-menu';
import { listView, type ListTab, type Loadable } from './board-sheets';
import { Sheet } from './sheet';

export interface AccountsHooks {
  /** A sheet is about to cover the game: pause a game in progress. */
  pause(): void;
  /** The account menu is opening: close the settings menu and the radio panel. */
  closeOthers(): void;
  fitHud(): void;
  toast(text: string, ms?: number): void;
}

/** The name card opens by itself once per browser session for an account without a name. */
const NAME_ASKED = 'aglow.nameAsked';
const CHECK_DELAY_MS = 400;

/** Everything account-shaped on the game page (spec §6): the chip and its menu, the sheets and the cards. */
export class Accounts {
  private readonly sheet: Sheet;
  private readonly menu: AccountMenu;
  private tab: ListTab = 'board';
  private board: Loadable<BoardResponse> = { status: 'loading' };
  private games: Loadable<MyGamesResponse> = { status: 'loading' };
  private name: NameState = { status: 'empty', value: '' };
  private nameTimer = 0;
  private nameSeq = 0;
  private deleting = false;

  constructor(
    private readonly session: Session,
    private readonly hooks: AccountsHooks,
  ) {
    this.sheet = new Sheet({
      onOpen: () => {
        this.menu.close(false);
        hooks.pause();
      },
      onAct: (act, el) => this.act(act, el),
    });
    this.menu = new AccountMenu({
      open: () => {
        hooks.closeOthers();
        void this.loadSummary();
      },
      act: (act, chip) => this.act(act, chip),
      signIn: (chip) => this.openSignIn({}, chip),
      fit: () => hooks.fitHud(),
    });
    session.subscribe((s) => this.onSession(s));
    this.noteFailedSignIn();
  }

  /** Keys belong to the sheet or the account menu while either has them. */
  get blocksKeys(): boolean {
    return this.sheet.isOpen || this.menu.hasFocus;
  }

  get menuOpen(): boolean {
    return this.menu.isOpen;
  }

  get sheetOpen(): boolean {
    return this.sheet.isOpen;
  }

  closeMenu(): void {
    this.menu.close(false);
  }

  openSignIn(o: SignInOptions = {}, from?: HTMLElement | null): void {
    this.sheet.open(signInView(o, o.pendingMs == null), from);
  }

  openName(from?: HTMLElement | null): void {
    clearTimeout(this.nameTimer);
    this.name = { status: 'empty', value: '' };
    this.sheet.open(nameView({ input: (v) => this.onNameInput(v), save: () => void this.saveName() }), from);
    paintName(this.sheet.body, this.name);
  }

  openDelete(from?: HTMLElement | null): void {
    const user = this.session.current;
    if (user) this.sheet.open(deleteView(user), from);
  }

  openBoard(from?: HTMLElement | null): void {
    this.tab = 'board';
    this.sheet.open(this.listNow(), from);
    void this.loadBoard();
  }

  openGames(from?: HTMLElement | null): void {
    this.tab = 'games';
    this.sheet.open(this.listNow(), from);
    void this.loadGames();
  }

  private listNow() {
    return listView(this.tab, this.board, this.games, this.session.current, Date.now());
  }

  /** Redraws the leaderboard or Your games when its data arrives, if that list is still on screen. */
  private refreshList(): void {
    const v = this.sheet.current;
    if (v && !v.card) this.sheet.update(this.listNow());
  }

  private async loadBoard(): Promise<void> {
    try {
      this.board = { status: 'ready', data: await api.board() };
    } catch {
      if (this.board.status !== 'ready') this.board = { status: 'error' };
    }
    this.refreshList();
  }

  private async loadGames(): Promise<void> {
    if (!this.session.current) return;
    try {
      this.games = { status: 'ready', data: await api.myGames() };
    } catch {
      if (this.games.status !== 'ready') this.games = { status: 'error' };
    }
    this.refreshList();
  }

  /** The menu head: your rank and best, when the menu opens. */
  private async loadSummary(): Promise<void> {
    try {
      const g = await api.myGames();
      this.games = { status: 'ready', data: g };
      if (this.session.current) this.menu.render(this.session.current, { rank: g.best?.rank ?? null, best: g.best?.ms ?? null });
    } catch {
      // the menu works without it
    }
  }

  private onSession(user: SessionState): void {
    this.menu.render(user, null);
    this.games = { status: 'loading' };
    this.refreshList();
    if (user && user.name === null && !this.sheet.isOpen && this.firstNameAsk()) this.openName();
  }

  private firstNameAsk(): boolean {
    try {
      if (sessionStorage.getItem(NAME_ASKED)) return false;
      sessionStorage.setItem(NAME_ASKED, '1');
    } catch {
      // storage blocked: ask anyway
    }
    return true;
  }

  private onNameInput(value: string): void {
    clearTimeout(this.nameTimer);
    const seq = ++this.nameSeq;
    const name = cleanName(value);
    if (!value.trim()) this.paint({ status: 'empty', value });
    else if (!name) this.paint({ status: 'invalid', value });
    else if (isReserved(name)) this.paint({ status: 'reserved', value });
    else {
      this.paint({ status: 'checking', value });
      this.nameTimer = window.setTimeout(() => {
        api.checkName(name).then(
          (r) => seq === this.nameSeq && this.paint({ status: r.available ? 'available' : (r.reason ?? 'taken'), value }),
          () => seq === this.nameSeq && this.paint({ status: 'error', value }),
        );
      }, CHECK_DELAY_MS);
    }
  }

  private paint(s: NameState): void {
    this.name = s;
    paintName(this.sheet.body, s);
  }

  private async saveName(): Promise<void> {
    const s = this.name;
    const name = cleanName(s.value);
    if (!name || !canSaveName(s.status)) return;
    this.nameSeq++;
    this.paint({ status: 'saving', value: s.value });
    try {
      const { user } = await api.setName(name);
      this.sheet.close();
      this.session.set(user);
      this.hooks.toast(`Welcome, ${name}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_name') {
        this.sheet.close();
        void this.session.load();
        return;
      }
      // A name taken between the check and the save: say so, and keep the card open (spec §8).
      const known: NameStatus[] = ['taken', 'reserved', 'invalid'];
      const status = e instanceof ApiError && known.includes(e.code as NameStatus) ? (e.code as NameStatus) : 'failed';
      this.paint({ status, value: s.value });
    }
  }

  private async confirmDelete(): Promise<void> {
    const input = this.sheet.body.querySelector<HTMLInputElement>('#acct-confirm');
    const line = this.sheet.body.querySelector<HTMLElement>('.acct-check');
    if (!input || this.deleting) return;
    this.deleting = true;
    try {
      await api.deleteAccount(input.value.trim());
      this.sheet.close();
      this.session.set(null);
      this.hooks.toast('Account deleted');
    } catch (e) {
      if (line) line.textContent = e instanceof ApiError && e.code === 'confirm' ? "That doesn't match. Type it exactly as shown." : "Couldn't delete your account right now. Try again.";
    } finally {
      this.deleting = false;
    }
  }

  private async signOut(): Promise<void> {
    await this.session.signOut();
    this.hooks.toast('Signed out');
  }

  private act(act: string, el: HTMLElement): void {
    switch (act) {
      case 'board':
      case 'peek':
        this.openBoard(el);
        break;
      case 'games':
        this.openGames(el);
        break;
      case 'tab-board':
      case 'tab-games':
        this.tab = act === 'tab-board' ? 'board' : 'games';
        this.sheet.update(this.listNow());
        this.sheet.body.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
        void (this.tab === 'board' ? this.loadBoard() : this.loadGames());
        break;
      case 'reload':
        void (this.tab === 'board' ? this.loadBoard() : this.loadGames());
        break;
      case 'signin':
        this.openSignIn({}, el);
        break;
      case 'name':
        this.openName(el);
        break;
      case 'save-name':
        void this.saveName();
        break;
      case 'signout':
        this.sheet.close();
        void this.signOut();
        break;
      case 'delete':
        this.openDelete(el);
        break;
      case 'confirm-delete':
        void this.confirmDelete();
        break;
      case 'cancel':
        this.sheet.close();
        break;
    }
  }

  /** ?auth=failed (any sign-in callback failure): say so once, and drop it from the address. */
  private noteFailedSignIn(): void {
    if (new URLSearchParams(location.search).get('auth') !== 'failed') return;
    // Rebuilt by hand: URLSearchParams would turn a bare "?test" into "?test=".
    const rest = location.search
      .slice(1)
      .split('&')
      .filter((p) => p && p.split('=')[0] !== 'auth');
    history.replaceState(history.state, '', `${location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${location.hash}`);
    this.hooks.toast("Sign-in didn't finish. Try again.", 3200);
  }
}
```

- [ ] **Step 7: Run the unit tests to verify they pass**

Run: `npx vitest run tests/unit/ui`
Expected: PASS.

- [ ] **Step 8: Write the stylesheet**

Create `src/ui/account.css` with exactly this content (the mockup's shared rules, entry A and the glass skin, merged and renamed `mk-` → `acct-`; the results-tag rules come in Task 9):

```css
/* =====================================================================
   Accounts (spec 2026-10-07 §6): the HUD chip and its menu (pick 1A), and
   sheets and cards in the radio panel's dark glass (pick 2C).
   ===================================================================== */

.toast { z-index: 60; }

/* ---------- shared bits ---------- */
.acct-g { width: 18px; height: 18px; flex: none; display: block; }
.acct-av {
  width: 26px; height: 26px; border-radius: 50%; flex: none; display: grid; place-items: center; padding-top: 1px;
  font: italic 400 17px/1 'Instrument Serif', serif; color: #6e0f1b;
  background: radial-gradient(120% 90% at 35% 15%, rgba(255, 255, 240, 0.75), transparent 55%), linear-gradient(180deg, #fbe4a6, #d6a24a 60%, #b9822f);
  box-shadow: inset 0 1px 0 rgba(255, 250, 225, 0.75), inset 0 -1px 2px rgba(120, 70, 20, 0.35), 0 0 0 1px rgba(255, 230, 160, 0.4), 0 0 10px rgba(255, 190, 90, 0.3);
}
.acct-av.lg { width: 40px; height: 40px; font-size: 25px; }

/* Google's light "Continue with Google" button (branding: white fill, #747775 stroke, #1f1f1f text). */
.acct-google {
  all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; height: 44px; padding: 0 18px; border-radius: 999px; background: #fff; border: 1px solid #747775; color: #1f1f1f;
  font: 500 14px/20px Inter, system-ui, sans-serif; letter-spacing: 0.01em; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 3px 10px rgba(0, 0, 0, 0.08);
  transition: background 0.15s, box-shadow 0.15s;
}
.acct-google:hover { background: #f8f9fa; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16), 0 4px 14px rgba(0, 0, 0, 0.12); }
.acct-google.sm { width: auto; height: 34px; padding: 0 14px; font-size: 13px; gap: 8px; }
.acct-google.sm .acct-g { width: 15px; height: 15px; }
.acct-google:focus-visible { outline: 2px solid #1a73e8; outline-offset: 3px; }

.acct-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: acct-spin 0.7s linear infinite; flex: none; opacity: 0.7; }
@keyframes acct-spin { to { transform: rotate(360deg); } }
@keyframes acct-fade { from { opacity: 0; } }
@keyframes acct-drop-in { from { opacity: 0; transform: translateY(-6px) scale(0.985); } }
@keyframes acct-sheet-in { from { transform: translateY(40px); opacity: 0.4; } }

/* ---------- the HUD chip (1A) ---------- */
.acct-chip { padding: 0 14px 0 11px; gap: 7px; }
.acct-chip > svg { width: 14px; height: 14px; flex: none; opacity: 0.9; filter: drop-shadow(0 0 3px rgba(255, 200, 120, 0.25)); }
.acct-chip.me { padding: 0 14px 0 3px; }
.acct-chip-l { white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
/* fitHud() falls back to the initial (or the person icon) when the HUD would reach the wordmark. */
.acct-chip[data-fit='icon'] { width: 38px; padding: 0 !important; justify-content: center; }
.acct-chip.me[data-fit='icon'] { width: 32px; }
.acct-chip[data-fit='icon'] .acct-chip-l { display: none; }

/* ---------- the account menu ---------- */
.acct-drop {
  position: fixed; z-index: 30; top: calc(68px + env(safe-area-inset-top)); right: calc(28px + env(safe-area-inset-right)); width: 280px;
  padding: 36px 10px 10px; border-radius: 18px; color: #f6e7c8;
  background:
    repeating-linear-gradient(135deg, rgba(255, 220, 160, 0.022) 0 6px, transparent 6px 14px),
    radial-gradient(120% 70% at 30% 0%, rgba(190, 40, 52, 0.35), transparent 70%),
    linear-gradient(180deg, rgba(70, 10, 18, 0.92), rgba(28, 8, 10, 0.94));
  border: 1px solid var(--goldline);
  backdrop-filter: blur(24px) saturate(1.2); -webkit-backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: inset 0 1px 0 rgba(255, 210, 160, 0.14), 0 24px 60px rgba(0, 0, 0, 0.45);
  animation: acct-drop-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* Satin ribbon band and bow, as on the settings menu and the radio panel. */
.acct-drop .acct-band, .acct-sheet::before {
  content: ''; position: absolute; left: 0; right: 0; top: 12px; height: 10px; pointer-events: none;
  background: linear-gradient(180deg, #f6dc98 0%, #e2b560 35%, #b98636 75%, #8f5f22 100%);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.25);
}
.acct-drop .bow, .acct-sheet .bow { position: absolute; left: 50%; top: -9px; width: 60px; height: 38px; transform: translateX(-50%); pointer-events: none; filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.4)); z-index: 2; }
.acct-drop-head { display: flex; align-items: center; gap: 12px; padding: 4px 8px 12px; }
.acct-drop-head b { display: block; font: 400 21px/1.1 'Instrument Serif', serif; color: #fff3dc; text-shadow: 0 1px 12px rgba(255, 180, 90, 0.2); }
.acct-drop-head small { display: block; margin-top: 3px; font-size: 11.5px; color: rgba(246, 231, 200, 0.6); font-variant-numeric: tabular-nums; }
.acct-item {
  all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 7px 10px 7px 8px; border-radius: 12px;
  cursor: pointer; font-size: 13.5px; font-weight: 500; color: #fbefd8; transition: background 0.15s;
}
.acct-item:hover { background: rgba(255, 220, 160, 0.07); }
.acct-item .acct-r { margin-left: auto; font-size: 11.5px; color: #f3d492; font-variant-numeric: tabular-nums; }
.acct-dot {
  width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center; color: #f3d492;
  background: radial-gradient(90% 80% at 35% 20%, rgba(255, 230, 190, 0.18), transparent 60%), linear-gradient(180deg, rgba(120, 22, 32, 0.9), rgba(52, 8, 14, 0.9));
  box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.3), inset 0 1px 0 rgba(255, 220, 180, 0.2), 0 2px 6px rgba(0, 0, 0, 0.35);
}
.acct-dot svg { width: 16px; height: 16px; display: block; filter: drop-shadow(0 0 4px rgba(255, 196, 100, 0.35)); }
.acct-drop-foot { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 8px; padding: 11px 6px 3px; border-top: 1px solid rgba(236, 196, 116, 0.16); }
.acct-drop-foot button, .acct-drop-foot a { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: rgba(246, 231, 200, 0.68); }
.acct-drop-foot svg { width: 13px; height: 13px; }
.acct-drop-foot button:hover, .acct-drop-foot a:hover { color: #fff3dc; }
.acct-drop-foot .danger { color: #ffab9a; }
.acct-drop button:focus-visible, .acct-drop a:focus-visible { outline: 2px solid #ffe2a0; outline-offset: 2px; }

/* ---------- the sheet (2C): leaderboard, your games, and the small cards ---------- */
.acct-scrim {
  position: fixed; inset: 0; z-index: 40;
  background: radial-gradient(120% 90% at 50% 42%, rgba(12, 4, 2, 0.28), rgba(12, 4, 2, 0.62));
  animation: acct-fade 0.25s ease-out;
}
body[data-scene='frost'] .acct-scrim { background: radial-gradient(120% 90% at 50% 42%, rgba(30, 44, 54, 0.18), rgba(30, 44, 54, 0.42)); }
.acct-sheet:focus { outline: none; }
.acct-sheet {
  position: fixed; z-index: 41; top: calc(68px + env(safe-area-inset-top)); right: calc(28px + env(safe-area-inset-right));
  width: 390px; max-height: calc(100vh - 92px - env(safe-area-inset-top)); display: flex; flex-direction: column;
  color: #f6e7c8; padding-top: 32px; border-radius: 20px;
  background:
    repeating-linear-gradient(135deg, rgba(255, 220, 160, 0.022) 0 6px, transparent 6px 14px),
    radial-gradient(110% 45% at 25% 0%, rgba(190, 40, 52, 0.38), transparent 70%),
    radial-gradient(90% 40% at 100% 100%, rgba(150, 24, 34, 0.22), transparent 70%),
    linear-gradient(180deg, rgba(72, 10, 18, 0.94), rgba(28, 8, 10, 0.95));
  border: 1px solid var(--goldline);
  backdrop-filter: blur(24px) saturate(1.2); -webkit-backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: inset 0 1px 0 rgba(255, 210, 160, 0.14), 0 30px 80px rgba(0, 0, 0, 0.5), 0 2px 10px rgba(0, 0, 0, 0.3);
  animation: acct-drop-in 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.acct-sheet.acct-card { width: 360px; }
.acct-grab { display: none; }
.acct-inner { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.acct-card .acct-inner { align-items: stretch; text-align: center; padding: 12px 26px 22px; overflow-y: auto; }
.acct-x {
  all: unset; position: absolute; z-index: 3; top: 32px; right: 10px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  cursor: pointer; color: #f6e7c8; opacity: 0.7; transition: background 0.15s, opacity 0.15s;
}
.acct-x:hover { opacity: 1; background: rgba(255, 220, 160, 0.08); }
.acct-x svg { width: 18px; height: 18px; display: block; }
.acct-sheet button:focus-visible, .acct-sheet a:focus-visible, .acct-sheet input:focus-visible { outline: 2px solid #ffe2a0; outline-offset: 2px; }

/* list header */
.acct-head { flex: none; display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 14px; text-align: left; padding: 14px 20px 0; }
.acct-titles { min-width: 0; display: flex; flex-direction: column; padding-right: 30px; }
.acct-title { margin: 0; font: 400 26px/1.1 'Instrument Serif', serif; color: #fff3dc; text-shadow: 0 1px 12px rgba(255, 180, 90, 0.2); }
.acct-sub { order: -1; margin: 0 0 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: #f0c977; }
.acct-emb {
  width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; margin: 0 auto 12px; flex: none; color: #f3d492;
  background: radial-gradient(70% 70% at 50% 62%, rgba(255, 170, 80, 0.32), transparent 70%), linear-gradient(160deg, #3a120c, #160604);
  box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.45), inset 0 1px 0 rgba(255, 236, 190, 0.3), 0 8px 22px rgba(0, 0, 0, 0.45), 0 0 26px rgba(255, 140, 60, 0.18);
}
.acct-emb svg { width: 26px; height: 26px; display: block; filter: drop-shadow(0 0 6px rgba(255, 196, 100, 0.6)); }
.acct-emb.danger { color: #ffab9a; }
.acct-head .acct-emb { width: 52px; height: 52px; margin: 0; border-radius: 14px; }
.acct-head .acct-emb svg { width: 25px; height: 25px; }
.acct-tabs { grid-column: 1 / -1; display: flex; margin: 14px 0 8px; padding: 3px; border-radius: 10px; background: rgba(0, 0, 0, 0.28); border: 1px solid rgba(236, 196, 116, 0.18); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35); }
.acct-tabs button { all: unset; flex: 1; text-align: center; cursor: pointer; padding: 8px 4px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: #f6e7c8; opacity: 0.78; }
.acct-tabs button[aria-selected='true'] { opacity: 1; font-weight: 600; background: linear-gradient(180deg, #f6dc98, #d6a24a 60%, #b9822f); color: #2a1206; box-shadow: inset 0 1px 0 rgba(255, 250, 225, 0.7), 0 1px 3px rgba(0, 0, 0, 0.4); }

/* list body and rows */
.acct-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; outline: none; padding: 2px 10px 8px;
  border-top: 1px solid rgba(236, 196, 116, 0.12); scrollbar-width: thin; scrollbar-color: rgba(236, 196, 116, 0.35) transparent;
}
.acct-note { margin: 18px 12px; font-size: 13px; color: rgba(246, 231, 200, 0.72); text-align: center; }
.acct-rows { list-style: none; margin: 0; padding: 6px 0 0; }
.acct-row { display: flex; align-items: center; gap: 12px; padding: 6px 12px 6px 8px; border-radius: 12px; }
.acct-row + .acct-row { margin-top: 1px; }
.acct-rank {
  flex: none; display: grid; place-items: center; font-variant-numeric: tabular-nums;
  width: 30px; height: 30px; border-radius: 9px; font-size: 12px; font-weight: 600; color: #f3d492;
  background: radial-gradient(90% 80% at 35% 20%, rgba(255, 230, 190, 0.16), transparent 60%), linear-gradient(180deg, rgba(120, 22, 32, 0.9), rgba(52, 8, 14, 0.9));
  box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.28), inset 0 1px 0 rgba(255, 220, 180, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35);
}
.acct-top .acct-rank { font: 600 12.5px/1 Inter, sans-serif; color: #4a2208; }
.acct-top1 .acct-rank { background: radial-gradient(circle at 36% 28%, #fffaf0, #f0cd80 40%, #b9822f 100%) !important; box-shadow: inset 0 -1px 2px rgba(120, 70, 20, 0.45), 0 0 0 1px rgba(150, 100, 30, 0.45), 0 2px 5px rgba(150, 90, 20, 0.35); }
.acct-top2 .acct-rank { background: radial-gradient(circle at 36% 28%, #ffffff, #d9dde2 42%, #8d949c 100%) !important; box-shadow: inset 0 -1px 2px rgba(60, 60, 70, 0.4), 0 0 0 1px rgba(110, 115, 125, 0.45), 0 2px 5px rgba(60, 60, 70, 0.3); color: #2a2e34 !important; }
.acct-top3 .acct-rank { background: radial-gradient(circle at 36% 28%, #ffe6cf, #d99a62 42%, #8f5326 100%) !important; box-shadow: inset 0 -1px 2px rgba(90, 40, 10, 0.45), 0 0 0 1px rgba(140, 80, 30, 0.45), 0 2px 5px rgba(120, 60, 20, 0.3); color: #3a1806 !important; }
.acct-name { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
.acct-nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; font-weight: 500; color: #fbefd8; }
.acct-lead { flex: 1 1 0; min-width: 10px; }
.acct-date { flex: none; width: 46px; text-align: right; font-size: 11px; color: rgba(246, 231, 200, 0.5); font-variant-numeric: tabular-nums; }
.acct-time { flex: none; font-variant-numeric: tabular-nums; font-size: 13px; color: rgba(246, 231, 200, 0.72); }
.acct-you { flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px; background: rgba(236, 196, 116, 0.16); color: #f3d492; box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.35); }
.acct-me { background: linear-gradient(90deg, rgba(236, 196, 116, 0.22), rgba(236, 196, 116, 0.07)); box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.4), inset 0 1px 0 rgba(255, 240, 200, 0.12); }
.acct-me .acct-time { color: #f3d492; font-weight: 600; }
.acct-me .acct-rank { color: #6e0f1b; background: radial-gradient(90% 80% at 35% 15%, rgba(255, 255, 240, 0.7), transparent 55%), linear-gradient(180deg, #fbe4a6, #d6a24a 60%, #b9822f); box-shadow: inset 0 1px 0 rgba(255, 250, 225, 0.75), 0 0 14px rgba(255, 190, 90, 0.35); }

/* the pinned footer */
.acct-pin { flex: none; padding: 8px 10px 12px; border-top: 1px solid rgba(236, 196, 116, 0.16); background: rgba(0, 0, 0, 0.16); border-radius: 0 0 19px 19px; box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.18); }
.acct-pin .acct-rows { padding-top: 0; }
.acct-pin-note { margin: 5px 0 0; text-align: center; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(240, 201, 119, 0.7); }
.acct-pin-cta { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 8px; font-size: 12.5px; color: rgba(246, 231, 200, 0.8); }

/* your games */
.acct-stats { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; padding: 14px 0; margin: 4px 0 6px; border-bottom: 1px solid rgba(236, 196, 116, 0.14); }
.acct-stats b { display: block; font-size: 19px; font-weight: 500; font-variant-numeric: tabular-nums; color: #fff3dc; }
.acct-stats span { font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase; color: #f0c977; opacity: 0.75; }
.acct-h3 { margin: 12px 0 6px; padding-left: 10px; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; color: #eccb86; opacity: 0.8; }
.acct-games { list-style: none; margin: 0; padding: 0; }
.acct-game { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center; padding: 8px 10px; border-radius: 10px; }
.acct-gt { grid-row: 1; grid-column: 1; font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 5px; color: #fbefd8; }
.acct-star svg { width: 13px; height: 13px; display: block; color: #d6a24a; }
.acct-when { grid-row: 2; grid-column: 1; font-size: 11px; opacity: 0.6; margin-top: 1px; }
.acct-status { grid-row: 1 / span 2; grid-column: 2; justify-self: end; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 9px; border-radius: 999px; white-space: nowrap; background: rgba(255, 220, 160, 0.08); color: rgba(246, 231, 200, 0.75); }
.acct-status.s-best { background: linear-gradient(180deg, #fbe4a6, #d6a24a); color: #4a1208; }
.acct-status.s-counted { background: rgba(236, 196, 116, 0.14); color: #f3d492; }
.acct-game.un .acct-gt { opacity: 0.5; }
.acct-game.un .acct-status { background: transparent; box-shadow: inset 0 0 0 1px rgba(246, 231, 200, 0.22); color: rgba(246, 231, 200, 0.55); font-weight: 500; }
.acct-empty { text-align: center; padding: 14px 26px 10px; }
.acct-empty h3 { margin: 0; font: 400 26px/1.1 'Instrument Serif', serif; color: #fff3dc; }
.acct-empty .acct-google { margin-top: 2px; }
.acct-links { text-align: center; padding: 16px 12px 6px; margin-top: 10px; font-size: 11.5px; border-top: 1px solid rgba(236, 196, 116, 0.12); color: rgba(246, 231, 200, 0.8); }
.acct-links p { margin: 0 0 8px; opacity: 0.7; }
.acct-links > div { display: flex; justify-content: center; flex-wrap: wrap; gap: 16px; }
.acct-links button, .acct-links a { all: unset; cursor: pointer; font-weight: 500; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
.acct-links button:hover, .acct-links a:hover { text-decoration-color: currentColor; }
.acct-links .danger { color: #ffab9a; }

/* cards: sign-in, name, delete */
.acct-card .acct-title { font: 400 30px/1.1 'Instrument Serif', serif; }
.acct-lede { margin: 8px 0 16px; font-size: 13.5px; line-height: 1.5; color: rgba(246, 231, 200, 0.78); }
.acct-fine { margin: 14px 0 0; font-size: 11px; line-height: 1.55; color: rgba(246, 231, 200, 0.5); }
.acct-fine a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.acct-text { all: unset; cursor: pointer; margin: 12px auto 0; font-size: 12.5px; font-weight: 500; color: #f3d492; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; transition: text-decoration-color 0.15s; }
.acct-text:hover { text-decoration-color: currentColor; }
.acct-pending { margin: 4px 0 16px; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.45; background: rgba(236, 196, 116, 0.1); box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.3); color: rgba(246, 231, 200, 0.85); }
.acct-pending b { font-variant-numeric: tabular-nums; color: #f3d492; }
.acct-field { position: relative; margin-top: 4px; }
.acct-input {
  box-sizing: border-box; width: 100%; height: 48px; padding: 0 54px 0 15px; font: 500 16px Inter, system-ui, sans-serif; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
  border-radius: 12px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(236, 196, 116, 0.28); color: #fbefd8; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
}
.acct-input:focus { border-color: rgba(243, 212, 146, 0.8); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(243, 212, 146, 0.14); }
.acct-count { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 11px; font-variant-numeric: tabular-nums; pointer-events: none; color: rgba(246, 231, 200, 0.45); }
.acct-confirm-l { display: block; margin: 0 0 8px; font-size: 12.5px; color: rgba(246, 231, 200, 0.78); }
.acct-confirm-l b { color: #f3d492; }
.acct-check { display: flex; align-items: center; justify-content: flex-start; gap: 7px; min-height: 20px; margin: 9px 2px 12px; font-size: 12.5px; text-align: left; color: rgba(246, 231, 200, 0.62); }
.acct-ci { width: 16px; height: 16px; flex: none; border-radius: 50%; display: grid; place-items: center; }
.acct-ci svg { width: 11px; height: 11px; display: block; }
.acct-check[data-state='empty'] .acct-ci svg, .acct-check[data-state='invalid'] .acct-ci svg, .acct-check[data-state='error'] .acct-ci svg, .acct-check[data-state='failed'] .acct-ci svg { width: 14px; height: 14px; }
.acct-check[data-state='checking'], .acct-check[data-state='saving'] { opacity: 0.75; }
.acct-check[data-state='available'] { color: #a8ecbc; }
.acct-check[data-state='available'] .acct-ci { background: #3f9a5f; color: #fff; }
.acct-check[data-state='taken'], .acct-check[data-state='reserved'] { color: #ffab9a; }
.acct-check[data-state='taken'] .acct-ci, .acct-check[data-state='reserved'] .acct-ci { background: #d23a3f; color: #fff; }
.acct-check[data-state='invalid'], .acct-check[data-state='error'], .acct-check[data-state='failed'] { color: #ffc98a; }
.acct-field[data-state='taken'] .acct-input, .acct-field[data-state='reserved'] .acct-input { border-color: rgba(255, 140, 120, 0.6); }
.acct-field[data-state='available'] .acct-input { border-color: rgba(140, 220, 160, 0.55); }
.acct-primary, .acct-secondary, .acct-danger {
  all: unset; box-sizing: border-box; cursor: pointer; display: block; width: 100%; text-align: center; padding: 13px; border-radius: 12px; font-size: 13.5px; font-weight: 600;
}
.acct-primary, .acct-danger {
  background: linear-gradient(180deg, #c8323b, #8e1622); color: #fff3de;
  box-shadow: inset 0 1px 0 rgba(255, 200, 180, 0.35), inset 0 -1px 0 rgba(0, 0, 0, 0.2), 0 3px 10px rgba(120, 20, 30, 0.3);
}
.acct-primary:hover:not(:disabled), .acct-danger:hover:not(:disabled) { background: linear-gradient(180deg, #d63c45, #9a1a27); }
.acct-primary:disabled, .acct-danger:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
.acct-secondary { background: rgba(0, 0, 0, 0.28); color: #f6e7c8; box-shadow: inset 0 0 0 1px rgba(236, 196, 116, 0.22); }
.acct-btnrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px; }

/* ---------- phones: the chip shows the initial, the menu spans the width, sheets are bottom sheets ---------- */
@media (max-width: 600px) {
  .acct-chip { width: 38px; padding: 0 !important; justify-content: center; }
  .acct-chip.me { width: 32px; }
  .acct-chip .acct-chip-l { display: none; }
  .acct-drop { right: 12px; left: 12px; width: auto; }
  .acct-sheet, .acct-sheet.acct-card {
    top: auto; bottom: 0; left: 0; right: 0; width: auto; max-height: min(86vh, calc(100dvh - 64px));
    padding-top: 30px; padding-bottom: env(safe-area-inset-bottom); border-radius: 22px 22px 0 0; border-bottom: 0;
    box-shadow: inset 0 1px 0 rgba(255, 210, 160, 0.14), 0 -18px 50px rgba(0, 0, 0, 0.5);
    animation: acct-sheet-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .acct-sheet::before { top: 16px; height: 9px; }
  /* The bow sits toward the corner so the grab handle keeps the centre. */
  .acct-sheet .bow { left: auto; right: 22px; transform: none; top: -6px; width: 54px; height: 34px; }
  .acct-grab { display: block; position: absolute; left: 50%; top: 5px; width: 38px; height: 4px; margin-left: -19px; border-radius: 2px; background: rgba(246, 231, 200, 0.3); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.3); }
  .acct-pin { border-radius: 0; }
  .acct-x { top: 34px; }
  .acct-sub { letter-spacing: 0.16em; }
}
@media (prefers-reduced-motion: reduce) {
  .acct-sheet, .acct-drop, .acct-scrim { animation: none !important; }
}
```

In `src/main.ts`, add `import './ui/account.css';` after `import './ui/radio.css';`.

- [ ] **Step 9: Wire the account UI into `src/app.ts`**

1. Add `import { Accounts } from './ui/accounts';` and the field `private readonly accounts: Accounts;`.
2. In the constructor, change the `Menu` hook to `onOpen: () => { this.radioPanel.close(); this.accounts.closeMenu(); },` and the radio panel's hooks to `{ onOpen: () => { this.menu.close(); this.accounts.closeMenu(); }, onPillChange: () => this.fitHud() }`, and after the `RadioPanel` is created (before the `setUnauthorizedHandler` lines) add:

```ts
    this.accounts = new Accounts(this.session, {
      pause: () => this.pause(false),
      closeOthers: () => {
        this.menu.close();
        this.radioPanel.close();
      },
      fitHud: () => this.fitHud(),
      toast: (text, ms) => this.toast.show(text, ms),
    });
```

3. In `presentWin`, after `this.radioPanel.close();` add `this.accounts.closeMenu();`.
4. In `loop()`, just before the clock-resume `if`, add:

```ts
    // A sheet over the game (opened during the reveal, say) never lets the clock run underneath it.
    if (this.accounts.sheetOpen && !this.paused && this.canPause(now)) this.pause(false);
```

5. In `bindControls()`, unlock audio from the chip too: `for (const id of ['radio-pill', 'pause-btn', 'menu-btn', 'account-chip']) el(id).addEventListener('click', () => this.sfx.unlock());`.
6. In `tap()`, after the settings-menu check, add:

```ts
    if (this.accounts.menuOpen) {
      this.accounts.closeMenu();
      return;
    }
    if (this.accounts.sheetOpen) return;
```

7. In the `keydown` handler's guard, add `|| this.accounts.blocksKeys` after `this.radioPanel.hasFocus`.
8. In `setPaused(on)`, close the account menu with the others (`this.accounts.closeMenu();` inside `if (on)`), and make the inert list `['.hud', '#menu', '#radio-panel', '#account-menu']`. (Open sheets are not on it: they pause the game themselves and sit above the pause overlay.)
9. Replace `fitHud()` so the chip falls back to its initial when even the radio pill's icon can't keep the wordmark clear:

```ts
  private fitHud(): void {
    if (!this.laidOut) return;
    const pill = document.getElementById('radio-pill');
    const chip = document.getElementById('account-chip');
    const hud = document.querySelector('.hud');
    const mark = document.querySelector('.wordmark');
    if (pill && hud && mark) {
      const markRight = mark.getBoundingClientRect().right;
      const clear = (): boolean => hud.getBoundingClientRect().left - markRight >= 16;
      fit: for (const chipFit of ['full', 'icon']) {
        if (chip) chip.dataset.fit = chipFit;
        for (const fit of ['full', 'title', 'name', 'short', 'icon']) {
          pill.dataset.fit = fit;
          if (clear()) break fit;
        }
      }
    }
    this.placeIntro();
  }
```

- [ ] **Step 10: Add the account e2e helpers and the first account e2e tests**

Append to `tests/e2e/helpers.ts`:

```ts
/** A unique Google account for this test: fake sign-in takes the aglow_fake_as cookie as the account. */
export async function asPlayer(page: Page): Promise<{ email: string; name: string }> {
  const tag = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e4)}`;
  const email = `p${tag}@example.com`;
  await page.context().addCookies([{ name: 'aglow_fake_as', value: email, url: 'http://localhost:4173' }]);
  return { email, name: `p${tag}` };
}

/** Signs in from the HUD chip; (fake) Google sends the browser back to the same page. */
export async function signInFromChip(page: Page): Promise<void> {
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
}

/** The name card a new account gets once: types a free name and saves it. */
export async function pickName(page: Page, name: string): Promise<void> {
  const card = page.getByRole('dialog', { name: 'Pick a display name' });
  await card.getByLabel('Display name').fill(name);
  await expect(card.locator('.acct-check')).toHaveText(`“${name}” is available`);
  await card.getByRole('button', { name: 'Save name' }).click();
  await expect(card).toBeHidden();
}

/** A sheet over a game in progress pauses it; this resumes, as a player tapping the overlay would. */
export async function resumeIfPaused(page: Page): Promise<void> {
  const overlay = page.locator('#pause');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}
```

`tests/e2e/accounts.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { asPlayer, pickName, ready, resumeIfPaused, signInFromChip } from './helpers';

test.describe.configure({ timeout: 120_000 });

test('the HUD chip signs in with (fake) Google, asks for a name once, then shows it', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  const chip = page.locator('#account-chip');
  await expect(chip).toHaveAccessibleName('Sign in');
  await chip.click();
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toContainText('Your name on the leaderboard is the one you pick. We never show your email.');
  await expect(card.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await card.getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await pickName(page, player.name);
  await expect(chip).toHaveAccessibleName(`Account: ${player.name}`);
});

test('the account menu opens the leaderboard and Your games; Escape closes the sheet', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board).toBeVisible();
  await board.getByRole('tab', { name: 'Your games' }).click();
  const games = page.getByRole('dialog', { name: 'Your games' });
  await expect(games).toContainText('No games yet. Light a tree to see it here.');
  await page.keyboard.press('Escape');
  await expect(games).toBeHidden();
});
```

- [ ] **Step 11: Run everything to verify it passes**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: PASS (unit, worker and every e2e test including the two new account tests). Look at the chip, the menu and a sheet in a headed run (`npx playwright test tests/e2e/accounts.spec.ts --headed`) on both a wide window and a phone-width one: the chip sits left of ···, the menu and sheets use the radio panel's glass, and on phones the sheet is a bottom sheet with a grab handle.

- [ ] **Step 12: Commit**

```bash
git add src tests
git commit -m "feat(ui): HUD account chip and menu, glass leaderboard and Your games sheets, sign-in, name and delete cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Results tag ranking (3B) and the Save-to-leaderboard round trip

Pick 3B on the results tag: a rosette badge (top right) and a line under "Merry & bright"; signed out, a red "Save to leaderboard" ribbon above the buttons that opens the sign-in card and comes back to this same results tag after Google; unranked runs say why; a finish that never reached the server offers Retry. The existing time, score and stats render exactly as before.

**Files:**
- Create: `src/ui/ribbon.ts`, `tests/unit/ui/ribbon.test.ts`
- Modify: `src/ui/account.css` (append), `src/app.ts`, `tests/e2e/accounts.spec.ts`

**Interfaces:**
- Consumes: Task 7 `RunOutcome`, `SessionState`, `markReturn`, App's `setOutcome`, `online`, `won`, `retryFinish`; Task 8 `Accounts.openBoard`, `Accounts.openSignIn`, `formatMs`, `plural`, `UNRANKED_TEXT`, `G_LOGO`, e2e helpers.
- Produces: `src/ui/ribbon.ts`: `type RibbonModel = { kind: 'rank'; rank: number; of: number; best: number | null; newBest: boolean } | { kind: 'save'; rank: number | null; of: number } | { kind: 'unranked'; why: string } | { kind: 'saving' } | { kind: 'retry' }`; `ribbonModel(o: RunOutcome, user: SessionState): RibbonModel`; `interface RibbonHandlers { board(): void; save(): void; retry(): void }`; `renderRibbon(root: HTMLElement, m: RibbonModel | null, h: RibbonHandlers): void`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ui/ribbon.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FinishResult } from '../../../src/api/types';
import { renderRibbon, ribbonModel } from '../../../src/ui/ribbon';

const result = (over: Partial<FinishResult> = {}): FinishResult => ({ id: 'g', ranked: true, reason: null, ms: 81_000, rank: 12, total: 340, best: 81_000, newBest: true, ...over });
const me = { name: 'Comet', isAdmin: false };

describe('ribbonModel', () => {
  it('ranked: the place, and a new best or your best', () => {
    expect(ribbonModel({ kind: 'done', result: result() }, me)).toEqual({ kind: 'rank', rank: 12, of: 340, best: 81_000, newBest: true });
    expect(ribbonModel({ kind: 'done', result: result({ newBest: false, best: 79_500 }) }, me)).toMatchObject({ newBest: false, best: 79_500 });
  });

  it('signed out: Save to leaderboard with the place it would take; signed in, the claim is on its way', () => {
    const anon = result({ ranked: false, reason: 'anonymous', rank: 5, best: null, newBest: false });
    expect(ribbonModel({ kind: 'done', result: anon }, null)).toEqual({ kind: 'save', rank: 5, of: 341 });
    expect(ribbonModel({ kind: 'done', result: anon }, undefined)).toEqual({ kind: 'save', rank: 5, of: 341 });
    expect(ribbonModel({ kind: 'done', result: anon }, me)).toEqual({ kind: 'saving' });
  });

  it('unranked, offline, unverified, saving and failed', () => {
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'paused', rank: null }) }, me)).toEqual({ kind: 'unranked', why: 'paused too long' });
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'too_fast', rank: null }) }, me)).toEqual({ kind: 'unranked', why: 'too fast' });
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'clock', rank: null }) }, me)).toEqual({ kind: 'unranked', why: "couldn't verify the clock" });
    expect(ribbonModel({ kind: 'offline' }, me)).toEqual({ kind: 'unranked', why: 'offline' });
    expect(ribbonModel({ kind: 'unverified' }, null)).toEqual({ kind: 'unranked', why: "couldn't verify this run" });
    expect(ribbonModel({ kind: 'saving' }, null)).toEqual({ kind: 'saving' });
    expect(ribbonModel({ kind: 'failed' }, null)).toEqual({ kind: 'retry' });
  });
});

function tag(): HTMLElement {
  document.body.innerHTML = `<section class="results" id="results"><h2 id="r-time">Lit in 1:21</h2><div class="merry" id="r-merry">Merry &amp; bright</div>
    <div class="score" id="r-score">Score 41,900</div><div class="stats"></div><div class="actions"><button id="r-new">New tree</button></div></section>`;
  const root = document.getElementById('results');
  if (!root) throw new Error('no tag');
  return root;
}
const handlers = () => ({ board: vi.fn(), save: vi.fn(), retry: vi.fn() });

describe('renderRibbon', () => {
  it('ranked: a rosette that opens the leaderboard, and a line under Merry & bright', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'rank', rank: 12, of: 340, best: 81_000, newBest: true }, h);
    expect(root.querySelector('#r-merry + .rib-line')?.textContent).toBe('#12 of 340 runs · New personal best!');
    const ros = root.querySelector<HTMLButtonElement>('.rib-ros');
    expect(ros?.getAttribute('aria-label')).toBe('Rank 12 of 340: open the leaderboard');
    expect(ros?.querySelector('.rib-ros-face')?.textContent).toBe('#12of 340');
    expect(ros?.querySelector('.rib-ros-banner')?.textContent).toBe('New best');
    ros?.click();
    expect(h.board).toHaveBeenCalledTimes(1);
    renderRibbon(root, { kind: 'rank', rank: 12, of: 340, best: 79_500, newBest: false }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('#12 of 340 runs · Your best 1:19.5');
    expect(root.querySelectorAll('.rib-ros')).toHaveLength(1);
    expect(root.querySelector('#r-time')?.textContent).toBe('Lit in 1:21');
  });

  it('signed out: the Save to leaderboard ribbon above the buttons', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'save', rank: 5, of: 341 }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('Would place #5 of 341 runs');
    const ribbon = root.querySelector<HTMLButtonElement>('.rib-ribbon');
    expect(ribbon?.nextElementSibling?.classList.contains('actions')).toBe(true);
    expect(ribbon?.textContent).toBe('Save to leaderboard');
    ribbon?.click();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.rib-ros')).toBeNull();
  });

  it('unranked: a grey rosette that does nothing, and the reason', () => {
    const root = tag();
    renderRibbon(root, { kind: 'unranked', why: 'paused too long' }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Unranked: paused too long');
    expect(root.querySelector<HTMLButtonElement>('.rib-ros.un')?.disabled).toBe(true);
  });

  it("saving, then couldn't save with a Retry; null clears it all", () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'saving' }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('Saving your time…');
    renderRibbon(root, { kind: 'retry' }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe("Couldn't save this run. Retry");
    root.querySelector<HTMLButtonElement>('.rib-retry')?.click();
    expect(h.retry).toHaveBeenCalledTimes(1);
    renderRibbon(root, null, h);
    expect(root.querySelectorAll('.rib, .rib-line')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/ui/ribbon.test.ts`
Expected: FAIL: `src/ui/ribbon` does not exist.

- [ ] **Step 3: Write `src/ui/ribbon.ts`**

```ts
import type { RunOutcome } from '../api/outcome';
import type { SessionState } from '../api/session';
import { formatMs, plural, UNRANKED_TEXT } from './format';
import { G_LOGO } from './icons';

export type RibbonModel =
  | { kind: 'rank'; rank: number; of: number; best: number | null; newBest: boolean }
  | { kind: 'save'; rank: number | null; of: number }
  | { kind: 'unranked'; why: string }
  | { kind: 'saving' }
  | { kind: 'retry' };

/** What the results tag says about the run (spec §6, pick 3B). */
export function ribbonModel(o: RunOutcome, user: SessionState): RibbonModel {
  switch (o.kind) {
    case 'offline':
      return { kind: 'unranked', why: UNRANKED_TEXT.offline };
    case 'unverified':
      return { kind: 'unranked', why: UNRANKED_TEXT.unverified };
    case 'saving':
      return { kind: 'saving' };
    case 'failed':
      return { kind: 'retry' };
    case 'done': {
      const r = o.result;
      // A run by a player still picking a name is placed but not yet counted in the total.
      if (r.ranked) return { kind: 'rank', rank: r.rank ?? r.total, of: Math.max(r.total, r.rank ?? 0), best: r.best, newBest: r.newBest };
      // Signed in, a signed-out run is being claimed (once the account has a name).
      if (r.reason === 'anonymous') return user ? { kind: 'saving' } : { kind: 'save', rank: r.rank, of: Math.max(r.total + 1, r.rank ?? 0) };
      return { kind: 'unranked', why: UNRANKED_TEXT[r.reason ?? 'anonymous'] };
    }
  }
}

export interface RibbonHandlers {
  board(): void;
  save(): void;
  retry(): void;
}

function rosette(face: string, kind: string, banner: string, label: string, onClick: (() => void) | null): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `rib rib-ros${kind ? ` ${kind}` : ''}`;
  b.setAttribute('aria-label', label);
  if (onClick) b.addEventListener('click', onClick);
  else b.disabled = true;
  b.innerHTML = `<i class="tail l"></i><i class="tail r"></i><span class="rib-ros-pleat"></span><span class="rib-ros-ring"></span><span class="rib-ros-face">${face}</span>${banner ? `<span class="rib-ros-banner">${banner}</span>` : ''}`;
  return b;
}

/** Draws `m` onto the results tag, replacing what was there; null clears it. The tag's own time, score and stats are untouched. */
export function renderRibbon(root: HTMLElement, m: RibbonModel | null, h: RibbonHandlers): void {
  root.querySelectorAll('.rib').forEach((n) => n.remove());
  if (!m) return;
  const line = document.createElement('div');
  line.className = 'rib rib-line';
  switch (m.kind) {
    case 'rank':
      line.innerHTML = `<b>#${m.rank}</b> of ${plural(m.of, 'run')} · ${m.newBest || m.best === null ? 'New personal best!' : `Your best <b>${formatMs(m.best)}</b>`}`;
      root.prepend(rosette(`<b>#${m.rank}</b><small>of ${m.of.toLocaleString('en-US')}</small>`, m.newBest ? 'best' : '', m.newBest ? 'New best' : '', `Rank ${m.rank} of ${m.of}: open the leaderboard`, h.board));
      break;
    case 'save': {
      line.innerHTML = m.rank === null ? 'Sign in to put this time on the leaderboard' : `Would place <b>#${m.rank}</b> of ${plural(m.of, 'run')}`;
      const ribbon = document.createElement('button');
      ribbon.type = 'button';
      ribbon.className = 'rib rib-ribbon';
      ribbon.innerHTML = `${G_LOGO}<span>Save to leaderboard</span>`;
      ribbon.addEventListener('click', h.save);
      root.querySelector('.actions')?.before(ribbon);
      break;
    }
    case 'unranked':
      line.textContent = `Unranked: ${m.why}`;
      root.prepend(rosette('<b>–</b><small>Unranked</small>', 'un', '', 'Unranked', null));
      break;
    case 'saving':
      line.textContent = 'Saving your time…';
      break;
    case 'retry': {
      line.textContent = "Couldn't save this run. ";
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'rib-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', h.retry);
      line.append(retry);
      break;
    }
  }
  root.querySelector('#r-merry')?.after(line);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ui/ribbon.test.ts`
Expected: PASS.

- [ ] **Step 5: Style the rosette, the line and the ribbon**

Append to `src/ui/account.css` (the mockup's result option B, renamed `mk-` → `rib-`):

```css
/* =====================================================================
   Results tag (pick 3B): rosette badge, ranking line and the save ribbon
   ===================================================================== */
.results .rib-line { margin-top: 8px; font-size: 12.5px; color: #7a4a22; }
.results .rib-line b { font-weight: 600; color: #7d1420; font-variant-numeric: tabular-nums; }
.results .rib-retry { all: unset; cursor: pointer; font-weight: 600; color: #8e1622; text-decoration: underline; text-underline-offset: 3px; }
.results .rib-ros {
  all: unset; position: absolute; z-index: 2; top: 30px; right: 20px; width: 78px; height: 78px; cursor: pointer; transform: rotate(9deg);
  filter: drop-shadow(0 4px 5px rgba(90, 30, 10, 0.35)); transition: transform 0.2s;
}
.results .rib-ros:hover:not(:disabled) { transform: rotate(4deg) scale(1.04); }
.results .rib-ros:disabled { cursor: default; }
.results .rib-ros > * { position: absolute; }
.results .rib-ros .tail { width: 20px; height: 40px; top: 50px; background: linear-gradient(180deg, #c8323b, #8e1622); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%); box-shadow: inset 0 1px 0 rgba(255, 200, 180, 0.3); }
.results .rib-ros .tail.l { left: 17px; transform: rotate(14deg); }
.results .rib-ros .tail.r { right: 17px; transform: rotate(-14deg); }
.results .rib-ros-pleat { inset: 0; border-radius: 50%; background: repeating-conic-gradient(#d63c45 0 6deg, #8e1622 6deg 12deg); box-shadow: inset 0 0 0 1px rgba(255, 200, 180, 0.25); }
.results .rib-ros-ring { inset: 7px; border-radius: 50%; background: repeating-conic-gradient(#f6dc98 0 4deg, #c9962f 4deg 8deg); box-shadow: 0 1px 2px rgba(60, 10, 10, 0.4); }
.results .rib-ros-face {
  inset: 13px; border-radius: 50%; display: grid; place-content: center; text-align: center; color: #6e0f1b;
  background: radial-gradient(circle at 36% 26%, #fffaf0, #f6e3b4 45%, #e0b866 100%);
  box-shadow: inset 0 0 0 1.5px rgba(255, 250, 230, 0.7), inset 0 -3px 5px rgba(120, 70, 20, 0.35), 0 0 0 1.5px #a8742a;
}
.results .rib-ros-face b { font: italic 400 23px/0.9 'Instrument Serif', serif; }
.results .rib-ros-face small { display: block; margin-top: 2px; font-size: 7.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.75; }
.results .rib-ros-banner {
  left: 50%; bottom: -12px; transform: translateX(-50%) rotate(-9deg); white-space: nowrap; padding: 3px 10px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: #4a2208; background: linear-gradient(180deg, #fbe4a6, #d6a24a 60%, #b9822f); box-shadow: inset 0 1px 0 rgba(255, 250, 225, 0.7), 0 2px 4px rgba(60, 20, 0, 0.35);
  clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 50%, 100% 100%, 0 100%, 6px 50%);
}
.results .rib-ros.best .rib-ros-pleat { background: repeating-conic-gradient(#f6dc98 0 6deg, #c9962f 6deg 12deg); }
.results .rib-ros.best .rib-ros-ring { background: repeating-conic-gradient(#d63c45 0 4deg, #8e1622 4deg 8deg); }
.results .rib-ros.best .rib-ros-face { color: #fff3de; background: radial-gradient(circle at 36% 26%, #ff8a80, #c8323b 45%, #7e101c 100%); box-shadow: inset 0 0 0 1.5px rgba(255, 200, 180, 0.4), inset 0 -3px 5px rgba(60, 0, 6, 0.4), 0 0 0 1.5px #f3d492; }
.results .rib-ros.best .tail { background: linear-gradient(180deg, #f6dc98, #b9822f); }
.results .rib-ros.un { filter: drop-shadow(0 3px 4px rgba(90, 60, 30, 0.25)) saturate(0.2); opacity: 0.85; }
.results .rib-ros.un .rib-ros-face b { font-style: normal; }
.results .rib-ribbon {
  all: unset; box-sizing: border-box; cursor: pointer; position: relative; display: flex; align-items: center; justify-content: center; gap: 9px;
  width: calc(100% + 72px); height: 44px; margin: -6px -36px 14px; padding: 0 44px; color: #fff3de; font-size: 13.5px; font-weight: 600; letter-spacing: 0.02em;
  background: linear-gradient(180deg, #e04a53 0%, #b01e2c 45%, #82101d 100%);
  box-shadow: inset 0 1px 0 rgba(255, 200, 180, 0.45), inset 0 -2px 0 rgba(0, 0, 0, 0.2);
  clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 50%, 100% 100%, 0 100%, 16px 50%);
  filter: drop-shadow(0 4px 6px rgba(120, 20, 30, 0.3)); text-shadow: 0 1px 1px rgba(60, 0, 6, 0.4);
}
.results .rib-ribbon::before { content: ''; position: absolute; left: 22px; right: 22px; top: 4px; bottom: 4px; border-top: 1px dashed rgba(255, 220, 170, 0.5); border-bottom: 1px dashed rgba(255, 220, 170, 0.5); pointer-events: none; }
.results .rib-ribbon .acct-g { padding: 3px; background: #fff; border-radius: 50%; width: 22px; height: 22px; box-sizing: border-box; }
.results .rib-ribbon:hover { background: linear-gradient(180deg, #ea5560 0%, #bd2433 45%, #8e1622 100%); }
.results .rib-ribbon:focus-visible, .results .rib-ros:focus-visible, .results .rib-retry:focus-visible { outline: 2px solid #8e1622; outline-offset: 3px; }
@media (max-width: 600px) {
  .results .rib-ros { width: 64px; height: 64px; top: 30px; right: 12px; }
  .results .rib-ros .tail { top: 40px; width: 17px; height: 34px; }
  .results .rib-ros .tail.l { left: 13px; }
  .results .rib-ros .tail.r { right: 13px; }
  .results .rib-ros-ring { inset: 6px; }
  .results .rib-ros-face { inset: 11px; }
  .results .rib-ros-face b { font-size: 19px; }
  .results .rib-ros-face small { font-size: 6.5px; }
  .results .rib-ribbon { width: calc(100% + 60px); margin-left: -30px; margin-right: -30px; }
}
```

- [ ] **Step 6: Render the outcome and wire Save to leaderboard in `src/app.ts`**

Add `markReturn` to the `./store/progress` import and `import { renderRibbon, ribbonModel } from './ui/ribbon';`, then replace `setOutcome` and add `saveRun`:

```ts
  /** The run's outcome on the results tag (pick 3B): drawn now, so it is there when the tag appears. */
  private setOutcome(o: RunOutcome | null): void {
    this.outcome = o;
    renderRibbon(el('results'), o && ribbonModel(o, this.session.current), {
      board: () => this.accounts.openBoard(),
      save: () => this.saveRun(),
      retry: () => this.retryFinish(),
    });
  }

  /** "Save to leaderboard": the sign-in card; after Google, the page comes back to this results tag (boot() restores the won run). */
  private saveRun(): void {
    const run = this.online;
    if (!run) return;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.accounts.openSignIn({ pendingMs: this.won?.result?.ms ?? null, beforeLeave: () => markReturn(run.gameId) }, from);
  }
```

- [ ] **Step 7: Add the end-to-end test of the whole round trip**

Add to `tests/e2e/accounts.spec.ts` (import `onlineTree` and `solveByTapping` from `./helpers` too):

```ts
test('play signed out, Save to leaderboard: sign in, pick a name, and the run is on the board', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #\d+ of [\d,]+ runs?$/);
  await results.getByRole('button', { name: 'Save to leaderboard' }).click();
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toContainText(/Your \d+:\d\d\.\d is waiting on this device\./);
  await card.getByRole('link', { name: 'Continue with Google' }).click();
  // Back from (fake) Google on the same results tag, asked for a name; naming claims the run.
  await page.waitForURL(/\/\?test$/);
  await pickName(page, player.name);
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · New personal best!$/, { timeout: 15_000 });
  await results.getByRole('button', { name: /^Rank \d+ of \d+: open the leaderboard$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Leaderboard' }).locator('.acct-row.acct-me')).toContainText(player.name);
});
```

- [ ] **Step 8: Run everything to verify it passes**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: PASS. Check the tag headed once (`npx playwright test tests/e2e/accounts.spec.ts --headed -g "Save to leaderboard"`): the red ribbon spans the tag above New tree / Share, the rosette sits top right after claiming, and Lit in, the score and the stats look as before.

- [ ] **Step 9: Commit**

```bash
git add src tests
git commit -m "feat(results): rank rosette, ranking line and the Save to leaderboard ribbon with the sign-in round trip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Privacy page and the remaining end-to-end account flows (desktop and phone)

The static `/privacy` page the Google consent screen links to (what is stored, why, how long, how to delete), and Playwright scenarios for the rest of spec §9 on the real Worker with fake sign-in: the pause cap, two runs by one player on the board, the admin on fake Google (and "Not authorized"), account delete, `?auth=failed`, and a phone project for the account flows.

**Files:**
- Create: `privacy.html`
- Modify: `vite.config.ts` (third page), `playwright.config.ts` (phone project), `tests/e2e/accounts.spec.ts`, `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–9 (game flow, account UI, ribbon), e2e helpers `asPlayer`, `ready`, `onlineTree`, `solveByTapping`, `signInFromChip`, `pickName`, `resumeIfPaused`; `serve:e2e` (`ADMIN_EMAILS:admin@example.com`).
- Produces: `/privacy` (Vite input `privacy`); Playwright projects `desktop` (every spec) and `phone` (Pixel 7, `accounts.spec.ts`).

- [ ] **Step 1: Write the failing e2e tests**

Add to `tests/e2e/accounts.spec.ts`:

```ts
test('pausing more than 20 times leaves the run unranked: paused too long', async ({ page }) => {
  await ready(page);
  await onlineTree(page);
  const overlay = page.locator('#pause');
  for (let k = 0; k < 21; k++) {
    await page.keyboard.press('p');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('p');
    await expect(overlay).toBeHidden();
  }
  await solveByTapping(page);
  await expect(page.locator('#results .rib-line')).toHaveText('Unranked: paused too long', { timeout: 15_000 });
});

test('two runs by the same player both appear on the board', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  for (let run = 0; run < 2; run++) {
    if (run) await page.locator('#r-new').click();
    await onlineTree(page);
    await solveByTapping(page);
    await expect(page.locator('#results .rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  }
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  await expect(page.getByRole('dialog', { name: 'Leaderboard' }).locator('.acct-row.acct-me')).toHaveCount(2);
});

test('delete the account from the menu', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Delete account' }).click();
  const card = page.getByRole('dialog', { name: 'Delete account' });
  await expect(card.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  await card.getByRole('textbox').fill(player.name);
  await card.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.locator('#toast')).toHaveText('Account deleted');
  await expect(page.locator('#account-chip')).toHaveAccessibleName('Sign in');
});

test('a sign-in that did not finish says so, and drops ?auth=failed from the address', async ({ page }) => {
  await page.goto('/?test&auth=failed');
  await expect(page.locator('#toast')).toHaveText("Sign-in didn't finish. Try again.");
  await expect(page).toHaveURL(/\/\?test$/);
});

test('the privacy page says what is stored, why, for how long, and how to delete it', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
  for (const text of ['Google account ID and email address', 'display name', 'log of your taps and pauses', 'hashed copy of your IP address', '90 days', 'Delete account']) {
    await expect(page.locator('main')).toContainText(text);
  }
});
```

Add to `tests/e2e/admin.spec.ts` (these use the real Worker, nothing routed; the local R2 starts empty):

```ts
test('the admin signs in with (fake) Google and gets the editor; another account is not authorized', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop only');
  const as = (email: string) => context.addCookies([{ name: 'aglow_fake_as', value: email, url: 'http://localhost:4173' }]);
  await as('admin@example.com');
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page.getByText('Create a station to start uploading music.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Radio admin' })).toBeVisible();
  await as('someone@example.com');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
});
```

- [ ] **Step 2: Run them to verify the new ones fail**

Run: `npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin.spec.ts`
Expected: FAIL: `/privacy` is the 404 page; the other new tests pass already or fail only where they reach `/privacy` (if any other new test fails, fix the code it exercises before going on).

- [ ] **Step 3: Write `privacy.html` and build it**

`privacy.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="theme-color" content="#0e0906" />
    <title>Aglow · Privacy</title>
    <meta name="description" content="What Aglow stores about you, why, for how long, and how to delete it." />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; font: 15px/1.6 Inter, system-ui, sans-serif; color: #f4e6cf; -webkit-font-smoothing: antialiased;
        background: radial-gradient(60% 60% at 0% 100%, rgba(255, 120, 40, 0.18), transparent 70%), #0e0906;
      }
      main { max-width: 680px; margin: 0 auto; padding: 56px 24px 72px; }
      .wm { display: inline-flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 500; letter-spacing: 0.5em; text-transform: uppercase; color: #f4e6cf; text-decoration: none; }
      .wm::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #ffb070; box-shadow: 0 0 10px #ffb070; }
      h1 { margin: 22px 0 6px; font: italic 400 44px/1.05 'Instrument Serif', serif; color: #fff3dc; }
      h2 { margin: 34px 0 8px; font: 400 24px/1.2 'Instrument Serif', serif; color: #fff3dc; }
      p, li { color: rgba(244, 230, 207, 0.82); }
      b { color: #fff3dc; font-weight: 600; }
      ul { padding-left: 20px; }
      li + li { margin-top: 6px; }
      a { color: #ffb070; }
      .dim { color: rgba(244, 230, 207, 0.55); font-size: 13px; }
      @media (max-width: 420px) { main { padding: 40px 16px 56px; } h1 { font-size: 38px; } }
    </style>
  </head>
  <body>
    <main>
      <a class="wm" href="/">Aglow</a>
      <h1>Privacy</h1>
      <p class="dim">Updated October 7, 2026</p>
      <p>You can play Aglow without an account. Signing in with Google is only for the leaderboard.</p>

      <h2>What is stored when you sign in</h2>
      <ul>
        <li><b>Your Google account ID and email address.</b> Google shares these when you sign in (Aglow asks for nothing else). The ID keeps your account the same each time; the email must be verified by Google, and it is how the radio admin is recognised. Neither is ever shown to anyone.</li>
        <li><b>Your display name.</b> The name you pick is shown on the leaderboard next to your times. It is the only thing about you that is public.</li>
        <li><b>Your games.</b> For each tree: when it started and finished, your time, whether it ranked, and the log of your taps and pauses, which the server replays to check the time.</li>
        <li><b>A sign-in session.</b> A cookie keeps you signed in. Aglow stores only a hashed copy of it.</li>
      </ul>

      <h2>What is stored when you play signed out</h2>
      <ul>
        <li><b>Your finished games</b>, with no name attached, so you can still save them to the leaderboard by signing in on the same browser later.</li>
        <li><b>A hashed copy of your IP address</b> with each game, used only to limit how many games one network can start in an hour. The address itself is never stored.</li>
        <li><b>In your browser:</b> the game in progress, your settings and local stats, and the tokens that let you save signed-out games after you sign in.</li>
      </ul>

      <h2>How long it is kept</h2>
      <ul>
        <li>Your account, name and games: until you delete your account.</li>
        <li>Your session: a year, renewed while you keep playing, or until you sign out.</li>
        <li>Games played signed out: 90 days unless you sign in and save them. Games never finished: one day.</li>
      </ul>

      <h2>Who sees it</h2>
      <p>Everyone can see the leaderboard: display names, times and dates. Nothing else is public. Aglow runs on Cloudflare, which stores this data. It is never sold or shared, and there are no ads, analytics or tracking cookies. The pages load their fonts from Google Fonts, which sees your IP address as any website you visit does.</p>

      <h2>Deleting it</h2>
      <p>Sign in, open the menu under your name and choose <b>Delete account</b>. Your account, name, sessions and every saved game are deleted at once, for good. To ask about your data, use the support email shown on Google's sign-in screen for Aglow.</p>

      <p class="dim"><a href="/">Back to Aglow</a></p>
    </main>
  </body>
</html>
```

In `vite.config.ts`, add the page to `build.rollupOptions.input` and update its comment:

```ts
    // Three pages: the game, the radio admin (served at /admin) and the privacy page (/privacy). The game's chunks never include admin code.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
      },
    },
```

- [ ] **Step 4: Add the phone project**

In `playwright.config.ts`, replace `projects` with:

```ts
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The account flows again at phone size: the chip shows an initial and the sheets are bottom sheets.
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /accounts\.spec\.ts/ },
  ],
```

- [ ] **Step 5: Run everything to verify it passes**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: PASS on both projects. Open `/privacy` once in a headed run and check it reads well on a phone width.

- [ ] **Step 6: Commit**

```bash
git add privacy.html vite.config.ts playwright.config.ts tests/e2e
git commit -m "feat: privacy page; e2e for the pause cap, several runs per player, admin on Google, account delete, phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Deploy guard, production config and docs

`npm run deploy` gains a placeholder guard and `wrangler d1 migrations apply aglow --remote` (spec §7.5); `wrangler.jsonc` gets the auth vars as placeholders the controller fills in during rollout; README and the specs record how accounts work and what changed during planning. No task runs the deploy or touches Luke's Cloudflare or Google accounts (see the Rollout note).

**Files:**
- Create: `scripts/deploy-check.ts`, `tests/unit/deploy-check.test.ts`
- Modify: `package.json` (`deploy`), `wrangler.jsonc` (vars), `README.md`, `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md` (revisions), `docs/superpowers/specs/2026-09-29-aglow-design.md` (§7 auth)

**Interfaces:**
- Consumes: everything above.
- Produces: `deployConfigProblems(config: string): string[]` in `scripts/deploy-check.ts` (run as `node scripts/deploy-check.ts`).

- [ ] **Step 1: Write the failing test**

`tests/unit/deploy-check.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { deployConfigProblems } from '../../scripts/deploy-check.ts';

const ready = `{
  "d1_databases": [{ "binding": "DB", "database_name": "aglow", "database_id": "3f1c2a9e-1111-4222-8333-944455556666", "migrations_dir": "migrations" }],
  "vars": { "AUTH_MODE": "google", "GOOGLE_CLIENT_ID": "1234-abc.apps.googleusercontent.com", "ADMIN_EMAILS": "luke@example.com" }
}`;

it('passes a filled-in config', () => {
  expect(deployConfigProblems(ready)).toEqual([]);
});

it('names every placeholder left from setup', () => {
  const problems = deployConfigProblems(
    ready
      .replace('3f1c2a9e-1111-4222-8333-944455556666', '00000000-0000-0000-0000-000000000000')
      .replace('1234-abc.apps.googleusercontent.com', 'REPLACE_WITH_GOOGLE_CLIENT_ID')
      .replace('luke@example.com', 'REPLACE_WITH_ADMIN_EMAILS'),
  );
  expect(problems).toHaveLength(3);
  expect(problems.join('\n')).toMatch(/database_id/);
  expect(problems.join('\n')).toMatch(/GOOGLE_CLIENT_ID/);
  expect(problems.join('\n')).toMatch(/ADMIN_EMAILS/);
});

it('refuses fake sign-in in the deployed config', () => {
  expect(deployConfigProblems(ready.replace('"AUTH_MODE": "google"', '"AUTH_MODE": "fake"'))).toEqual(['vars.AUTH_MODE must be "google" in wrangler.jsonc (fake sign-in is for localhost only).']);
});

it('the committed wrangler.jsonc never deploys fake sign-in (placeholders may remain until rollout)', () => {
  const problems = deployConfigProblems(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  expect(problems.filter((p) => p.includes('AUTH_MODE'))).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/deploy-check.test.ts`
Expected: FAIL: `scripts/deploy-check.ts` does not exist.

- [ ] **Step 3: Write `scripts/deploy-check.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What must change in wrangler.jsonc before a deploy: placeholders left from setup, or fake sign-in. */
export function deployConfigProblems(config: string): string[] {
  const problems: string[] = [];
  if (config.includes('00000000-0000-0000-0000-000000000000')) {
    problems.push('d1_databases[0].database_id is still the zero placeholder: create the database (npx wrangler d1 create aglow) and paste its id.');
  }
  for (const name of ['GOOGLE_CLIENT_ID', 'ADMIN_EMAILS']) {
    if (new RegExp(`"${name}"\\s*:\\s*"REPLACE_WITH`).test(config)) problems.push(`vars.${name} is still a placeholder in wrangler.jsonc.`);
  }
  if (/"AUTH_MODE"\s*:\s*"fake"/.test(config)) problems.push('vars.AUTH_MODE must be "google" in wrangler.jsonc (fake sign-in is for localhost only).');
  return problems;
}

// Run directly (npm run deploy): refuse to go on while anything is left.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = deployConfigProblems(readFileSync('wrangler.jsonc', 'utf8'));
  for (const p of problems) console.error(`deploy-check: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
```

- [ ] **Step 4: Add the vars and the guarded deploy**

In `wrangler.jsonc`, replace the `"vars"` line with:

```jsonc
  "vars": {
    "MUSIC_BASE_URL": "https://aglow-music.lukeghanna.com",
    // Sign-in (spec 2026-10-07): "google" here; "fake" only on localhost (npm run serve:e2e and .dev.vars pass it).
    "AUTH_MODE": "google",
    // The Google Web client's id (public). Filled in during rollout.
    "GOOGLE_CLIENT_ID": "REPLACE_WITH_GOOGLE_CLIENT_ID",
    // The radio admin's Google email(s), comma-separated, lower-case. Filled in during rollout.
    "ADMIN_EMAILS": "REPLACE_WITH_ADMIN_EMAILS"
  },
```

In `package.json`, change `deploy` to:

```json
    "deploy": "node scripts/deploy-check.ts && npm run typecheck && npm test && npm run build && wrangler d1 migrations apply aglow --remote && wrangler deploy",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/deploy-check.test.ts && npm run typecheck && node scripts/deploy-check.ts; echo "exit $?"`
Expected: the tests PASS; the script prints the three placeholder problems and `exit 1` (as it must until rollout).

- [ ] **Step 6: Document accounts in the README**

Add after the `## Radio admin` section of `README.md`:

```md
## Accounts and the leaderboard

Players can sign in with Google, pick a display name and post server-verified times to one all-time leaderboard (spec `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md`). Playing never needs an account.

- **Stack:** the same Worker on `/api/*`, plus the D1 database `aglow` (`migrations/`). Sign-in is server-side OpenID Connect with PKCE; the browser never loads Google's scripts.
- **Verified times:** the server picks each tree's seed and stamps its start and finish, replays the tap log through the game's own code (`src/core/replay.ts`, `src/core/judge.ts`), and anchors it to its own clock.
- **Config:** secrets `AUTH_SECRET` (256 random bits; piped into `wrangler secret put`, never shown) and `GOOGLE_CLIENT_SECRET` (from the Google console); vars in `wrangler.jsonc`: `GOOGLE_CLIENT_ID`, `AUTH_MODE` (`google`) and `ADMIN_EMAILS`.
- **Deploy:** `npm run deploy` refuses placeholder config (`scripts/deploy-check.ts`), then typechecks, tests, builds, applies D1 migrations remotely and deploys.
- **Locally:** `npm run dev:full` runs the build on the real Worker with fake sign-in (see Radio admin); `npm run dev` (Vite only) still works and plays offline. `npm run e2e` builds and runs Playwright against `wrangler dev` with a fresh local D1 (`npm run serve:e2e`).
- **Moderation:** find runs with `npx wrangler d1 execute aglow --remote --command "SELECT g.id, u.name, g.ms FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 ORDER BY g.ms LIMIT 50"` and delete one with `… --command "DELETE FROM games WHERE id = '<id>'"`.
- **After a deploy:** `curl https://aglow.lukeghanna.com/api/me` answers `{"user":null}`; a signed-out win finishes as `anonymous`; signing in claims it and it shows on the board; `/admin` opens for the admin; `/api/admin/stations` answers 401 when signed out.
```

- [ ] **Step 7: Record the planning decisions in the specs**

In `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md`, change `**Status:** Draft for Luke's review` to `**Status:** Approved; planned in docs/superpowers/plans/2026-10-07-aglow-accounts.md (see Revisions during planning)` and append:

```md
## Revisions during planning

- **Replay CPU.** Replaying a 5,000-entry log through the ordinary `Board` costs about 50 ms (a lighting BFS per turn), five times the Free plan's budget. `Board` gains a headless mode for the Worker: turns, queues and the win are unchanged, but the tree is only lit when it could be whole (nothing turning, the root wired, enough matched links). The longest legal log replays in about 1.5 ms; a unit test guards it.
- **Same order as the replay.** A tap first ticks the board at the tap's time, then taps, in the browser and in the replay. Log times are `Date.now() − startEpoch`, read through a `performance.now()` anchor so they never go backwards.
- **Pauses.** `pagehide` logs `p`; after a reload, `r` is logged when the clock resumes (after the reveal), so the reveal isn't counted. A sheet over the game pauses it. Pause time is counted up to the solve; a pause still open at the solve counts until the solve.
- **Finish result.** `{id, ranked, reason, ms, rank, total, best, newBest}`: `rank` for an `anonymous` run is the place it would take once claimed; `best` is the owner's best ranked time; `newBest` means this run is now the owner's best.
- **Claims** take finished games only. The browser stores a claim token only once its run finished as `anonymous`, and drops tokens the server has seen.
- **The run stays in `aglow.game`** (v2 `won`) until a new tree starts: a finish that never got an answer is sent again after a reload, and "Save to leaderboard" comes back to the same results tag after Google (a sessionStorage marker). A finish sent much later is judged `clock`, by design.
- **422** reads "Unranked: couldn't verify this run" on the results tag.
- **Deleting an account without a name** confirms with the Google email (the browser never receives it, so the card asks for it).
- **Admin sign-in with unsaved edits** opens Google in a new tab and offers Continue, so the edits survive (as the password screen did).
- **Errors:** new routes answer `{error, message}`; the older station and upload routes keep their message in `error`, and the admin page reads `message` first.
- **Inert list:** the account menu joins it; open sheets sit above the pause overlay instead.
- **Housekeeping** deletes up to 25 abandoned and 25 unclaimed games per start (both found through indexes).
- **Reserved names:** admin, administrator, aglow, santa, santaclaus, moderator, staff, support, official, system (compared without case, spaces, `-` or `_`). Names can't be changed after they are picked, so the mockup's "Change name" is not built.
- **Leaderboard rows** show rank, name, time and date (the mockup had no date column). Tied runs (same time and finish) share a rank.
- **Placeholders:** `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` and the D1 `database_id` are placeholders in `wrangler.jsonc` until rollout; the deploy refuses them. `ADMIN_EMAILS` may instead be set with `wrangler secret put` if Luke prefers his email out of the public repo (the Worker reads either).
- **E2E** runs on `wrangler dev`: every spec on desktop, the account flows also at phone size. The pause cap is tested with 21 pauses.
```

In `docs/superpowers/specs/2026-09-29-aglow-design.md` §7, change the opening line's "no Vercel and no database" to "no Vercel; the accounts spec adds the D1 database `aglow`", and replace the whole **Auth** bullet (with its four sub-bullets) with:

```md
- **Auth** (replaced by the accounts spec, `2026-10-07-aglow-accounts-design.md` §4): the admin signs in with Google. `/api/admin/*` needs a session whose verified email is in `ADMIN_EMAILS`: 401 signed out, 403 for any other account. Every non-GET `/api/*` request must carry a same-origin `Origin` and JSON (raw-audio uploads excepted). The password login, `SESSION_SECRET` and the login rate limits are gone.
```

- [ ] **Step 8: Run the whole suite**

Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts tests/unit/deploy-check.test.ts package.json wrangler.jsonc README.md docs/superpowers/specs
git commit -m "chore(deploy): placeholder guard and remote D1 migrations before deploy; accounts docs and planning revisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rollout (controller and Luke only: not a subagent task)

After the final whole-branch review and the merge to `main` (never pushed by a subagent):

1. **D1 (controller).** `npx wrangler d1 create aglow`, then paste the printed `database_id` into `wrangler.jsonc` and commit.
2. **Google Cloud (controller in Chrome, Luke for the irreversible parts).** Create the project "Aglow"; configure the OAuth consent screen: app name "Aglow", Luke's support email, home page `https://aglow.lukeghanna.com`, privacy policy `https://aglow.lukeghanna.com/privacy`, scopes `openid` and `email`. Create a Web client with redirect URIs `https://aglow.lukeghanna.com/api/auth/google/callback` and `http://localhost:4173/api/auth/google/callback`. **Luke** accepts any terms and publishes the app (In production, not Testing).
3. **Config (controller).** Put the Web client's id into `vars.GOOGLE_CLIENT_ID`, and `ADMIN_EMAILS` once Luke confirms which address (or Luke sets it with `npx wrangler secret put ADMIN_EMAILS` and the var line is removed). Commit; `node scripts/deploy-check.ts` must pass.
4. **Secrets.** **Luke** runs `npx wrangler secret put GOOGLE_CLIENT_SECRET` and pastes the secret himself. The controller pipes a fresh `AUTH_SECRET` without displaying it: `openssl rand -hex 32 | npx wrangler secret put AUTH_SECRET`. Nobody prints, logs or commits either value.
5. **Deploy.** **Luke** runs `npm run deploy` (it applies the D1 migrations remotely first). Then the controller checks `npx wrangler secret list` shows `AUTH_SECRET` and `GOOGLE_CLIENT_SECRET`.
6. **Smoke test (controller).** `GET /api/me` → `{"user":null}`; a signed-out win finishes `anonymous`; Luke signs in, claims work and the run is on the board; `/admin` loads for Luke; `GET /api/admin/stations` signed out → 401.
7. **Clean-up.** **Luke** deletes the old secrets with `npx wrangler secret delete ADMIN_PASSWORD` and `npx wrangler secret delete SESSION_SECRET` (irreversible, so not Claude).
