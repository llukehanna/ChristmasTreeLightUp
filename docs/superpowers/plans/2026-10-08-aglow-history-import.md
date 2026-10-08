# Aglow history import and account stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin imports a device's pre-accounts stats as plausible, deterministic runs on his own account (so they fill the leaderboard), and signed-in players see their account's stats (solved, average, streaks) on the results tag and in Your games, the same on every device.

**Architecture:**

- **A pure, seeded fabricator** (`worker/lib/history.ts`, with day helpers in `worker/lib/days.ts`) turns the admin's numbers into runs: exactly the best, exactly the total, the streaks placed in the dates, an improvement trend and plausible times of day, all from `mulberry32` seeded by the import's id.
- **The Worker** gains `games.source` (migration 0002), `POST /api/admin/import` (admin only; one `INSERT OR IGNORE … SELECT FROM json_each(?)` statement) and `GET /api/me/stats` (one D1 batch); `GET /api/me/games` marks imported runs.
- **The browser:** the admin page gets an "Import this device's history" card; the game's results tag and Your games show the account's stats when signed in, the device's otherwise.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node; jsdom where a file says so), Playwright 1.63 on `wrangler dev`, Wrangler 4.147 (Workers, D1, `getPlatformProxy` for a real local D1 in Node tests).

**Spec:** `docs/superpowers/specs/2026-10-08-aglow-history-import-design.md` (binding; read it alongside this plan). It builds on `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md`. Approved design: `.superpowers/history-import-design.md` (git-ignored, local).

## Global Constraints

- **Shared constants** (`src/api/types.ts`): `HISTORY_FIRST_DAY = '2026-09-29'`, `MAX_IMPORT_RUNS = 2000`, `MIN_IMPORT_BEST_SECONDS = 5`, `MAX_IMPORT_MS = 3_600_000`, `MAX_STREAK_DAYS = 3650`. Fabrication: `TREND = 0.6`, `SIGMA = 0.5`, `BEST_FROM = 0.6`.
- **Determinism:** the fabricator uses only `mulberry32(seedOf(importId))` (`src/core/rng.ts`; FNV-1a 32-bit, offset `0x811c9dc5`, prime `0x01000193`) and its inputs. No `Math.random`, no `Date.now()` inside it; `now` is an input. Draw order: free days, day weights, best index, two per non-best run, then per played day: window, start, gaps.
- **Invariants:** min run = `bestSeconds × 1000` exactly; Σ ms = `solved × averageMs` exactly; every local day in `[2026-09-29, lastSolvedDay]`; the last day played; every finish ≤ `now − 1000`; finishes strictly increase; `streaksOf(days, lastDay)` equals the reported `{streak, longestStreak}`, which equal the request's whenever `clamped` is false.
- **Imported rows:** `id = 'imp_' + importId + '_' + 4-digit index`, `user_id` = the signed-in admin, `claim_hash` NULL, `gen_version` 0, `seed` 0, `started_at = finished_at − ms`, `paused_ms` 0, `pauses` 0, `ranked` 1, `unranked_reason` NULL, `log` NULL, `source` `'import'`. `games.source` is `'play'` or `'import'` (CHECK), default `'play'`.
- **Import request:** `{importId, solved, bestSeconds, averageMs, streak, longestStreak, lastSolvedDay, tz}`; validation order and messages exactly as spec §3.1; 400 `invalid`. Response `{added, already, streak, longestStreak, clamped}`. If run 0's id exists, insert nothing (`already: true`). One INSERT statement. `resetBoardCache()` after inserting.
- **Stats request:** `GET /api/me/stats?today=YYYY-MM-DD&tz=<minutes>`; 401 signed out; 400 `invalid` with `today must be YYYY-MM-DD and tz whole minutes from -840 to 840.`; response `{solved, totalMs, averageMs, bestMs, streak, longestStreak, lastSolvedDay, imported}`. `tz` is `Date#getTimezoneOffset()` (UTC minus local: 420 in PDT); a local day is `floor((at − tz × 60000) / 86400000)`. The streak is alive only if the last played day is today or yesterday.
- **The Worker never imports UI or render code:** only `src/core/*`, `src/api/types.ts`, `src/api/names.ts`, `src/radio/schema.ts`, `src/radio/ids.ts`. `worker/lib` and `worker/routes` stay free of `@cloudflare/workers-types`. Worker files import with `.js` suffixes; game `src` files import extensionless; `src/admin` files import with `.js` suffixes (their existing style).
- **D1 / Free plan:** ≤ 100 bound parameters per statement, ≤ 50 queries per request, 2 MB per bound value; 10 ms CPU per request. Workers Free and D1 Free only.
- **TypeScript strict, no `any`** (`unknown` and narrow). Errors are `{error, message}` JSON with `Cache-Control: no-store`.
- **UI copy** exactly as written in this plan (spec §7).
- **Never** run `wrangler secret`, `wrangler deploy`, `--remote`, `wrangler login` or anything touching Luke's Cloudflare or Google accounts. **Never** read or commit `Music MP3s/`. Never push.
- **Commits** end with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Verification commands:** `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (Playwright builds and runs the real Worker with `wrangler dev`, fake Google, a fresh local D1; about 10 minutes).

## File map

| File | Responsibility |
| --- | --- |
| `src/api/types.ts` | Shared constants; `ImportRequest`, `ImportResponse`, `AccountStats`; `RecentGame.imported` |
| `worker/lib/days.ts` | Day numbers, local days for an offset, `streaksOf` (pure) |
| `worker/lib/history.ts` | `split`, `seedOf`, `importRunId`, `fabricateHistory`, `parseImportRequest` (pure) |
| `migrations/0002_history_import.sql` | `games.source` |
| `worker/routes/admin/history.ts` | `POST /api/admin/import` |
| `worker/routes/me.ts` | `GET /api/me/stats`; `imported` in `GET /api/me/games` |
| `worker/router.ts` | The two new routes |
| `src/api/client.ts` | `api.myStats()` |
| `src/ui/results.ts` | `StatsView`, `deviceStatsView`, `accountStatsView`, `Results.setStats` |
| `src/app.ts` | `syncStats()`: the account's numbers on the results tag |
| `src/ui/board-sheets.ts`, `src/ui/accounts.ts`, `src/ui/account.css` | Your games totals row and the Imported pill |
| `src/admin/dom.ts` | The admin page's `h()` (moved out of `main.ts`) |
| `src/admin/history.ts` | Admin card helpers: clock parsing, defaults, request, import mark (pure) |
| `src/admin/history-card.ts` | The "Import this device's history" card |
| `src/admin/api.ts`, `src/admin/main.ts`, `src/admin/admin.css` | Card calls, wiring, styles |

---

## Task order

1. Day helpers and the seeded history fabricator (pure)
2. Migration 0002 and `POST /api/admin/import`
3. `GET /api/me/stats`, imported runs in Your games data, and the client call
4. Account stats on the results tag and in Your games (e2e: accounts)
5. The admin's "Import this device's history" card (e2e: admin), README and spec notes

---

### Task 1: Day helpers and the seeded history fabricator

Pure code: the Worker's import route and stats route use it, and the tests prove the spec's invariants on a deterministic sweep of 600 inputs.

**Files:**
- Modify: `src/api/types.ts` (constants and `ImportRequest`)
- Create: `worker/lib/days.ts`, `worker/lib/history.ts`
- Test: `tests/unit/worker/days.test.ts`, `tests/unit/worker/history.test.ts`

**Interfaces:**
- Consumes: `mulberry32(seed: number): Rng` and `type Rng = () => number` from `src/core/rng.ts`; `GAME_ID` from `worker/routes/games.ts` (test only).
- Produces:
  - `src/api/types.ts`: `HISTORY_FIRST_DAY`, `MAX_IMPORT_RUNS`, `MIN_IMPORT_BEST_SECONDS`, `MAX_IMPORT_MS`, `MAX_STREAK_DAYS`; `interface ImportRequest { importId: string; solved: number; bestSeconds: number; averageMs: number; streak: number; longestStreak: number; lastSolvedDay: string; tz: number }`.
  - `worker/lib/days.ts`: `DAY_MS`; `dayNumber(text: unknown): number | null`; `dayText(n: number): string`; `isTzOffset(v: unknown): v is number`; `localDayOf(at: number, tz: number): number`; `localMidnight(day: number, tz: number): number`; `interface Streaks { streak: number; longestStreak: number }`; `streaksOf(days: readonly number[], today: number): Streaks`.
  - `worker/lib/history.ts`: `TREND`, `SIGMA`, `BEST_FROM`; `interface HistoryInput { importId: string; solved: number; bestMs: number; averageMs: number; streak: number; longestStreak: number; lastDay: number; tz: number; now: number }`; `interface ImportedRun { id: string; finishedAt: number; ms: number }`; `interface History { runs: ImportedRun[]; streak: number; longestStreak: number; clamped: boolean }`; `seedOf(text: string): number`; `split(total: number, weights: readonly number[]): number[]`; `importRunId(importId: string, i: number): string`; `fabricateHistory(input: HistoryInput): History`; `parseImportRequest(body: Record<string, unknown>, now: number): Omit<HistoryInput, 'now'> | string`.

- [ ] **Step 1: Add the shared constants and the request type**

In `src/api/types.ts`, change the header comment line

```ts
/** JSON shapes shared by the Worker and the browser (spec 2026-10-07 §3). Types only, plus one constant. */
```

to

```ts
/** JSON shapes shared by the Worker and the browser (specs 2026-10-07 §3, 2026-10-08 §3), plus a few shared constants. */
```

and append at the end of the file:

```ts
/** History import (spec 2026-10-08): the game's first day. No imported run is dated before it. */
export const HISTORY_FIRST_DAY = '2026-09-29';
/** Most runs one import may add. */
export const MAX_IMPORT_RUNS = 2000;
/** An imported best is whole seconds and at least this (the judge's ranked floor is 5 s). */
export const MIN_IMPORT_BEST_SECONDS = 5;
/** An imported best or average is at most an hour. */
export const MAX_IMPORT_MS = 3_600_000;
/** An imported streak is at most ten years of days. */
export const MAX_STREAK_DAYS = 3650;

/** POST /api/admin/import: this device's stats, as the admin confirmed or edited them. */
export interface ImportRequest {
  /** Made by the browser before the first send and reused on every resend (16–32 of A–Z a–z 0–9 _ -). */
  importId: string;
  solved: number;
  /** Whole seconds, as the device keeps its best. */
  bestSeconds: number;
  /** Exact ms: the total is solved × averageMs. */
  averageMs: number;
  streak: number;
  longestStreak: number;
  /** The device's local YYYY-MM-DD. */
  lastSolvedDay: string;
  /** Date#getTimezoneOffset() at import time: UTC minus local, in minutes (420 in PDT). */
  tz: number;
}
```

- [ ] **Step 2: Write the failing day-helper tests**

`tests/unit/worker/days.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayNumber, dayText, isTzOffset, localDayOf, localMidnight, streaksOf } from '../../../worker/lib/days';

describe('days', () => {
  it('reads real YYYY-MM-DD dates only, and writes them back', () => {
    const n = dayNumber('2026-09-29');
    expect(n).toBe(Date.UTC(2026, 8, 29) / 86_400_000);
    expect(dayText(n as number)).toBe('2026-09-29');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-29', '26-09-29', '0099-01-01', '', null, 20260929]) expect(dayNumber(bad)).toBeNull();
  });

  it('a local day follows the offset Date#getTimezoneOffset gives (UTC minus local)', () => {
    const at = Date.UTC(2026, 9, 8, 5, 30); // 05:30 UTC: 22:30 on Oct 7 in California (420), 15:30 on Oct 8 in Sydney (-600)
    expect(dayText(localDayOf(at, 420))).toBe('2026-10-07');
    expect(dayText(localDayOf(at, 0))).toBe('2026-10-08');
    expect(dayText(localDayOf(at, -600))).toBe('2026-10-08');
    const oct7 = dayNumber('2026-10-07') as number;
    expect(localMidnight(oct7, 420)).toBe(Date.UTC(2026, 9, 7, 7, 0));
    expect(localDayOf(localMidnight(oct7, 420), 420)).toBe(oct7);
    expect(localDayOf(localMidnight(oct7, 420) - 1, 420)).toBe(oct7 - 1);
  });

  it('offsets are whole minutes within 14 hours', () => {
    expect([0, 420, -840, 840].every((v) => isTzOffset(v))).toBe(true);
    expect([841, -841, 1.5, '420', null].some((v) => isTzOffset(v))).toBe(false);
  });

  it('streaks: the run ending today or yesterday (else 0), and the longest run', () => {
    const d = dayNumber('2026-10-08') as number;
    expect(streaksOf([], d)).toEqual({ streak: 0, longestStreak: 0 });
    expect(streaksOf([d - 6, d - 5, d - 4, d - 2, d - 1, d], d)).toEqual({ streak: 3, longestStreak: 3 });
    expect(streaksOf([d - 6, d - 5, d - 4, d - 3, d - 1], d)).toEqual({ streak: 1, longestStreak: 4 });
    expect(streaksOf([d - 3, d - 2], d)).toEqual({ streak: 0, longestStreak: 2 }); // last played two days ago: broken
    expect(streaksOf([d - 1], d)).toEqual({ streak: 1, longestStreak: 1 }); // yesterday still counts
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/worker/days.test.ts`
Expected: FAIL: cannot find `worker/lib/days`.

- [ ] **Step 4: Write `worker/lib/days.ts`**

```ts
/**
 * Calendar days as whole numbers (days since 1970-01-01) for streaks and the history import (spec 2026-10-08 §5).
 * A player's local day uses the offset their browser gives (Date#getTimezoneOffset: UTC minus local, in minutes).
 */
export const DAY_MS = 86_400_000;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-08" → its day number; null unless it is a real date written exactly that way. */
export function dayNumber(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const m = DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t / DAY_MS : null;
}

/** A day number as YYYY-MM-DD. */
export const dayText = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Every real zone is within 14 hours of UTC. */
export const isTzOffset = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) <= 840;

/** The local day, in the zone `tz`, of an epoch-ms instant. */
export const localDayOf = (at: number, tz: number): number => Math.floor((at - tz * 60_000) / DAY_MS);

/** Epoch ms of the local midnight that starts `day` in the zone `tz`. */
export const localMidnight = (day: number, tz: number): number => day * DAY_MS + tz * 60_000;

export interface Streaks {
  streak: number;
  longestStreak: number;
}

/**
 * From distinct days in ascending order: the run of consecutive days ending at the last one, if that is today or
 * yesterday (else 0), and the longest run.
 */
export function streaksOf(days: readonly number[], today: number): Streaks {
  let longest = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  const last = days.at(-1);
  return { streak: last !== undefined && last >= today - 1 ? run : 0, longestStreak: longest };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/unit/worker/days.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing fabricator tests**

`tests/unit/worker/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HISTORY_FIRST_DAY } from '../../../src/api/types';
import { mulberry32 } from '../../../src/core/rng';
import { dayNumber, dayText, localDayOf, streaksOf } from '../../../worker/lib/days';
import { BEST_FROM, fabricateHistory, importRunId, parseImportRequest, split, type History, type HistoryInput } from '../../../worker/lib/history';
import { GAME_ID } from '../../../worker/routes/games';

const FIRST = dayNumber(HISTORY_FIRST_DAY) as number;
/** 13:00 on 2026-10-08 in California (PDT, offset 420). */
const NOW = Date.UTC(2026, 9, 8, 20, 0);
const base: HistoryInput = {
  importId: 'AbCdEfGhIjKlMnOpQrStUv',
  solved: 40,
  bestMs: 41_000,
  averageMs: 78_500,
  streak: 3,
  longestStreak: 5,
  lastDay: dayNumber('2026-10-07') as number,
  tz: 420,
  now: NOW,
};

/** The distinct local days of a history's finishes, ascending. */
const daysOf = (h: History, tz: number): number[] => [...new Set(h.runs.map((r) => localDayOf(r.finishedAt, tz)))].sort((a, b) => a - b);
const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

/** 600 valid inputs from a fixed seed: sizes up to 2,000, offsets from -840 to 840, streaks that fit and that don't. */
function sweep(): HistoryInput[] {
  const r = mulberry32(2026);
  const out: HistoryInput[] = [];
  for (let c = 0; c < 600; c++) {
    const tz = [420, 0, -330, 480, -600, 840, -840][c % 7];
    const today = localDayOf(NOW, tz);
    const solved = c % 50 === 0 ? 2000 : 1 + Math.floor(r() * 60);
    const bestMs = (5 + Math.floor(r() * 200)) * 1000;
    const streak = 1 + Math.floor(r() * 12);
    out.push({
      importId: `case${String(c).padStart(4, '0')}_xxxxxxxxxxxx`,
      solved,
      bestMs,
      averageMs: solved === 1 ? bestMs : bestMs + Math.floor(r() * 100_000),
      streak,
      longestStreak: streak + Math.floor(r() * 6),
      lastDay: FIRST + Math.floor(r() * (today - FIRST + 1)),
      tz,
      now: NOW,
    });
  }
  return out;
}

describe('split', () => {
  it('whole, non-negative parts in proportion that add up exactly', () => {
    expect(split(10, [1, 1, 1])).toEqual([3, 3, 4]);
    expect(split(0, [1, 2])).toEqual([0, 0]);
    expect(split(7, [0.2, 5, 1])).toEqual([0, 5, 2]);
    const parts = split(7_200_000_000, Array.from({ length: 1999 }, (_, i) => 1 + (i % 7)));
    expect(parts.reduce((s, p) => s + p, 0)).toBe(7_200_000_000);
    expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
  });
});

describe('fabricateHistory', () => {
  const all = sweep();
  const made = all.map((c) => fabricateHistory(c));

  it('one run is exactly the best, and none is faster', () => {
    all.forEach((c, k) => expect(Math.min(...made[k].runs.map((x) => x.ms))).toBe(c.bestMs));
  });

  it('the runs add up to exactly solved × average', () => {
    all.forEach((c, k) => {
      expect(made[k].runs).toHaveLength(c.solved);
      expect(made[k].runs.reduce((s, x) => s + x.ms, 0)).toBe(c.solved * c.averageMs);
    });
  });

  it('the best comes in the last 40%, and is the only run that fast whenever the average leaves room', () => {
    all.forEach((c, k) => {
      const ms = made[k].runs.map((x) => x.ms);
      expect(ms.indexOf(c.bestMs)).toBeGreaterThanOrEqual(Math.floor(c.solved * BEST_FROM));
      if (c.solved * (c.averageMs - c.bestMs) >= c.solved - 1) expect(ms.filter((m) => m === c.bestMs)).toHaveLength(1);
    });
  });

  it('no date before 2026-09-29 or after lastSolvedDay (local); the last day is played; nothing later than a second ago', () => {
    all.forEach((c, k) => {
      const days = daysOf(made[k], c.tz);
      expect(days[0]).toBeGreaterThanOrEqual(FIRST);
      expect(days.at(-1)).toBe(c.lastDay);
      for (const x of made[k].runs) expect(x.finishedAt).toBeLessThanOrEqual(c.now - 1000);
    });
  });

  it('finishes come one after another, in index order', () => {
    for (const h of made) for (let i = 1; i < h.runs.length; i++) expect(h.runs[i].finishedAt).toBeGreaterThan(h.runs[i - 1].finishedAt);
  });

  it('streaks computed from the dates are the ones asked for when they fit, else the clamped ones it reports', () => {
    let fit = 0;
    all.forEach((c, k) => {
      const h = made[k];
      expect(streaksOf(daysOf(h, c.tz), c.lastDay)).toEqual({ streak: h.streak, longestStreak: h.longestStreak });
      if (!h.clamped) {
        fit++;
        expect([h.streak, h.longestStreak]).toEqual([c.streak, c.longestStreak]);
      }
    });
    expect(fit).toBeGreaterThan(50); // the sweep exercises both
  });

  it('clamps what does not fit: the streak first, then the longest run, keeping a gap day between them', () => {
    const oct2 = dayNumber('2026-10-02') as number;
    // Sep 29 – Oct 2 is 4 days: after a 3-day streak and its gap day there is no room for a longer run.
    expect(fabricateHistory({ ...base, lastDay: oct2 })).toMatchObject({ streak: 3, longestStreak: 3, clamped: true });
    // A streak longer than the window takes the whole window.
    expect(fabricateHistory({ ...base, lastDay: oct2, streak: 9, longestStreak: 9 })).toMatchObject({ streak: 4, longestStreak: 4, clamped: true });
    // Fewer games than streak days: one game a day, as far as they go.
    expect(fabricateHistory({ ...base, solved: 2, averageMs: 50_000, streak: 5, longestStreak: 5 })).toMatchObject({ streak: 2, longestStreak: 2, clamped: true });
    // Fits: Oct 5–7, a gap on Oct 4, then Sep 29 – Oct 3.
    const fit = fabricateHistory(base);
    expect(fit).toMatchObject({ streak: 3, longestStreak: 5, clamped: false });
    expect(daysOf(fit, 420).map(dayText)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('is the same every time for the same importId, and different for another', () => {
    expect(fabricateHistory(base)).toEqual(fabricateHistory(base));
    const other = fabricateHistory({ ...base, importId: 'ZyXwVuTsRqPoNmLkJiHgFe' });
    expect(other.runs.map((x) => x.ms)).not.toEqual(fabricateHistory(base).runs.map((x) => x.ms));
  });

  it('ids are stable per importId and index, and fit the game id pattern', () => {
    const h = fabricateHistory(base);
    expect(h.runs.map((x) => x.id)).toEqual(h.runs.map((_, i) => importRunId(base.importId, i)));
    expect(importRunId(base.importId, 7)).toBe('imp_AbCdEfGhIjKlMnOpQrStUv_0007');
    for (const x of h.runs) expect(x.id).toMatch(GAME_ID);
  });

  it('earlier games are slower on average (the improvement trend), and times skew right', () => {
    for (const importId of ['aaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbb', 'Zz09_-Zz09_-Zz09_-Zz09']) {
      const ms = fabricateHistory({ ...base, importId, solved: 300, bestMs: 40_000, averageMs: 75_000 }).runs.map((x) => x.ms);
      expect(mean(ms.slice(0, 100))).toBeGreaterThan(mean(ms.slice(200)));
      expect(mean(ms)).toBeGreaterThan([...ms].sort((a, b) => a - b)[150]); // mean above the median
    }
  });

  it('games are played at plausible hours: none before 7 am in a typical import', () => {
    for (const x of fabricateHistory({ ...base, solved: 300, averageMs: 75_000 }).runs) {
      expect(new Date(x.finishedAt - 420 * 60_000).getUTCHours()).toBeGreaterThanOrEqual(7);
    }
  });

  it('refuses inputs the route never passes', () => {
    expect(() => fabricateHistory({ ...base, lastDay: FIRST - 1 })).toThrow(RangeError);
    expect(() => fabricateHistory({ ...base, solved: 0 })).toThrow(RangeError);
  });
});

describe('parseImportRequest', () => {
  const ok = { importId: 'AbCdEfGhIjKlMnOpQrStUv', solved: 40, bestSeconds: 41, averageMs: 78_500, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07', tz: 420 };

  it('accepts a valid body', () => {
    expect(parseImportRequest(ok, NOW)).toEqual({ importId: ok.importId, solved: 40, bestMs: 41_000, averageMs: 78_500, streak: 3, longestStreak: 5, lastDay: dayNumber('2026-10-07'), tz: 420 });
    expect(typeof parseImportRequest({ ...ok, solved: 1, averageMs: 41_000 }, NOW)).toBe('object'); // one game: average = best
    expect(typeof parseImportRequest({ ...ok, lastSolvedDay: '2026-10-08' }, NOW)).toBe('object'); // today, in California
  });

  it.each([
    [{ importId: 'short' }, 'importId'],
    [{ importId: 'has spaces in it here!!' }, 'importId'],
    [{ solved: 0 }, 'Games solved'],
    [{ solved: 2001 }, 'Games solved'],
    [{ solved: 2.5 }, 'Games solved'],
    [{ bestSeconds: 4 }, 'Best time'],
    [{ bestSeconds: 3601 }, 'Best time'],
    [{ bestSeconds: '41' }, 'Best time'],
    [{ averageMs: 40_999 }, 'Average time'],
    [{ averageMs: 3_600_001 }, 'Average time'],
    [{ solved: 1, averageMs: 42_000 }, 'one game'],
    [{ streak: 0 }, 'Streaks'],
    [{ streak: 6, longestStreak: 5 }, 'Streaks'],
    [{ longestStreak: 3651 }, 'Streaks'],
    [{ tz: 841 }, 'tz'],
    [{ tz: '420' }, 'tz'],
    [{ lastSolvedDay: '2026-09-28' }, 'Last solved day'],
    [{ lastSolvedDay: '2026-10-09' }, 'Last solved day'], // tomorrow in California
    [{ lastSolvedDay: '2026-02-30' }, 'Last solved day'],
  ])('refuses %o', (over, field) => {
    const r = parseImportRequest({ ...ok, ...over }, NOW);
    expect(typeof r).toBe('string');
    expect(r).toContain(field);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/unit/worker/history.test.ts`
Expected: FAIL: cannot find `worker/lib/history`.

- [ ] **Step 8: Write `worker/lib/history.ts`**

```ts
import { HISTORY_FIRST_DAY, MAX_IMPORT_MS, MAX_IMPORT_RUNS, MAX_STREAK_DAYS, MIN_IMPORT_BEST_SECONDS } from '../../src/api/types.js';
import { mulberry32, type Rng } from '../../src/core/rng.js';
import { DAY_MS, dayNumber, isTzOffset, localDayOf, localMidnight } from './days.js';

/**
 * The history import's runs (spec 2026-10-08 §4): a device's totals turned into plausible games, deterministically.
 * Pure: the same input always gives the same runs, so a resent import inserts nothing new.
 */

/** The first game's expected excess over the best is 1 + TREND times the last game's: a gentle improvement. */
export const TREND = 0.6;
/** Spread of the log-normal factor on each game's time above the best (solve times skew right). */
export const SIGMA = 0.5;
/** The best run is among the last 40% of games. */
export const BEST_FROM = 0.6;

const FIRST_DAY = dayNumber(HISTORY_FIRST_DAY) as number;
const HOUR = 3_600_000;
const IMPORT_ID = /^[A-Za-z0-9_-]{16,32}$/;

export interface HistoryInput {
  importId: string;
  solved: number;
  bestMs: number;
  averageMs: number;
  streak: number;
  longestStreak: number;
  /** Day number (worker/lib/days.ts) of the last solved day, local to `tz`. */
  lastDay: number;
  /** Date#getTimezoneOffset() of the device: UTC minus local, in minutes. */
  tz: number;
  /** The server's clock: nothing is dated later than a second before it. */
  now: number;
}

export interface ImportedRun {
  id: string;
  finishedAt: number;
  ms: number;
}

export interface History {
  /** In chronological order. */
  runs: ImportedRun[];
  /** What the dates show: the request's streaks, or less when they didn't fit. */
  streak: number;
  longestStreak: number;
  clamped: boolean;
}

/** FNV-1a (32-bit) of the import id: the PRNG's seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Whole, non-negative parts of `total` in proportion to positive `weights`, adding up to `total` exactly: each part is
 * the step between rounded running sums, and the last running sum is `total` itself.
 */
export function split(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  const out: number[] = [];
  let acc = 0;
  let prev = 0;
  weights.forEach((w, i) => {
    acc += w;
    const upto = i === weights.length - 1 ? total : Math.min(total, Math.floor((total * acc) / sum));
    out.push(upto - prev);
    prev = upto;
  });
  return out;
}

/** The import's i-th run: a stable id, inside the game id pattern ([A-Za-z0-9_-]{16,64}). */
export const importRunId = (importId: string, i: number): string => `imp_${importId}_${String(i).padStart(4, '0')}`;

interface DayPlan {
  /** Played days, ascending. */
  days: number[];
  /** Games on each played day (each at least 1). */
  counts: number[];
  streak: number;
  longestStreak: number;
}

/** Which days have games, and how many (spec §4.2). */
function planDays(n: number, streak: number, longest: number, first: number, last: number, rng: Rng): DayPlan {
  const span = last - first + 1;
  // The current streak shrinks first: to the window and to one game a day.
  const s = Math.min(streak, span, n);
  // Then a separate longest run, before a gap day, in what is left; dropped if it can't beat the streak.
  let l = longest > s ? Math.min(longest, span - s - 1, n - s) : 0;
  if (l <= s) l = 0;
  const top = l > 0 ? l : s;
  const blockStart = l > 0 ? last - s - l : last - s + 1;
  const reserved: number[] = [];
  for (let d = blockStart; d < blockStart + l; d++) reserved.push(d);
  for (let d = last - s + 1; d <= last; d++) reserved.push(d);
  // Earlier days, leaving the day before the block empty: each played at even odds, never in a run longer than `top`.
  const free: number[] = [];
  let run = 0;
  for (let d = first; d <= blockStart - 2; d++) {
    const pick = rng() < 0.5;
    if (pick && run < top) {
      free.push(d);
      run++;
    } else run = 0;
  }
  // As many as there are games left for, the latest first.
  const spare = n - reserved.length;
  const days = [...free.slice(Math.max(0, free.length - spare)), ...reserved];
  const extra = split(n - days.length, days.map(() => 0.5 + rng()));
  return { days, counts: extra.map((x) => x + 1), streak: s, longestStreak: top };
}

/** Each game's time in index (chronological) order (spec §4.3): exactly one at the best, adding up to `total`. */
function times(n: number, bestMs: number, total: number, rng: Rng): number[] {
  const lo = Math.floor(n * BEST_FROM);
  const bestAt = lo + Math.floor(rng() * (n - lo));
  const others = n - 1;
  const excess = total - n * bestMs;
  // With room, every other game is at least 1 ms slower, so the best is the only one that fast.
  const floor = excess >= others ? 1 : 0;
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === bestAt) continue;
    const pos = n > 1 ? i / (n - 1) : 0;
    const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    weights.push((1 + TREND * (1 - pos)) * Math.exp(SIGMA * z));
  }
  const shares = split(excess - floor * others, weights);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) out.push(i === bestAt ? bestMs : bestMs + floor + shares[k++]);
  return out;
}

/** The runs for an import (spec §4). Throws RangeError for input the route never passes. */
export function fabricateHistory(input: HistoryInput): History {
  if (!(input.solved >= 1) || !(input.lastDay >= FIRST_DAY)) throw new RangeError('fabricateHistory: at least one game, on or after the first day');
  const rng = mulberry32(seedOf(input.importId));
  const n = input.solved;
  const plan = planDays(n, input.streak, input.longestStreak, FIRST_DAY, input.lastDay, rng);
  const ms = times(n, input.bestMs, n * input.averageMs, rng);
  const runs: ImportedRun[] = [];
  let i = 0;
  plan.days.forEach((day, k) => {
    const count = plan.counts[k];
    const midnight = localMidnight(day, input.tz);
    // The day's end, or (on today) a second ago.
    const limit = Math.min(DAY_MS - 1, input.now - 1000 - midnight);
    // A session: morning, lunch or (mostly) evening, games one after another.
    const r = rng();
    const [from, to] = r < 0.15 ? [7 * HOUR, 9.5 * HOUR] : r < 0.4 ? [12 * HOUR, 14 * HOUR] : [18.5 * HOUR, 23 * HOUR];
    let t = from + Math.floor(rng() * (to - from));
    const ends: number[] = [];
    for (let j = 0; j < count; j++) {
      if (j > 0) t += 4_000 + Math.floor(rng() * 41_000);
      t += ms[i + j];
      ends.push(t);
    }
    // Too late: the session moves earlier. Longer than the time there is: it bunches up from midnight, 1 ms apart.
    const shift = Math.max(0, ends[count - 1] - limit);
    ends.forEach((e, j) => runs.push({ id: importRunId(input.importId, i + j), finishedAt: midnight + Math.max(e - shift, j), ms: ms[i + j] }));
    i += count;
  });
  return {
    runs,
    streak: plan.streak,
    longestStreak: plan.longestStreak,
    clamped: plan.streak !== input.streak || plan.longestStreak !== input.longestStreak,
  };
}

const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** POST /api/admin/import's body, checked in the spec's order (§3.1): the fabricator's input, or the first problem. */
export function parseImportRequest(body: Record<string, unknown>, now: number): Omit<HistoryInput, 'now'> | string {
  const { importId, solved, bestSeconds, averageMs, streak, longestStreak, lastSolvedDay, tz } = body;
  if (typeof importId !== 'string' || !IMPORT_ID.test(importId)) return 'importId must be 16–32 letters, digits, - or _.';
  if (!int(solved, 1, MAX_IMPORT_RUNS)) return 'Games solved must be a whole number from 1 to 2,000.';
  if (!int(bestSeconds, MIN_IMPORT_BEST_SECONDS, MAX_IMPORT_MS / 1000)) return 'Best time must be from 0:05 to 60:00, in whole seconds.';
  const bestMs = bestSeconds * 1000;
  if (!int(averageMs, bestMs, MAX_IMPORT_MS)) return 'Average time must be at least the best time and at most 60:00.';
  if (solved === 1 && averageMs !== bestMs) return 'With one game, the average time is the best time.';
  if (!int(streak, 1, MAX_STREAK_DAYS) || !int(longestStreak, streak, MAX_STREAK_DAYS)) {
    return 'Streaks are whole days from 1 to 3,650, and the longest is at least the current one.';
  }
  if (!isTzOffset(tz)) return 'tz must be whole minutes from -840 to 840.';
  const lastDay = dayNumber(lastSolvedDay);
  if (lastDay === null || lastDay < FIRST_DAY || lastDay > localDayOf(now, tz)) return 'Last solved day must be a date from 2026-09-29 to today.';
  return { importId, solved, bestMs, averageMs, streak, longestStreak, lastDay, tz };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/worker/days.test.ts tests/unit/worker/history.test.ts && npm run typecheck`
Expected: PASS; typecheck clean. (This exact algorithm was checked against the sweep while planning: no failures, 87 of the 600 inputs fit without clamping, about 1 ms for 2,000 runs.)

- [ ] **Step 10: Commit**

```bash
git add src/api/types.ts worker/lib/days.ts worker/lib/history.ts tests/unit/worker/days.test.ts tests/unit/worker/history.test.ts
git commit -m "feat(history): day helpers and the seeded history fabricator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0002 and `POST /api/admin/import`

**Files:**
- Create: `migrations/0002_history_import.sql`, `worker/routes/admin/history.ts`
- Modify: `worker/router.ts`, `src/api/types.ts` (`ImportResponse`)
- Test: `tests/worker/schema.test.ts` (one test added), `tests/worker/history.test.ts` (new)

**Interfaces:**
- Consumes: `fabricateHistory`, `importRunId`, `parseImportRequest` (Task 1); `requireAdmin` (`worker/lib/users.ts`); `readJson`, `json`, `HttpError` (`worker/lib/http.ts`); `resetBoardCache` (`worker/lib/board-cache.ts`); test harness `startDb`, `wipe`, `testEnv`, `signIn`, `call` (`tests/worker/harness.ts`).
- Produces: `interface ImportResponse { added: number; already: boolean; streak: number; longestStreak: number; clamped: boolean }` in `src/api/types.ts`; `POST` handler in `worker/routes/admin/history.ts`; the route `['POST', /^\/api\/admin\/import$/, historyImport.POST]`; column `games.source`.

- [ ] **Step 1: Write the failing schema test**

Append inside the `describe('migrations', …)` block of `tests/worker/schema.test.ts`:

```ts
  it('games.source: play by default, import for imported runs, nothing else (migration 0002)', async () => {
    await db.prepare("INSERT INTO games (id, gen_version, seed, started_at) VALUES ('played-aaaaaaaaaaaaa', 1, 1, 1)").run();
    expect((await db.prepare("SELECT source FROM games WHERE id = 'played-aaaaaaaaaaaaa'").first<{ source: string }>())?.source).toBe('play');
    await db.prepare("INSERT INTO games (id, gen_version, seed, started_at, source) VALUES ('import-aaaaaaaaaaaaa', 0, 0, 1, 'import')").run();
    await expect(db.prepare("INSERT INTO games (id, gen_version, seed, started_at, source) VALUES ('bogus-aaaaaaaaaaaaaa', 0, 0, 1, 'bogus')").run()).rejects.toThrow(/CHECK/);
  });
```

- [ ] **Step 2: Write the failing route tests**

`tests/worker/history.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BoardResponse, ImportRequest, ImportResponse } from '../../src/api/types';
import { dayText, localDayOf } from '../../worker/lib/days';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { importRunId } from '../../worker/lib/history';
import { call, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
let env: AppEnv;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
  env = testEnv(db);
});
afterAll(() => dispose());
beforeEach(() => wipe(db));

const ADMIN = 'admin@example.com';
const ID = 'AbCdEfGhIjKlMnOpQrStUv';
/** Today in California, so the body is valid whenever the suite runs (the window then holds 2 + gap + 3 days). */
const today = (): string => dayText(localDayOf(Date.now(), 420));
const body = (over: Partial<ImportRequest> = {}): ImportRequest => ({
  importId: ID,
  solved: 12,
  bestSeconds: 41,
  averageMs: 78_500,
  streak: 2,
  longestStreak: 3,
  lastSolvedDay: today(),
  tz: 420,
  ...over,
});
const importAs = (cookie: string, b: unknown = body(), e: AppEnv = env) => call(e, 'POST', '/api/admin/import', { cookie, body: b });

interface Row {
  id: string;
  user_id: number;
  claim_hash: string | null;
  gen_version: number;
  seed: number;
  started_at: number;
  finished_at: number;
  ms: number;
  paused_ms: number;
  pauses: number;
  ranked: number;
  unranked_reason: string | null;
  log: string | null;
  source: string;
}
const imported = async (): Promise<Row[]> => (await db.prepare("SELECT * FROM games WHERE source = 'import' ORDER BY id").all<Row>()).results;

describe('POST /api/admin/import', () => {
  it('is the admin’s alone: 401 signed out, 403 for another account and for a cross-site post', async () => {
    expect((await call(env, 'POST', '/api/admin/import', { body: body() })).status).toBe(401);
    expect((await importAs(await signIn(env, 'bo@example.com', 'Comet'))).status).toBe(403);
    const admin = await signIn(env, ADMIN, 'Tinsel');
    expect((await call(env, 'POST', '/api/admin/import', { cookie: admin, body: body(), origin: 'https://evil.example' })).status).toBe(403);
    expect(await imported()).toEqual([]);
  });

  it('400 invalid, with the field’s message', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    const res = await importAs(admin, body({ solved: 2001 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', message: 'Games solved must be a whole number from 1 to 2,000.' });
    expect(await imported()).toEqual([]);
  });

  it('adds the runs as ordinary ranked games of the admin’s own account', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    const res = await importAs(admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 12, already: false, streak: 2, longestStreak: 3, clamped: false } satisfies ImportResponse);
    const me = await db.prepare('SELECT id FROM users WHERE email = ?').bind(ADMIN).first<{ id: number }>();
    const rows = await imported();
    expect(rows.map((g) => g.id)).toEqual(Array.from({ length: 12 }, (_, i) => importRunId(ID, i)));
    for (const g of rows) {
      expect(g).toMatchObject({ user_id: me?.id, claim_hash: null, gen_version: 0, seed: 0, paused_ms: 0, pauses: 0, ranked: 1, unranked_reason: null, log: null, source: 'import' });
      expect(g.started_at).toBe(g.finished_at - g.ms);
    }
    expect(Math.min(...rows.map((g) => g.ms))).toBe(41_000);
    expect(rows.reduce((s, g) => s + g.ms, 0)).toBe(12 * 78_500);
  });

  it('the same importId again adds nothing, even with other numbers; another id imports', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    await importAs(admin);
    const again = await importAs(admin, body({ solved: 30, averageMs: 90_000 }));
    expect(await again.json()).toMatchObject({ added: 0, already: true });
    expect(await imported()).toHaveLength(12);
    const other = await importAs(admin, body({ importId: 'ZyXwVuTsRqPoNmLkJiHgFe', solved: 3 }));
    expect(await other.json()).toMatchObject({ added: 3, already: false });
    expect(await imported()).toHaveLength(15);
  });

  it('the runs are on the board at once (the isolate’s cached board is dropped), ranked like any run', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    expect(((await (await call(env, 'GET', '/api/board')).json()) as BoardResponse).total).toBe(0); // primes the cache
    await importAs(admin);
    const b = (await (await call(env, 'GET', '/api/board')).json()) as BoardResponse;
    expect(b.total).toBe(12);
    expect(b.rows[0]).toMatchObject({ rank: 1, name: 'Tinsel', ms: 41_000 });
  });

  it('a finish sent for an imported id answers what is stored and changes nothing (never replayed)', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    await importAs(admin);
    const id = importRunId(ID, 0);
    const before = await db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Row>();
    const res = await call(env, 'POST', `/api/games/${id}/finish`, { cookie: admin, body: { log: [] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, ranked: true, ms: before?.ms });
    expect(await db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Row>()).toEqual(before);
  });

  it('the largest import, 2,000 runs, is one INSERT statement', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    const prepared: string[] = [];
    const spy: Db = {
      prepare: (q: string) => {
        prepared.push(q);
        return db.prepare(q);
      },
      batch: (s) => db.batch(s),
    };
    const res = await importAs(admin, body({ solved: 2000, averageMs: 90_000 }), testEnv(spy));
    expect(await res.json()).toMatchObject({ added: 2000, already: false });
    expect(prepared.filter((q) => q.trimStart().startsWith('INSERT'))).toHaveLength(1);
    expect(await imported()).toHaveLength(2000);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/worker/schema.test.ts tests/worker/history.test.ts`
Expected: FAIL: no `source` column; `/api/admin/import` answers 404.

- [ ] **Step 4: Write the migration**

`migrations/0002_history_import.sql`:

```sql
-- History import (spec 2026-10-08 section 2): where a game came from. 'play' for games played on Aglow (every row so
-- far), 'import' for runs the admin imported from a device's pre-accounts stats.
ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'play' CHECK (source IN ('play', 'import'));
```

(The harness splitter strips `--` comments and splits on a line-ending `;`: this file has neither inside a string.)

- [ ] **Step 5: Add the response type**

Append to `src/api/types.ts`:

```ts
/** POST /api/admin/import's answer. */
export interface ImportResponse {
  /** Runs inserted (0 when this importId was imported before). */
  added: number;
  already: boolean;
  /** What the dates show: the request's streaks, or less when they didn't fit between 2026-09-29 and the last day. */
  streak: number;
  longestStreak: number;
  clamped: boolean;
}
```

- [ ] **Step 6: Write the route**

`worker/routes/admin/history.ts`:

```ts
import type { ImportResponse } from '../../../src/api/types.js';
import { resetBoardCache } from '../../lib/board-cache.js';
import type { AppEnv } from '../../lib/env.js';
import { fabricateHistory, importRunId, parseImportRequest } from '../../lib/history.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { requireAdmin } from '../../lib/users.js';

/**
 * Every run in one statement, from a JSON array of [id, finishedAt, ms] (D1: at most 100 bound parameters and 50
 * queries per request; a bound value may be 2 MB, and 2,000 runs are about 140 KB). OR IGNORE: a run already there
 * stays as it is.
 */
const INSERT = `INSERT OR IGNORE INTO games (id, user_id, claim_hash, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, log, source)
SELECT json_extract(value, '$[0]'), ?1, NULL, 0, 0, json_extract(value, '$[1]') - json_extract(value, '$[2]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), 0, 0, 1, NULL, NULL, 'import'
FROM json_each(?2)`;

/**
 * POST /api/admin/import (spec 2026-10-08 §3.1): this device's pre-accounts stats become runs on the admin's own
 * account. The runs are a pure function of the request, and an importId whose first run exists adds nothing, so a
 * resend (or a resend with other numbers) can never double them.
 */
export async function POST(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireAdmin(req, env);
  const now = Date.now();
  const input = parseImportRequest(await readJson(req), now);
  if (typeof input === 'string') throw new HttpError(400, 'invalid', input);
  const history = fabricateHistory({ ...input, now });
  const done = await env.DB.prepare('SELECT 1 AS x FROM games WHERE id = ?').bind(importRunId(input.importId, 0)).first();
  let added = 0;
  if (!done) {
    const rows = JSON.stringify(history.runs.map((r) => [r.id, r.finishedAt, r.ms]));
    added = (await env.DB.prepare(INSERT).bind(user.id, rows).run()).meta.changes;
    resetBoardCache(); // the runs join the board (once the admin has a name) at once in this isolate
  }
  return json({ added, already: added === 0, streak: history.streak, longestStreak: history.longestStreak, clamped: history.clamped } satisfies ImportResponse);
}
```

- [ ] **Step 7: Route it**

In `worker/router.ts`, add the import after `import * as upload from './routes/admin/upload.js';`:

```ts
import * as historyImport from './routes/admin/history.js';
```

and add a row at the end of `ROUTES`, after the upload route:

```ts
  ['POST', /^\/api\/admin\/import$/, historyImport.POST],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/worker/schema.test.ts tests/worker/history.test.ts tests/unit/worker/imports.test.ts && npm run typecheck`
Expected: PASS; the import guard still finds only allowed `src/` files.

- [ ] **Step 9: Run the whole unit and Worker suite**

Run: `npm test`
Expected: PASS (existing tests insert games without `source` and get `'play'`).

- [ ] **Step 10: Commit**

```bash
git add migrations/0002_history_import.sql worker/routes/admin/history.ts worker/router.ts src/api/types.ts tests/worker/schema.test.ts tests/worker/history.test.ts
git commit -m "feat(admin): POST /api/admin/import adds a device's history as imported runs (migration 0002)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/me/stats`, imported runs in Your games data, and the client call

**Files:**
- Modify: `worker/routes/me.ts`, `worker/router.ts`, `src/api/types.ts` (`AccountStats`, `RecentGame.imported`), `src/api/client.ts`
- Modify (tests that build `RecentGame`s): `tests/worker/board.test.ts:225-227`, `tests/unit/ui/board-sheets.test.ts:83-85`
- Test: `tests/worker/stats.test.ts` (new), `tests/unit/api/client.test.ts` (one test added)

**Interfaces:**
- Consumes: `dayNumber`, `dayText`, `isTzOffset`, `streaksOf` (Task 1); `BEST_SQL`, `BestRun` (`worker/lib/ranks.ts`); `localDay(d: Date): string` (`src/store/stats.ts`).
- Produces:
  - `interface AccountStats { solved: number; totalMs: number; averageMs: number | null; bestMs: number | null; streak: number; longestStreak: number; lastSolvedDay: string | null; imported: number }`; `RecentGame.imported: boolean`.
  - `myStats(req, env)` in `worker/routes/me.ts`, routed as `['GET', /^\/api\/me\/stats$/, me.myStats]`.
  - `api.myStats(now?: Date): Promise<AccountStats>` in `src/api/client.ts`.

- [ ] **Step 1: Write the failing Worker tests**

`tests/worker/stats.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountStats, MyGamesResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { call, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
let env: AppEnv;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
  env = testEnv(db);
});
afterAll(() => dispose());
beforeEach(() => wipe(db));

const DAY = 86_400_000;
/** Noon in California (offset 420) on the day `back` days before 2026-10-08. */
const noonPdt = (back: number): number => Date.UTC(2026, 9, 8, 19, 0) - back * DAY;

/** A user as fake sign-in would create them (google_sub "fake:<email>"), so signIn() finds the same account. */
async function user(email: string, name: string | null): Promise<number> {
  const row = await db
    .prepare('INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES (?, ?, ?, ?, 1) RETURNING id')
    .bind(`fake:${email}`, email, name, name === null ? null : name.toLowerCase())
    .first<{ id: number }>();
  if (!row) throw new Error('no user');
  return row.id;
}

let made = 0;
/** A game straight into D1: finished (ranked unless told otherwise) or, with a null finish, still in play. */
async function game(userId: number, ms: number, finishedAt: number | null, o: { ranked?: boolean; source?: 'play' | 'import' } = {}): Promise<string> {
  const id = `stat-${String(++made).padStart(16, '0')}`;
  const done = finishedAt !== null;
  const ranked = done && (o.ranked ?? true);
  await db
    .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, source) VALUES (?, ?, 1, 1, ?, ?, ?, 0, 0, ?, ?, ?)')
    .bind(id, userId, (finishedAt ?? Date.now()) - ms, finishedAt, done ? ms : null, ranked ? 1 : 0, done && !ranked ? 'paused' : null, o.source ?? 'play')
    .run();
  return id;
}
const stats = (cookie: string | undefined, q = 'today=2026-10-08&tz=420') => call(env, 'GET', `/api/me/stats?${q}`, { cookie });

describe('GET /api/me/stats', () => {
  it('401 signed out; 400 without a real today and a whole-minute offset', async () => {
    expect((await stats(undefined)).status).toBe(401);
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    for (const q of ['', 'today=2026-10-08', 'tz=420', 'today=2026-02-30&tz=420', 'today=10/08/2026&tz=420', 'today=2026-10-08&tz=1.5', 'today=2026-10-08&tz=900']) {
      const res = await stats(cookie, q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid', message: 'today must be YYYY-MM-DD and tz whole minutes from -840 to 840.' });
    }
  });

  it('a new account: zeros and nulls', async () => {
    const res = await stats(await signIn(env, 'ana@example.com', 'Meridian'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ solved: 0, totalMs: 0, averageMs: null, bestMs: null, streak: 0, longestStreak: 0, lastSolvedDay: null, imported: 0 } satisfies AccountStats);
  });

  it('counts every finished game, imported ones too, and averages them; the best is the best ranked run', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const bo = await user('bo@example.com', 'Comet');
    await game(ana, 60_000, noonPdt(3));
    await game(ana, 45_000, noonPdt(2), { ranked: false }); // faster, but unranked: not the best
    await game(ana, 50_000, noonPdt(1), { source: 'import' });
    await game(ana, 30_000, null); // never finished: not counted
    await game(bo, 10_000, noonPdt(0)); // someone else's
    expect(await (await stats(await signIn(env, 'ana@example.com'))).json()).toEqual({
      solved: 3,
      totalMs: 155_000,
      averageMs: 51_667,
      bestMs: 50_000,
      streak: 3,
      longestStreak: 3,
      lastSolvedDay: '2026-10-07',
      imported: 1,
    } satisfies AccountStats);
  });

  it('streaks come from the local days of finishes: alive today or yesterday, else 0; and the longest run', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    for (const back of [0, 1, 2, 4, 5, 6, 7, 8]) await game(ana, 50_000, noonPdt(back));
    await game(ana, 52_000, noonPdt(0) + 3_600_000); // a second game the same day counts once
    const cookie = await signIn(env, 'ana@example.com');
    expect(await (await stats(cookie)).json()).toMatchObject({ solved: 9, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-08' });
    expect(await (await stats(cookie, 'today=2026-10-09&tz=420')).json()).toMatchObject({ streak: 3 }); // yesterday still counts
    expect(await (await stats(cookie, 'today=2026-10-10&tz=420')).json()).toMatchObject({ streak: 0, longestStreak: 5 });
  });

  it('the offset decides the day: 22:30 in California is the next day in UTC and in Sydney', async () => {
    const bo = await user('bo@example.com', 'Comet');
    await game(bo, 50_000, Date.UTC(2026, 9, 9, 5, 30));
    const cookie = await signIn(env, 'bo@example.com');
    expect(await (await stats(cookie, 'today=2026-10-08&tz=420')).json()).toMatchObject({ lastSolvedDay: '2026-10-08', streak: 1 });
    expect(await (await stats(cookie, 'today=2026-10-09&tz=0')).json()).toMatchObject({ lastSolvedDay: '2026-10-09', streak: 1 });
    expect(await (await stats(cookie, 'today=2026-10-09&tz=-600')).json()).toMatchObject({ lastSolvedDay: '2026-10-09' });
  });
});

describe('GET /api/me/games', () => {
  it('marks imported runs', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const played = await game(ana, 60_000, noonPdt(1));
    const fromDevice = await game(ana, 50_000, noonPdt(2), { source: 'import' });
    const g = (await (await call(env, 'GET', '/api/me/games', { cookie: await signIn(env, 'ana@example.com') })).json()) as MyGamesResponse;
    expect(g.games.map((x) => [x.id, x.imported])).toEqual([
      [played, false],
      [fromDevice, true],
    ]);
  });
});
```

- [ ] **Step 2: Write the failing client test**

Add inside `describe('api client', …)` in `tests/unit/api/client.test.ts`:

```ts
  it('asks for the account stats with the local day and the offset, never from the cache', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const at = new Date(2026, 9, 8, 21, 0);
    await api.myStats(at);
    expect(fetch.mock.calls[0][0]).toBe(`/api/me/stats?today=2026-10-08&tz=${at.getTimezoneOffset()}`);
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/worker/stats.test.ts tests/unit/api/client.test.ts`
Expected: FAIL: `/api/me/stats` answers 404; `api.myStats` is not a function.

- [ ] **Step 4: Add the types**

In `src/api/types.ts`, add to `RecentGame` (after `isBest`):

```ts
  /** Imported from a device's pre-accounts stats (spec 2026-10-08), not played on Aglow. */
  imported: boolean;
```

and append:

```ts
/** GET /api/me/stats (spec 2026-10-08 §3.2): the account's stats, the same on every device. */
export interface AccountStats {
  /** Finished games, any ranked state, imported ones included. */
  solved: number;
  totalMs: number;
  /** round(totalMs / solved); null with no game. */
  averageMs: number | null;
  /** The best ranked run (the board's "your best"); null with none. */
  bestMs: number | null;
  /** Consecutive local days ending today or yesterday; 0 otherwise. */
  streak: number;
  longestStreak: number;
  /** The last local day with a finish, YYYY-MM-DD. */
  lastSolvedDay: string | null;
  /** How many of `solved` were imported. */
  imported: number;
}
```

- [ ] **Step 5: Update the two tests that build `RecentGame`s**

In `tests/worker/board.test.ts`, the expected `games` (lines 225–227) become:

```ts
        { id: clock, ms: 30_000, finishedAt: 4000, ranked: false, reason: 'clock', isBest: false, imported: false },
        { id: slower, ms: 60_000, finishedAt: 3000, ranked: true, reason: null, isBest: false, imported: false },
        { id: best, ms: 45_000, finishedAt: 2000, ranked: true, reason: null, isBest: true, imported: false },
```

In `tests/unit/ui/board-sheets.test.ts`, the three games (lines 83–85) become:

```ts
      { id: 'a', ms: 94_200, finishedAt: now - 3_600_000, ranked: true, reason: null, isBest: false, imported: false },
      { id: 'b', ms: 125_100, finishedAt: day, ranked: false, reason: 'paused', isBest: false, imported: false },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: false },
```

- [ ] **Step 6: Write the routes**

In `worker/routes/me.ts`, replace the imports with:

```ts
import type { AccountStats, MeResponse, MyGamesResponse, RecentGame, UnrankedReason } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { cachedTopAndTotal, cachedTotal, resetBoardCache } from '../lib/board-cache.js';
import { dayNumber, dayText, isTzOffset, streaksOf } from '../lib/days.js';
import { BEST_SQL, bestOf, rankOf, type BestRun } from '../lib/ranks.js';
import { clearSessionCookie, currentUser, publicUser, RENEW_UNDER_DAYS, requireUser, SESSION_DAYS, sessionCookie } from '../lib/users.js';
```

Add `source: string;` to `interface RecentRow`, change the recent-games query to

```ts
    env.DB.prepare('SELECT id, ms, finished_at, ranked, unranked_reason, source FROM games WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 30')
```

and add `imported: g.source === 'import',` after `isBest: g.id === best?.id,` in the mapping. Then append:

```ts
const TZ = /^-?\d{1,3}$/;

/**
 * GET /api/me/stats?today=YYYY-MM-DD&tz=<minutes> (spec 2026-10-08 §3.2): the account's stats, the same on every
 * device. One batch: totals, the distinct local days of finishes (for the streaks), and the best ranked run.
 */
export async function myStats(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const q = new URL(req.url).searchParams;
  const today = dayNumber(q.get('today'));
  const tzText = q.get('tz') ?? '';
  const tz = TZ.test(tzText) ? Number(tzText) : Number.NaN;
  if (today === null || !isTzOffset(tz)) throw new HttpError(400, 'invalid', 'today must be YYYY-MM-DD and tz whole minutes from -840 to 840.');
  const [totals, days, best] = await env.DB.batch([
    env.DB.prepare("SELECT count(*) AS solved, coalesce(sum(ms), 0) AS total, coalesce(sum(source = 'import'), 0) AS imported FROM games WHERE user_id = ? AND finished_at IS NOT NULL").bind(user.id),
    // A finish's local day, in days since 1970-01-01; the CAST keeps the division whole whatever type D1 binds the offset as.
    env.DB.prepare('SELECT DISTINCT (finished_at - CAST(?2 AS INTEGER)) / 86400000 AS day FROM games WHERE user_id = ?1 AND finished_at IS NOT NULL ORDER BY day').bind(user.id, tz * 60_000),
    env.DB.prepare(BEST_SQL).bind(user.id),
  ]);
  const t = totals.results[0] as { solved: number; total: number; imported: number } | undefined;
  const list = (days.results as { day: number }[]).map((r) => r.day);
  const { streak, longestStreak } = streaksOf(list, today);
  const solved = t?.solved ?? 0;
  const totalMs = t?.total ?? 0;
  const last = list.at(-1);
  return json({
    solved,
    totalMs,
    averageMs: solved ? Math.round(totalMs / solved) : null,
    bestMs: (best.results[0] as BestRun | undefined)?.ms ?? null,
    streak,
    longestStreak,
    lastSolvedDay: last === undefined ? null : dayText(last),
    imported: t?.imported ?? 0,
  } satisfies AccountStats);
}
```

In `worker/router.ts`, add after `['GET', /^\/api\/me\/games$/, me.myGames],`:

```ts
  ['GET', /^\/api\/me\/stats$/, me.myStats],
```

- [ ] **Step 7: Write the client call**

In `src/api/client.ts`, add to the imports:

```ts
import { localDay } from '../store/stats';
```

add `AccountStats` to the `import type { … } from './types';` list, and add to `api` after `myGames`:

```ts
  /** The account's stats in this browser's day and zone (spec 2026-10-08 §3.2). */
  myStats: (now: Date = new Date()) => request<AccountStats>('GET', `/api/me/stats?today=${localDay(now)}&tz=${now.getTimezoneOffset()}`),
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/worker/stats.test.ts tests/worker/board.test.ts tests/unit/api/client.test.ts tests/unit/ui/board-sheets.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add worker/routes/me.ts worker/router.ts src/api/types.ts src/api/client.ts tests/worker/stats.test.ts tests/worker/board.test.ts tests/unit/api/client.test.ts tests/unit/ui/board-sheets.test.ts
git commit -m "feat(me): GET /api/me/stats and imported runs in Your games data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Account stats on the results tag and in Your games

Signed in, the results tag's Solved, Average and Day streak and a new totals row in Your games come from the account; the device's numbers stay the fallback (signed out, offline, loading). Imported runs say so in Your games.

**Files:**
- Modify: `src/ui/results.ts` (whole file below), `src/app.ts`, `src/ui/board-sheets.ts`, `src/ui/accounts.ts`, `src/ui/account.css`
- Test: `tests/unit/ui/results.test.ts` (new), `tests/unit/ui/board-sheets.test.ts` (one test added), `tests/e2e/accounts.spec.ts` (one test added)

**Interfaces:**
- Consumes: `AccountStats`, `RecentGame.imported`, `api.myStats()` (Task 3).
- Produces: `interface StatsView { solved: number; averageSeconds: number; streak: number }`; `deviceStatsView(s: Stats): StatsView`; `accountStatsView(a: AccountStats): StatsView`; `ResultsData` gains `view: StatsView`; `Results.setStats(v: StatsView): void`; `listView(tab, board, games, user, now, stats: Loadable<AccountStats> = { status: 'loading' })`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/ui/results.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountStats } from '../../../src/api/types';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';
import { accountStatsView, deviceStatsView, Results } from '../../../src/ui/results';

const device: Stats = { v: 1, solved: 8, totalSeconds: 800, bestSeconds: 60, bestScore: 44000, streak: 11, longestStreak: 11, lastSolvedDay: '2026-10-08' };
const account: AccountStats = { solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 300 };
const text = (id: string): string | null | undefined => document.getElementById(id)?.textContent;
const noop = (): void => undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  document.body.innerHTML = `<section id="results" hidden><h2 id="r-time"></h2><div id="r-score"></div><div id="r-badge"></div>
    <b id="r-solved"></b><b id="r-avg"></b><b id="r-streak"></b><button id="r-new"></button><button id="r-share"></button><button id="r-keep"></button></section>`;
});
afterEach(() => vi.unstubAllGlobals());

it("the views: this device's numbers, or the account's", () => {
  expect(deviceStatsView(device)).toEqual({ solved: 8, averageSeconds: 100, streak: 11 });
  expect(deviceStatsView(EMPTY_STATS)).toEqual({ solved: 0, averageSeconds: 0, streak: 0 });
  expect(accountStatsView(account)).toEqual({ solved: 312, averageSeconds: 78, streak: 4 });
  expect(accountStatsView({ ...account, solved: 0, totalMs: 0, averageMs: null, streak: 0 })).toEqual({ solved: 0, averageSeconds: 0, streak: 0 });
});

it('the tag paints the view it is given; setStats repaints the three numbers, shown or hidden; the badge stays the device’s', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  r.setStats(accountStatsView(account)); // before the tag appears
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['312', '1:18', '4']);
  r.show({ seconds: 42, score: 45800, newBest: false, stats: device, view: deviceStatsView(device) });
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['8', '1:40', '11']);
  expect(text('r-badge')).toBe('Best 1:00');
  r.setStats(accountStatsView(account));
  expect(['r-solved', 'r-avg', 'r-streak'].map(text)).toEqual(['312', '1:18', '4']);
  expect(text('r-badge')).toBe('Best 1:00');
});
```

Add to `tests/unit/ui/board-sheets.test.ts` (and add `AccountStats` to its type import from `../../../src/api/types`):

```ts
it('your games: the account totals, and imported runs say so', () => {
  const games: MyGamesResponse = {
    best: { ms: 81_000, rank: 12, finishedAt: day },
    inTop: 0,
    total: 340,
    games: [
      { id: 'a', ms: 94_200, finishedAt: day, ranked: true, reason: null, isBest: false, imported: true },
      { id: 'c', ms: 81_000, finishedAt: day, ranked: true, reason: null, isBest: true, imported: true },
    ],
  };
  const stats: AccountStats = { solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 81_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-12-03', imported: 300 };
  const el = render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now, { status: 'ready', data: stats });
  expect(texts(el, '.acct-totals b')).toEqual(['312', '1:18.4', '4', '7']);
  expect(texts(el, '.acct-totals span')).toEqual(['Solved', 'Average', 'Day streak', 'Longest']);
  expect(texts(el, '.acct-status')).toEqual(['Imported', 'Personal best · Imported']);
  // The first row is unchanged.
  expect(texts(el, '.acct-stats b')).toEqual(['1:21.0', '#12', '0']);
  // Not loaded yet: dashes.
  expect(texts(render('games', { status: 'loading' }, { status: 'ready', data: games }, me, now), '.acct-totals b')).toEqual(['–', '–', '–', '–']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/ui/results.test.ts tests/unit/ui/board-sheets.test.ts`
Expected: FAIL: `deviceStatsView` is not exported; no `.acct-totals`.

- [ ] **Step 3: Rewrite `src/ui/results.ts`**

```ts
import type { AccountStats } from '../api/types';
import { formatTime } from '../core/score';
import { averageSeconds, type Stats } from '../store/stats';
import { el } from './dom';

/** The three numbers under the badge: this device's, or (signed in) the account's (spec 2026-10-08 §6.2). */
export interface StatsView {
  solved: number;
  averageSeconds: number;
  streak: number;
}

export const deviceStatsView = (s: Stats): StatsView => ({ solved: s.solved, averageSeconds: averageSeconds(s), streak: s.streak });

export const accountStatsView = (a: AccountStats): StatsView => ({
  solved: a.solved,
  averageSeconds: a.averageMs === null ? 0 : Math.round(a.averageMs / 1000),
  streak: a.streak,
});

export interface ResultsData {
  seconds: number;
  score: number;
  newBest: boolean;
  /** This device's stats: the badge's best. */
  stats: Stats;
  /** Solved, Average and Day streak as shown. */
  view: StatsView;
}

export class Results {
  private readonly root = el('results');

  constructor(h: { onNew(): void; onShare(): void; onKeep(): void }) {
    el('r-new').addEventListener('click', h.onNew);
    el('r-share').addEventListener('click', h.onShare);
    el('r-keep').addEventListener('click', h.onKeep);
  }

  show(d: ResultsData): void {
    el('r-time').textContent = `Lit in ${formatTime(d.seconds)}`;
    el('r-score').textContent = `Score ${d.score.toLocaleString('en-US')}`;
    const badge = el('r-badge');
    badge.textContent = d.newBest || d.stats.bestSeconds === null ? 'New best' : `Best ${formatTime(d.stats.bestSeconds)}`;
    badge.classList.toggle('quiet', !d.newBest);
    this.setStats(d.view);
    this.root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('show')));
  }

  /** Repaints Solved, Average and Day streak: also while the tag is hidden, so it is right when it appears. */
  setStats(v: StatsView): void {
    el('r-solved').textContent = String(Number(v.solved));
    el('r-avg').textContent = formatTime(Number(v.averageSeconds));
    el('r-streak').textContent = String(Number(v.streak));
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
  }
}
```

- [ ] **Step 4: The totals row and the Imported pill**

In `src/ui/board-sheets.ts`, change the type import to

```ts
import type { AccountStats, BoardResponse, BoardRow, MyGamesResponse, RecentGame, User } from '../api/types';
```

replace the first line of `gameHtml` with

```ts
  const [cls, label] = g.isBest
    ? ['s-best', g.imported ? 'Personal best · Imported' : 'Personal best']
    : g.imported
      ? ['s-imported', 'Imported']
      : g.ranked
        ? ['s-counted', 'Ranked']
        : ['', unrankedLabel(g.reason)];
```

add above `gamesBody`:

```ts
/** The account's totals (GET /api/me/stats), the same on every device; dashes until they arrive. */
function totalsHtml(s: Loadable<AccountStats>): string {
  const d = s.status === 'ready' ? s.data : null;
  const cell = (value: string, label: string): string => `<div><b>${value}</b><span>${label}</span></div>`;
  return `<div class="acct-totals">${cell(d ? Number(d.solved).toLocaleString('en-US') : '–', 'Solved')}${cell(
    d && d.averageMs !== null ? formatMs(Number(d.averageMs)) : '–',
    'Average',
  )}${cell(d ? String(Number(d.streak)) : '–', 'Day streak')}${cell(d ? String(Number(d.longestStreak)) : '–', 'Longest')}</div>`;
}
```

change `gamesBody`'s signature to

```ts
function gamesBody(g: Loadable<MyGamesResponse>, user: User | null | undefined, now: number, s: Loadable<AccountStats>): string {
```

and its last line to

```ts
  return `${stats}${totalsHtml(s)}<h3 class="acct-h3">Recent games</h3>${list}${links}`;
```

Change `listView`'s signature to

```ts
export function listView(
  tab: ListTab,
  board: Loadable<BoardResponse>,
  games: Loadable<MyGamesResponse>,
  user: User | null | undefined,
  now: number,
  stats: Loadable<AccountStats> = { status: 'loading' },
): SheetView {
```

and its body's `gamesBody(games, user, now)` to `gamesBody(games, user, now, stats)`.

In `src/ui/account.css`, after the `.acct-stats span` rule, add:

```css
.acct-totals { display: grid; grid-template-columns: repeat(4, 1fr); text-align: center; padding: 10px 0 12px; margin: 0 0 6px; border-bottom: 1px solid rgba(236, 196, 116, 0.14); }
.acct-totals b { display: block; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; color: #fff3dc; }
.acct-totals span { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: #f0c977; opacity: 0.75; }
```

and after the `.acct-status.s-counted` rule:

```css
.acct-status.s-imported { background: rgba(170, 205, 255, 0.12); color: #d3e3f8; }
```

- [ ] **Step 5: Your games loads the stats**

In `src/ui/accounts.ts`:

- change the type import to `import type { AccountStats, BoardResponse, MyGamesResponse } from '../api/types';`
- add the field after `private games …`:

```ts
  private stats: Loadable<AccountStats> = { status: 'loading' };
```

- in `openGames`, replace `void this.loadGames();` with `this.loadTab();`
- `listNow()` returns `listView(this.tab, this.board, this.games, this.session.current, Date.now(), this.stats);`
- add after `loadGames()`:

```ts
  /** Your games' totals: the account's stats (spec 2026-10-08 §6.3). */
  private async loadStats(): Promise<void> {
    if (!this.session.current) return;
    try {
      this.stats = { status: 'ready', data: await api.myStats() };
    } catch {
      if (this.stats.status !== 'ready') this.stats = { status: 'error' };
    }
    this.refreshList();
  }

  /** The open tab's data: the board, or your games and their totals. */
  private loadTab(): void {
    if (this.tab === 'board') void this.loadBoard();
    else {
      void this.loadGames();
      void this.loadStats();
    }
  }
```

- in `onSession`, after `this.games = { status: 'loading' };` add `this.stats = { status: 'loading' };`
- in `act`, the `'tab-board' | 'tab-games'` case's `void (this.tab === 'board' ? this.loadBoard() : this.loadGames());` and the `'reload'` case's identical line both become `this.loadTab();`

- [ ] **Step 6: The App shows the account's numbers when signed in**

In `src/app.ts`:

- change `import { Results } from './ui/results';` to `import { accountStatsView, deviceStatsView, Results, type StatsView } from './ui/results';`
- add fields after `private returning = false;`:

```ts
  /** The account's Solved, Average and Day streak for the solved tree on the tag (spec 2026-10-08 §6.2); null: the device's. */
  private accountStats: StatsView | null = null;
  /** Bumped by each syncStats and each new tree, so an older answer never paints over a newer one. */
  private statsSeq = 0;
```

- in `beginGame`, after `this.returning = false;` add:

```ts
    this.accountStats = null;
    this.statsSeq++;
```

- in `presentWin`, the `this.results.show(…)` call becomes:

```ts
      this.results.show({ seconds: won.seconds, score: won.score, newBest: won.newBest, stats: this.stats, view: this.accountStats ?? deviceStatsView(this.stats) });
```

- in `restoreWin`, replace `if (won.result) this.setOutcome({ kind: 'done', result: won.result });` and its `else` line with:

```ts
    if (won.result) {
      this.setOutcome({ kind: 'done', result: won.result });
      void this.syncStats();
    } else void this.sendFinish();
```

- in `sendFinish`, after `this.setOutcome({ kind: 'done', result });` add `void this.syncStats();`
- in `onClaimed`, after `this.setOutcome({ kind: 'done', result: r });` add `void this.syncStats();`
- in `accountChanged`, after `this.setOutcome(this.outcome);` add `void this.syncStats();`
- add after `accountChanged()`:

```ts
  /**
   * The results tag's Solved, Average and Day streak: the account's when signed in (the same on every device), this
   * device's while they load, offline, or signed out. The device keeps recording its own either way.
   */
  private async syncStats(): Promise<void> {
    const seq = ++this.statsSeq;
    if (!this.won || !this.session.current) {
      this.accountStats = null;
      this.results.setStats(deviceStatsView(this.stats));
      return;
    }
    try {
      const a = await api.myStats();
      if (seq !== this.statsSeq) return;
      this.accountStats = accountStatsView(a);
      this.results.setStats(this.accountStats);
    } catch {
      // offline, or signed out meanwhile: the device's numbers stay
    }
  }
```

- [ ] **Step 7: Run the unit tests and typecheck**

Run: `npx vitest run tests/unit/ui && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Write the e2e test**

Append to `tests/e2e/accounts.spec.ts` (it runs on desktop and phone):

```ts
test("signed in, the results tag and Your games show the account's stats, not this device's", async ({ page }) => {
  const player = await asPlayer(page);
  // This device has a history of its own: 7 solved and a 10-day streak up to yesterday.
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.stats')) return;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 7, totalSeconds: 700, bestSeconds: 60, bestScore: 44000, streak: 10, longestStreak: 10, lastSolvedDay: yesterday }));
  });
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  // The account's numbers (this one game), not the device's (8 solved, an 11-day streak).
  await expect(results.locator('#r-solved')).toHaveText('1');
  await expect(results.locator('#r-streak')).toHaveText('1');
  // The device still records its own.
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.stats') ?? '{}') as { solved?: number }).solved)).toBe(8);

  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Leaderboard' }).getByRole('tab', { name: 'Your games' }).click();
  const games = page.getByRole('dialog', { name: 'Your games' });
  await expect(games.locator('.acct-totals span')).toHaveText(['Solved', 'Average', 'Day streak', 'Longest']);
  await expect(games.locator('.acct-totals b').first()).toHaveText('1');
});
```

- [ ] **Step 9: Run the e2e test**

Run: `npx playwright test tests/e2e/accounts.spec.ts -g "account's stats"`
Expected: PASS on desktop and phone.

- [ ] **Step 10: Run the existing results-tag e2e tests too**

Run: `npx playwright test tests/e2e/smoke.spec.ts tests/e2e/online.spec.ts`
Expected: PASS (signed out, the tag still shows the device's numbers, e.g. "a save made during the final turn resumes as a win" expects `#r-solved` = 1).

- [ ] **Step 11: Commit**

```bash
git add src/ui/results.ts src/app.ts src/ui/board-sheets.ts src/ui/accounts.ts src/ui/account.css tests/unit/ui/results.test.ts tests/unit/ui/board-sheets.test.ts tests/e2e/accounts.spec.ts
git commit -m "feat(app): account stats on the results tag and in Your games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The admin's "Import this device's history" card; README and spec notes

**Files:**
- Create: `src/admin/dom.ts`, `src/admin/history.ts`, `src/admin/history-card.ts`
- Modify: `src/admin/main.ts:29-41` (the `h` helper moves out) and `render()`, `src/admin/api.ts`, `src/admin/admin.css`, `README.md`, `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md` (one non-goal line)
- Test: `tests/unit/admin/history.test.ts` (new), `tests/e2e/admin.spec.ts` (one test added)

**Interfaces:**
- Consumes: `ImportRequest`, `ImportResponse`, `AccountStats`, the shared constants (Tasks 1–3); `loadStats`, `localDay`, `Stats` (`src/store/stats.ts`); `readJSON`, `writeJSON` (`src/store/storage.ts`); `formatTime` (`src/core/score.ts`); `formatMs` (`src/ui/format.ts`); the admin's `ApiError`, `call` (`src/admin/api.ts`) and `authLost` (`src/admin/main.ts`).
- Produces:
  - `src/admin/dom.ts`: `type Props<K>`; `h(tag, props?, ...kids)` (moved verbatim from `main.ts`).
  - `src/admin/history.ts`: `interface ImportFields { solved; best; average; streak; longest; lastDay }` (strings); `interface ImportDefaults { fields: ImportFields; averageMs: number }`; `parseClock(text: string): number | null`; `importDefaults(s: Stats): ImportDefaults | null`; `importRequest(f: ImportFields, d: ImportDefaults, importId: string, tz: number, today: string): ImportRequest | string`; `interface ImportMark { v: 1; importId: string; done: boolean; added: number }`; `readMark(): ImportMark | null`; `pendingMark(newId?: () => string): ImportMark`; `markDone(m: ImportMark, added: number): ImportMark`; `newImportId(): string`.
  - `src/admin/history-card.ts`: `interface HistoryCardHooks { authLost(e: ApiError): void }`; `historyCard(hooks: HistoryCardHooks): HTMLElement`.
  - `src/admin/api.ts`: `api.stats(now: Date): Promise<AccountStats>`; `api.importHistory(body: ImportRequest): Promise<ImportResponse>`.

- [ ] **Step 1: Write the failing helper tests**

`tests/unit/admin/history.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { importDefaults, importRequest, markDone, newImportId, parseClock, pendingMark, readMark, type ImportDefaults } from '../../../src/admin/history';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';

const device: Stats = { v: 1, solved: 40, totalSeconds: 3140, bestSeconds: 41, bestScore: 45900, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07' };

describe('parseClock', () => {
  it('reads m:ss and m:ss.t, to the ms', () => {
    expect(parseClock('0:41')).toBe(41_000);
    expect(parseClock(' 1:18.5 ')).toBe(78_500);
    expect(parseClock('1:18.45')).toBe(78_450);
    expect(parseClock('51:40.0')).toBe(3_100_000);
    for (const bad of ['', '78', '1:7', '1:60', '1:18.', '1:18.1234', 'a:bc']) expect(parseClock(bad)).toBeNull();
  });
});

describe('importDefaults', () => {
  it("fills the form from this device's stats, keeping the exact average behind its text", () => {
    expect(importDefaults(device)).toEqual({ averageMs: 78_500, fields: { solved: '40', best: '0:41', average: '1:18.5', streak: '3', longest: '5', lastDay: '2026-10-07' } });
  });
  it('none without a solved game', () => {
    expect(importDefaults(EMPTY_STATS)).toBeNull();
  });
});

describe('importRequest', () => {
  const d = importDefaults(device) as ImportDefaults;
  const req = (over: Partial<ImportDefaults['fields']> = {}) => importRequest({ ...d.fields, ...over }, d, 'AbCdEfGhIjKlMnOpQrStUv', 420, '2026-10-08');

  it('sends the numbers, with the exact average while its text is untouched', () => {
    expect(req()).toEqual({ importId: 'AbCdEfGhIjKlMnOpQrStUv', solved: 40, bestSeconds: 41, averageMs: 78_500, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07', tz: 420 });
    expect(req({ solved: '35' })).toMatchObject({ solved: 35, averageMs: 78_500 });
    expect(req({ average: '1:20.25' })).toMatchObject({ averageMs: 80_250 });
    expect(req({ solved: '1' })).toMatchObject({ solved: 1, averageMs: 41_000 }); // one game: its time is the average
  });

  it.each([
    [{ solved: '0' }, 'Games solved'],
    [{ solved: '2001' }, 'Games solved'],
    [{ solved: '3.5' }, 'Games solved'],
    [{ best: '0:04' }, 'Best time'],
    [{ best: '0:41.5' }, 'Best time'],
    [{ best: '61:00' }, 'Best time'],
    [{ average: 'soon' }, 'Average time'],
    [{ average: '0:40.0' }, "can't be faster"],
    [{ streak: '0' }, 'Streaks'],
    [{ streak: '6' }, 'Streaks'],
    [{ lastDay: '2026-09-28' }, 'Last solved day'],
    [{ lastDay: '2026-10-09' }, 'Last solved day'],
  ])('refuses %o', (over, text) => {
    const r = req(over);
    expect(typeof r).toBe('string');
    expect(r).toContain(text);
  });
});

describe('the import mark', () => {
  beforeEach(() => localStorage.clear());

  it('keeps one id per device from before the first send, until it is done', () => {
    expect(readMark()).toBeNull();
    const m = pendingMark(() => 'AbCdEfGhIjKlMnOpQrStUv');
    expect(m).toEqual({ v: 1, importId: 'AbCdEfGhIjKlMnOpQrStUv', done: false, added: 0 });
    expect(pendingMark(() => 'ZyXwVuTsRqPoNmLkJiHgFe')).toEqual(m); // a resend reuses it
    markDone(m, 40);
    expect(readMark()).toEqual({ ...m, done: true, added: 40 });
  });

  it('new ids are 22 URL-safe characters', () => {
    expect(newImportId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newImportId()).not.toBe(newImportId());
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/admin/history.test.ts`
Expected: FAIL: cannot find `src/admin/history`.

- [ ] **Step 3: Write `src/admin/history.ts`**

```ts
import { HISTORY_FIRST_DAY, MAX_IMPORT_MS, MAX_IMPORT_RUNS, MAX_STREAK_DAYS, MIN_IMPORT_BEST_SECONDS, type ImportRequest } from '../api/types.js';
import { formatTime } from '../core/score.js';
import type { Stats } from '../store/stats.js';
import { readJSON, writeJSON } from '../store/storage.js';
import { formatMs } from '../ui/format.js';

/** The import card's fields as typed (spec 2026-10-08 §6.1). */
export interface ImportFields {
  solved: string;
  best: string;
  average: string;
  streak: string;
  longest: string;
  lastDay: string;
}

/** What this device's stats suggest, and the exact average behind the rounded text. */
export interface ImportDefaults {
  fields: ImportFields;
  averageMs: number;
}

const CLOCK = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/;
const WHOLE = /^\d{1,6}$/;

/** "m:ss" or "m:ss.t" (up to milliseconds) → ms; null for anything else. */
export function parseClock(text: string): number | null {
  const m = CLOCK.exec(text.trim());
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] ?? '').padEnd(3, '0'));
}

/** The form as this device's stats fill it, or null when this browser has no solved game to import. */
export function importDefaults(s: Stats): ImportDefaults | null {
  if (s.solved < 1 || s.bestSeconds === null || s.lastSolvedDay === null) return null;
  const averageMs = Math.round((s.totalSeconds * 1000) / s.solved);
  return {
    averageMs,
    fields: {
      solved: String(s.solved),
      best: formatTime(s.bestSeconds),
      average: formatMs(averageMs),
      streak: String(Math.max(1, s.streak)),
      longest: String(Math.max(1, s.longestStreak, s.streak)),
      lastDay: s.lastSolvedDay,
    },
  };
}

const whole = (text: string): number => (WHOLE.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** The request the card sends, or what is wrong with the form (the server checks it all again). */
export function importRequest(f: ImportFields, d: ImportDefaults, importId: string, tz: number, today: string): ImportRequest | string {
  const solved = whole(f.solved);
  if (!(solved >= 1 && solved <= MAX_IMPORT_RUNS)) return 'Games solved must be a whole number from 1 to 2,000.';
  const bestMs = parseClock(f.best);
  if (bestMs === null || bestMs % 1000 !== 0 || bestMs < MIN_IMPORT_BEST_SECONDS * 1000 || bestMs > MAX_IMPORT_MS) return 'Best time must be m:ss, from 0:05 to 60:00.';
  // One game: its time is the average. Otherwise the typed average, or the exact one behind untouched text.
  const averageMs = solved === 1 ? bestMs : f.average.trim() === d.fields.average ? d.averageMs : parseClock(f.average);
  if (averageMs === null || averageMs > MAX_IMPORT_MS) return 'Average time must be m:ss.t, at most 60:00.';
  if (averageMs < bestMs) return "Average time can't be faster than the best time.";
  const streak = whole(f.streak);
  const longest = whole(f.longest);
  if (!(streak >= 1 && longest >= streak && longest <= MAX_STREAK_DAYS)) return 'Streaks are whole days from 1, and the longest is at least the current one.';
  const lastDay = f.lastDay.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || lastDay < HISTORY_FIRST_DAY || lastDay > today) return 'Last solved day must be a date from 2026-09-29 to today.';
  return { importId, solved, bestSeconds: bestMs / 1000, averageMs, streak, longestStreak: longest, lastSolvedDay: lastDay, tz };
}

const MARK_KEY = 'aglow.historyImport';

/** This device's import: the id is made and saved before the first send, so a resend can never add the runs twice. */
export interface ImportMark {
  v: 1;
  importId: string;
  done: boolean;
  added: number;
}

const isMark = (v: unknown): v is ImportMark => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.v === 1 && typeof o.importId === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(o.importId) && typeof o.done === 'boolean' && Number.isInteger(o.added) && (o.added as number) >= 0;
};

export const readMark = (): ImportMark | null => readJSON(MARK_KEY, isMark);

/** 16 random bytes, base64url: 22 characters. */
export function newImportId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The mark to send with: this device's own, or a new one, saved before the request goes out. */
export function pendingMark(newId: () => string = newImportId): ImportMark {
  const kept = readMark();
  if (kept) return kept;
  const fresh: ImportMark = { v: 1, importId: newId(), done: false, added: 0 };
  writeJSON(MARK_KEY, fresh);
  return fresh;
}

export function markDone(m: ImportMark, added: number): ImportMark {
  const done: ImportMark = { ...m, done: true, added };
  writeJSON(MARK_KEY, done);
  return done;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/admin/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Move `h()` to `src/admin/dom.ts`**

Create `src/admin/dom.ts` with the block now at `src/admin/main.ts:29-41`, exported:

```ts
export type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'children'>> & {
  class?: string;
  attrs?: Record<string, string>;
};

/** An element with properties, attributes and children: how the admin page builds its DOM (never innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, attrs, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
```

Delete that block from `src/admin/main.ts` and add to its imports:

```ts
import { h } from './dom.js';
import { historyCard } from './history-card.js';
```

- [ ] **Step 6: Add the two admin calls**

In `src/admin/api.ts`, add imports:

```ts
import type { AccountStats, ImportRequest, ImportResponse } from '../api/types.js';
import { localDay } from '../store/stats.js';
```

and add to `api` after `save`:

```ts
  /** The signed-in account's stats (GET /api/me/stats): the history card's played and imported counts. */
  stats: (now: Date) => call<AccountStats>('GET', `/api/me/stats?today=${localDay(now)}&tz=${now.getTimezoneOffset()}`),
  /** POST /api/admin/import: this device's history becomes runs on the admin's own account. */
  importHistory: (body: ImportRequest) => call<ImportResponse>('POST', '/api/admin/import', body),
```

- [ ] **Step 7: Write the card**

`src/admin/history-card.ts`:

```ts
import { HISTORY_FIRST_DAY, type AccountStats } from '../api/types.js';
import { loadStats, localDay } from '../store/stats.js';
import { ApiError, api } from './api.js';
import { h } from './dom.js';
import { importDefaults, importRequest, markDone, pendingMark, readMark, type ImportFields, type ImportMark } from './history.js';

const plural = (n: number, one: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;
const isAuthLost = (e: unknown): e is ApiError => e instanceof ApiError && (e.status === 401 || e.status === 403);

export interface HistoryCardHooks {
  /** A 401 or 403 from the import: the page's sign-in or Not authorized card. */
  authLost(e: ApiError): void;
}

/**
 * "Import this device's history" (spec 2026-10-08 §6.1): this browser's pre-accounts stats become runs on the admin's
 * own account, once per device. Built once and kept across the editor's renders: it holds its own state.
 */
export function historyCard(hooks: HistoryCardHooks): HTMLElement {
  const section = h(
    'section',
    { class: 'history', attrs: { 'aria-labelledby': 'history-title' } },
    h('h2', { id: 'history-title', textContent: "Import this device's history" }),
    h('p', { class: 'note', textContent: "Adds this browser's saved games to your account as runs, so they count on the leaderboard and in your stats. Do it once per device." }),
  );
  const defaults = importDefaults(loadStats());
  if (!defaults) {
    section.append(h('p', { class: 'note', textContent: 'This browser has no saved games to import.' }));
    return section;
  }

  const inputs = {} as Record<keyof ImportFields, HTMLInputElement>;
  const field = (key: keyof ImportFields, label: string, mode: 'numeric' | 'text' = 'text', type: 'text' | 'date' = 'text'): HTMLLabelElement => {
    const input = h('input', { type, name: key, value: defaults.fields[key], attrs: { autocomplete: 'off', inputmode: mode } });
    inputs[key] = input;
    return h('label', {}, h('span', { textContent: label }), input);
  };
  const account = h('p', { class: 'note', textContent: 'Checking your account…' });
  const button = h('button', { class: 'primary', type: 'submit' });
  const err = h('p', { class: 'err', attrs: { role: 'alert' } });
  const status = h('p', { class: 'done', attrs: { role: 'status' } });
  const form = h(
    'form',
    { class: 'history-form' },
    h(
      'div',
      { class: 'grid' },
      field('solved', 'Games solved', 'numeric'),
      field('best', 'Best time (m:ss)'),
      field('average', 'Average time (m:ss.t)'),
      field('streak', 'Current streak (days)', 'numeric'),
      field('longest', 'Longest streak (days)', 'numeric'),
      field('lastDay', 'Last solved day', 'text', 'date'),
    ),
    h('div', { class: 'row' }, button),
    err,
    status,
  );
  inputs.lastDay.min = HISTORY_FIRST_DAY;
  inputs.lastDay.max = localDay(new Date());
  section.append(account, form);

  let mark: ImportMark | null = readMark();
  let sending = false;
  const values = (): ImportFields => ({
    solved: inputs.solved.value,
    best: inputs.best.value,
    average: inputs.average.value,
    streak: inputs.streak.value,
    longest: inputs.longest.value,
    lastDay: inputs.lastDay.value,
  });
  const runs = (): number => {
    const n = Number(inputs.solved.value.trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  };

  function paint(): void {
    const done = mark?.done === true;
    for (const input of Object.values(inputs)) input.disabled = done || sending;
    button.disabled = done || sending;
    button.textContent = done ? 'Imported' : sending ? 'Importing…' : `Import ${plural(runs(), 'run')}`;
    if (done && !status.textContent) status.textContent = `This device's history was imported${mark?.added ? ` (${plural(mark.added, 'run')})` : ''}.`;
  }

  async function loadAccount(): Promise<void> {
    try {
      const s: AccountStats = await api.stats(new Date());
      account.textContent = `Your account already has ${plural(s.solved - s.imported, 'played game')}${s.imported ? ` and ${plural(s.imported, 'imported run')}` : ''}. This device's total includes any games you played here since accounts launched: subtract them from Games solved so they aren't counted twice.`;
    } catch {
      // Only the import itself hands a 401 or 403 to the page: this line is a hint, never a reason to leave the editor.
      account.textContent = "Couldn't load your account's games. The import still works.";
    }
  }

  async function send(): Promise<void> {
    if (sending || mark?.done || !defaults) return;
    err.textContent = '';
    const now = new Date();
    const checked = importRequest(values(), defaults, '', now.getTimezoneOffset(), localDay(now));
    if (typeof checked === 'string') {
      err.textContent = checked;
      return;
    }
    // The id is saved before the request goes out: a resend after a lost answer can't add the runs twice.
    const pending = pendingMark();
    mark = pending;
    sending = true;
    paint();
    try {
      const r = await api.importHistory({ ...checked, importId: pending.importId });
      mark = markDone(pending, r.added);
      status.textContent = r.already ? "This device's history was already imported." : `Imported ${plural(r.added, 'run')} from this device.`;
      if (r.clamped) status.textContent += ` The streaks didn't fit between Sep 29 and the last solved day, so they were placed as ${r.streak} and ${r.longestStreak} days.`;
      void loadAccount();
    } catch (e) {
      if (isAuthLost(e)) hooks.authLost(e);
      else err.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
      paint();
    }
  }

  inputs.solved.addEventListener('input', paint);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send();
  });
  paint();
  void loadAccount();
  return section;
}
```

- [ ] **Step 8: Put the card on the editor, and style it**

In `src/admin/main.ts`, after `const rows = new Map<…>();` (the persistent elements), add:

```ts
/** "Import this device's history": built on the first editor render, then kept (it holds its own state). */
let historyPanel: HTMLElement | null = null;
```

and in `render()`, replace

```ts
  const main = h('main', {}, s ? stationEditor(s) : h('p', { class: 'empty', textContent: 'Create a station to start uploading music.' }), uploadsPanel);
```

with

```ts
  historyPanel ??= historyCard({ authLost });
  const main = h('main', {}, s ? stationEditor(s) : h('p', { class: 'empty', textContent: 'Create a station to start uploading music.' }), uploadsPanel, historyPanel);
```

Append to `src/admin/admin.css`:

```css
/* Import this device's history (spec 2026-10-08 §6.1) */
.history { margin-top: 28px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); display: grid; gap: 10px; }
.history h2 { font-size: 15px; }
.history .note { margin: 0; }
.history .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.history label { display: grid; gap: 4px; font-size: 12px; color: var(--dim); }
.history .row { display: flex; gap: 8px; margin-top: 4px; }
.history .done { margin: 0; }
.history .done:empty { display: none; }
```

- [ ] **Step 9: Typecheck, unit tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. (The existing e2e "the game bundle has no admin code" still holds: the card is in the admin bundle only.)

- [ ] **Step 10: Write the e2e test**

Append to `tests/e2e/admin.spec.ts`:

```ts
// The real Worker, nothing routed: the admin imports this device's history (fake Google). The times are slow on purpose
// (50 minutes) so the shared e2e board's top runs, which other tests check, don't change.
test("the admin imports this device's history once", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop only');
  await context.addCookies([{ name: 'aglow_fake_as', value: 'admin@example.com', url: 'http://localhost:4173' }]);
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.stats')) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 3, totalSeconds: 9300, bestSeconds: 3000, bestScore: -250000, streak: 1, longestStreak: 2, lastSolvedDay: today }));
  });
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  const card = page.getByRole('region', { name: "Import this device's history" });
  await expect(card.getByLabel('Games solved')).toHaveValue('3');
  await expect(card.getByLabel('Best time (m:ss)')).toHaveValue('50:00');
  await expect(card.getByLabel('Average time (m:ss.t)')).toHaveValue('51:40.0');
  await expect(card.getByLabel('Current streak (days)')).toHaveValue('1');
  await expect(card.getByLabel('Longest streak (days)')).toHaveValue('2');
  await expect(card).toContainText(/Your account already has [\d,]+ played games?/);

  await card.getByRole('button', { name: 'Import 3 runs' }).click();
  await expect(card.getByRole('status')).toHaveText('Imported 3 runs from this device.');
  await expect(card.getByRole('button', { name: 'Imported' })).toBeDisabled();

  // The account has them: ranked, marked imported, the best exactly 50:00.
  const stats = await page.evaluate(async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (await (await fetch(`/api/me/stats?today=${today}&tz=${d.getTimezoneOffset()}`)).json()) as { imported: number };
  });
  expect(stats.imported).toBeGreaterThanOrEqual(3);
  const mine = (await (await page.request.get('/api/me/games')).json()) as { games: { imported: boolean; ms: number }[] };
  const fromDevice = mine.games.filter((g) => g.imported);
  expect(fromDevice.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...fromDevice.map((g) => g.ms))).toBe(3_000_000);

  // This device stays marked as imported.
  await page.reload();
  await expect(card.getByRole('button', { name: 'Imported' })).toBeDisabled();
  await expect(card.getByRole('status')).toHaveText("This device's history was imported (3 runs).");
});
```

- [ ] **Step 11: Run the admin e2e tests**

Run: `npx playwright test tests/e2e/admin.spec.ts --project=desktop`
Expected: PASS, including the existing admin tests. Their fresh browsers have no `aglow.stats`, so the card only says "This browser has no saved games to import." and calls nothing; and even with stats, a failed `/api/me/stats` only changes the card's account line (never the page).

- [ ] **Step 12: Document it in the README**

In `README.md`, insert before `### Moderation`:

```md
### History import and account stats

Spec: `docs/superpowers/specs/2026-10-08-aglow-history-import-design.md`.

- **Account stats:** signed in, the results tag's Solved, Average and Day streak and the Your games totals come from `GET /api/me/stats` (every finished game on the account, imported ones included; streaks in the player's time zone), so they match on every device. Signed out or offline, the device's own `aglow.stats` shows, and it keeps recording either way.
- **Import (admin only):** `/admin` → "Import this device's history" reads this browser's `aglow.stats`. Check the numbers (subtract games played on this device since accounts launched, as the card suggests), then import. The Worker fabricates that many runs for your own account (`worker/lib/history.ts`: exactly the best, exactly the total, the streaks, dated from 2026-09-29) and stores them as ordinary ranked games with `source = 'import'`. Once per device: the browser keeps `aglow.historyImport`, and resending the same import adds nothing.
- **Undo an import:** find your user id with `npx wrangler d1 execute aglow --remote --command "SELECT id, name FROM users WHERE email = '<your email>'"`, then `npx wrangler d1 execute aglow --remote --command "DELETE FROM games WHERE source = 'import' AND user_id = <id>"`. To import again from that browser, remove `aglow.historyImport` from its localStorage (DevTools, Application).
```

In the `### Moderation` list, change the first bullet's command to include the source:

```md
- **List the board,** with what each run's log says about it: `npx wrangler d1 execute aglow --remote --command "SELECT g.id, u.id AS user_id, u.name, g.ms, g.source, g.paused_ms, g.pauses, json_array_length(g.log) AS entries FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 ORDER BY g.ms LIMIT 50"`. Imported runs (`source = 'import'`) have no log.
```

In `### Watch in December`, add a bullet:

```md
- **D1 rows written:** a 2,000-run import writes about 8,000 rows (each run and its three index entries); the Free plan allows 100,000 a day.
```

- [ ] **Step 13: Note the superseded non-goal in the accounts spec**

In `docs/superpowers/specs/2026-10-07-aglow-accounts-design.md`, change the non-goal line

```md
- Importing pre-accounts local stats. The existing `aglow.stats` stays as it is, local only.
```

to

```md
- Importing pre-accounts local stats. The existing `aglow.stats` stays as it is, local only. (Superseded on 2026-10-08 for the admin's own devices: `2026-10-08-aglow-history-import-design.md`.)
```

- [ ] **Step 14: Run everything**

Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: PASS (desktop and phone projects).

- [ ] **Step 15: Commit**

```bash
git add src/admin/dom.ts src/admin/history.ts src/admin/history-card.ts src/admin/main.ts src/admin/api.ts src/admin/admin.css tests/unit/admin/history.test.ts tests/e2e/admin.spec.ts README.md docs/superpowers/specs/2026-10-07-aglow-accounts-design.md
git commit -m "feat(admin): Import this device's history card; history import docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rollout (controller and Luke only: not a subagent task)

After the final whole-branch review and the merge to `main` (never pushed by a subagent):

1. **Deploy (Luke).** `npm run deploy`: the deploy guard, typecheck, tests and build, then `wrangler d1 migrations apply aglow --remote` (it lists `0002_history_import.sql` and asks to confirm), then `wrangler deploy`.
2. **Secrets check (controller).** `npx wrangler secret list` still shows `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAILS` (names only).
3. **Smoke test (controller).** Signed out, `GET /api/me/stats?today=2026-10-08&tz=420` → 401 and `POST /api/admin/import` → 403 without a same-origin `Origin` (401 with one). Luke signed in: the results tag after a win shows the account's Solved.
4. **Import (Luke).** On each of his devices, open `/admin`, check the card's numbers (subtract the games played there since accounts launched, as the account line says), and import once. Undo per the README if anything looks wrong.
