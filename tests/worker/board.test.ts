import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_TOP, type BoardResponse, type MyGamesResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { BOARD_CACHE_WINDOWS, BOARD_TTL_MS, boardGrew, cachedTopAndTotal, cachedTotal, resetBoardCache } from '../../worker/lib/board-cache';
import { DAILY_BEST_SQL, DAILY_FIRST_SQL, DAILY_RANK_SQL, DAILY_TOP_SQL, DAILY_TOTAL_SQL } from '../../worker/lib/daily-board';
import { dayNumber } from '../../worker/lib/days';
import { BEST_SQL, TOP_SQL, topSql, totalSql } from '../../worker/lib/ranks';
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
    .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason) VALUES (?, ?, 1, 1, ?, ?, ?, 0, 0, ?, ?)')
    .bind(id, userId, finishedAt - ms, finishedAt, ms, reason === null ? 1 : 0, reason)
    .run();
  return id;
}
const board = async (cookie?: string): Promise<BoardResponse> => (await (await call(env, 'GET', '/api/board', { cookie })).json()) as BoardResponse;
const myGames = async (cookie?: string): Promise<MyGamesResponse> => (await (await call(env, 'GET', '/api/me/games', { cookie })).json()) as MyGamesResponse;

describe('the leaderboard', () => {
  it('is empty at first, with a short private cache', async () => {
    const res = await call(env, 'GET', '/api/board');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
    // The browser may keep it (src/api/client.ts), but never across a sign-in or sign-out.
    expect(res.headers.get('Vary')).toBe('Cookie');
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
          .prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, ranked) VALUES (?, ?, 1, 1, 0, ?, ?, 1)")
          .bind(`fast-${String(k).padStart(16, '0')}`, bo, 1000 + k, 10_000 + k),
      ),
    );
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 99_000, 5000);
    await run(ana, 98_000, 6000);
    const cookie = await signIn(env, 'ana@example.com');
    const b = await board(cookie);
    expect(b.rows).toHaveLength(BOARD_TOP);
    expect(b.rows.some((r) => r.mine)).toBe(false);
    expect(b.total).toBe(52);
    expect(b.you).toEqual({ rank: 51, name: 'Meridian', ms: 98_000, finishedAt: 6000, mine: true });
    await run(ana, 5_000, 7000);
    resetBoardCache(); // a run straight into D1 shows once the isolate's copy of the top 50 expires
    const again = await board(cookie);
    expect(again.rows[0]).toEqual({ rank: 1, name: 'Meridian', ms: 5_000, finishedAt: 7000, mine: true });
    expect(again.you).toBeNull();
  });

  it('reads the top 50 through the board index', async () => {
    expect(JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${TOP_SQL}`).all()).results)).toContain('games_board');
  });

  it('finds your best run through games_best, with no sort', async () => {
    const plan = JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${BEST_SQL}`).bind(1).all()).results);
    expect(plan).toContain('games_best');
    expect(plan).not.toContain('TEMP B-TREE');
  });

  it('a named player with no runs has nothing pinned', async () => {
    await user('ana@example.com', 'Meridian');
    await run(await user('bo@example.com', 'Comet'), 50_000, 1000);
    const b = await board(await signIn(env, 'ana@example.com'));
    expect(b.you).toBeNull();
    expect(b.rows.some((r) => r.mine)).toBe(false);
  });

  it('a pinned best shares the rank of the run it ties', async () => {
    const bo = await user('bo@example.com', 'Comet');
    await db.batch(
      Array.from({ length: 50 }, (_, k) =>
        db
          .prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, ranked) VALUES (?, ?, 1, 1, 0, ?, ?, 1)")
          .bind(`fast-${String(k).padStart(16, '0')}`, bo, 1000 + k, 10_000 + k),
      ),
    );
    // Two runs tie at (99_000, 5000) right after Bo's 50: both are 51st, and Ana's (outside the top 50) is the pinned one.
    const ana = await user('ana@example.com', 'Meridian');
    const cy = await user('cy@example.com', 'Nova');
    await run(cy, 99_000, 5000);
    await run(ana, 99_000, 5000);
    const b = await board(await signIn(env, 'ana@example.com'));
    expect(b.you).toMatchObject({ rank: 51, ms: 99_000, finishedAt: 5000, mine: true });
    expect(b.total).toBe(52);
  });

  it('exposes no email or sign-in id, on the board or in Your games', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 50_000, 1000);
    const cookie = await signIn(env, 'ana@example.com');
    for (const path of ['/api/board', '/api/me/games']) {
      const text = await (await call(env, 'GET', path, { cookie })).text();
      expect(text).not.toMatch(/email|"sub"|google_sub|example\.com|fake:/i);
    }
  });
});

/** Fifty fast runs by one player, finished from `at` on (one ms apart): enough to push anyone else's best below the list. */
async function fifty(userId: number, at: number): Promise<void> {
  await db.batch(
    Array.from({ length: 50 }, (_, k) =>
      db
        .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, ranked) VALUES (?, ?, 1, 1, 0, ?, ?, 1)')
        .bind(`fast-${String(k).padStart(16, '0')}`, userId, at + k, 10_000 + k),
    ),
  );
}
const windowed = async (q: string, cookie?: string): Promise<BoardResponse> => (await (await call(env, 'GET', `/api/board?${q}`, { cookie })).json()) as BoardResponse;
const msOf = (b: BoardResponse): number[] => b.rows.map((r) => r.ms);

/** The server's clock at noon UTC on `day` (a viewer's today is clamped to within a day of the server's). */
const serverOn = (day: string): void => void vi.setSystemTime(new Date(`${day}T12:00:00Z`));

describe('board windows: today, this week, all time (spec 2026-10-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    serverOn('2026-10-14');
  });
  afterEach(() => vi.useRealTimers());

  // 2026-10-14 is a Wednesday; its week starts Monday 2026-10-12.
  it("today and this week start at the viewer's local midnight and Monday, in a zone far from UTC", async () => {
    const ana = await user('ana@example.com', 'Meridian');
    // UTC+13 (getTimezoneOffset -780): Oct 14 starts at 11:00 UTC on Oct 13, and Monday Oct 12 at 11:00 UTC on Oct 11.
    const midnight = Date.UTC(2026, 9, 13, 11);
    const monday = Date.UTC(2026, 9, 11, 11);
    await run(ana, 10_000, midnight); // today, to the ms
    await run(ana, 20_000, midnight - 1); // yesterday: this week
    await run(ana, 30_000, monday); // this week's first ms
    await run(ana, 40_000, monday - 1); // last week: all time only
    const q = 'today=2026-10-14&tz=-780';
    const today = await windowed(`window=today&${q}`);
    expect([msOf(today), today.total]).toEqual([[10_000], 1]);
    const week = await windowed(`window=week&${q}`);
    expect([msOf(week), week.total]).toEqual([[10_000, 20_000, 30_000], 3]);
    const all = await windowed(`window=all&${q}`);
    expect([msOf(all), all.total]).toEqual([[10_000, 20_000, 30_000, 40_000], 4]);
    // The same instants in UTC: Oct 14 starts 13 hours later, so none of them is today, and Monday too, so the week
    // starts after the two runs on Oct 11.
    expect((await windowed('window=today&today=2026-10-14&tz=0')).total).toBe(0);
    expect(msOf(await windowed('window=week&today=2026-10-14&tz=0'))).toEqual([10_000, 20_000]);
    // Hawaii (600): Oct 13 there starts at 10:00 UTC, so the first two are both early on its today.
    expect(msOf(await windowed('window=today&today=2026-10-13&tz=600'))).toEqual([10_000, 20_000]);
  });

  it("on a Monday this week is today; on a Sunday it reaches back to the Monday before", async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 10_000, Date.UTC(2026, 9, 12)); // Monday's first ms
    await run(ana, 20_000, Date.UTC(2026, 9, 12) - 1); // Sunday's last
    serverOn('2026-10-12');
    const monday = await windowed('window=week&today=2026-10-12&tz=0');
    expect(msOf(monday)).toEqual([10_000]);
    expect(msOf(await windowed('window=today&today=2026-10-12&tz=0'))).toEqual([10_000]);
    serverOn('2026-10-18');
    expect(msOf(await windowed('window=week&today=2026-10-18&tz=0'))).toEqual([10_000]);
    serverOn('2026-10-11');
    expect(msOf(await windowed('window=week&today=2026-10-11&tz=0'))).toEqual([10_000, 20_000]);
  });

  it('ranks count only runs in the window; your pinned best is your best in the window, and null with none there', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const bo = await user('bo@example.com', 'Comet');
    const cy = await user('cy@example.com', 'Nova');
    const midnight = Date.UTC(2026, 9, 14);
    await run(ana, 1_000, midnight - 5 * 86_400_000); // last week: ana's all-time best, first on the board
    await run(bo, 9_000, midnight - 2 * 86_400_000); // Monday
    await fifty(bo, midnight + 1000);
    await run(ana, 99_000, midnight + 5000);
    await run(ana, 98_000, midnight + 6000); // ana's best today: below Bo's fifty
    await run(cy, 2_000, midnight - 5 * 86_400_000); // cy played last week only
    const anaCookie = await signIn(env, 'ana@example.com');
    const q = 'today=2026-10-14&tz=0';
    const today = await windowed(`window=today&${q}`, anaCookie);
    expect(today.total).toBe(52);
    expect(today.rows[0]).toMatchObject({ rank: 1, ms: 10_000, name: 'Comet' });
    expect(today.you).toEqual({ rank: 51, name: 'Meridian', ms: 98_000, finishedAt: midnight + 6000, mine: true });
    const week = await windowed(`window=week&${q}`, anaCookie);
    expect(week.total).toBe(53);
    expect(week.rows[0]).toMatchObject({ rank: 1, ms: 9_000, name: 'Comet' });
    expect(week.you).toMatchObject({ rank: 52, ms: 98_000 });
    const all = await windowed(`window=all&${q}`, anaCookie);
    expect(all.total).toBe(55);
    expect(all.rows[0]).toMatchObject({ rank: 1, ms: 1_000, mine: true });
    expect(all.you).toBeNull();
    // No run in the window: nothing pinned, nothing marked.
    const cyCookie = await signIn(env, 'cy@example.com');
    for (const w of ['today', 'week']) {
      const b = await windowed(`window=${w}&${q}`, cyCookie);
      expect(b.you).toBeNull();
      expect(b.rows.some((r) => r.mine)).toBe(false);
    }
    expect((await windowed(`window=all&${q}`, cyCookie)).rows[1]).toMatchObject({ ms: 2_000, mine: true });
  });

  it('with no window the board is all time, and all time needs no calendar (an odd one is ignored)', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 50_000, 1000);
    expect(await board()).toEqual(await windowed('window=all'));
    expect((await windowed('window=all&today=nonsense&tz=9999')).total).toBe(1);
    const res = await call(env, 'GET', '/api/board?window=all');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
    expect(res.headers.get('Vary')).toBe('Cookie');
  });

  it("400 'invalid' for today or this week without a real today and offset, and for an unknown window", async () => {
    for (const w of ['today', 'week']) {
      for (const q of ['', 'today=2026-10-14', 'tz=0', 'today=2026-02-30&tz=0', 'today=2026-10-14&tz=1.5', 'today=2026-10-14&tz=841']) {
        const res = await call(env, 'GET', `/api/board?window=${w}&${q}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid', message: 'today must be YYYY-MM-DD and tz whole minutes from -840 to 840.' });
      }
    }
    const odd = await call(env, 'GET', '/api/board?window=month&today=2026-10-14&tz=0');
    expect(odd.status).toBe(400);
    expect(await odd.json()).toEqual({ error: 'invalid', message: 'window must be daily, today, week or all.' });
  });

  it("a window's offset must be a whole quarter hour, and a day more than one from the server's is clamped to it: no window keys made up", async () => {
    // Every real viewer's local date is the server's UTC date, or one either side (UTC-12 to UTC+14).
    for (const ok of ['today=2026-10-13&tz=720', 'today=2026-10-15&tz=-840', 'today=2026-10-14&tz=-345', 'today=2026-10-14&tz=570']) {
      for (const w of ['today', 'week']) expect((await call(env, 'GET', `/api/board?window=${w}&${ok}`)).status).toBe(200);
    }
    for (const bad of ['today=2026-10-14&tz=7', 'today=2026-10-14&tz=-50', 'today=2026-10-14&tz=839', 'today=2020-01-01&tz=7']) {
      for (const w of ['today', 'week']) {
        const res = await call(env, 'GET', `/api/board?window=${w}&${bad}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid', message: 'tz must be a whole quarter hour.' });
      }
    }
    // A device whose clock is days off still sees a board: its day is clamped to the nearest of the server's day ±1.
    const ana = await user('ana@example.com', 'Meridian');
    const at = (day: string, hour: number): number => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
    await run(ana, 10_000, at('2026-10-13', 1)); // the server's yesterday (Tuesday)
    await run(ana, 20_000, at('2026-10-14', 1)); // the server's today (Wednesday)
    await run(ana, 30_000, at('2026-10-15', 1)); // the server's tomorrow (Thursday)
    for (const [far, near] of [['2026-10-12', '2026-10-13'], ['2025-10-14', '2026-10-13'], ['2026-10-16', '2026-10-15'], ['2027-03-01', '2026-10-15']]) {
      for (const w of ['today', 'week']) {
        const res = await call(env, 'GET', `/api/board?window=${w}&today=${far}&tz=0`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(await windowed(`window=${w}&today=${near}&tz=0`));
      }
    }
    // Clamped back, today is the server's yesterday on (all three); clamped forward, the server's tomorrow (one).
    expect(msOf(await windowed('window=today&today=2020-01-01&tz=0'))).toEqual([10_000, 20_000, 30_000]);
    expect(msOf(await windowed('window=today&today=2031-01-01&tz=0'))).toEqual([30_000]);
    // All time takes no calendar at all; Your games' stats keep their own rules (any real day, any whole minute).
    expect((await call(env, 'GET', '/api/board?window=all&today=2020-01-01&tz=7')).status).toBe(200);
    expect((await call(env, 'GET', '/api/me/stats?today=2020-01-01&tz=7', { cookie: await signIn(env, 'ana@example.com') })).status).toBe(200);
  });

  it("seeks a window's runs through games_recent (migration 0005); all time's plans are as before", async () => {
    const plan = async (sql: string, ...bind: number[]): Promise<string[]> =>
      (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...bind).all<{ detail: string }>()).results.map((r) => r.detail);
    const g = (p: string[]): string => p.find((d) => / g /.test(` ${d} `)) ?? '';
    expect(g(await plan(topSql(1), 1))).toMatch(/^SEARCH g USING INDEX games_recent \(finished_at>\?\)$/);
    expect(g(await plan(totalSql(1), 1))).toMatch(/^SEARCH g USING INDEX games_recent \(finished_at>\?\)$/);
    // All time: the top reads games_board in order, the count scans games_best (covering); neither touches games_recent.
    const top = await plan(TOP_SQL);
    expect(g(top)).toBe('SCAN g USING INDEX games_board');
    expect(top.join()).not.toContain('games_recent');
    const total = await plan(totalSql());
    expect(g(total)).toBe('SCAN g USING COVERING INDEX games_best');
    expect(total.join()).not.toContain('games_recent');
  });
});

let attempts = 0;
/**
 * A Daily attempt straight into D1: day `day`, started at `startedAt`, finished `ms` later with `reason` (null:
 * never finished). `past` marks a past day's tree.
 */
async function attempt(
  userId: number | null,
  day: string,
  startedAt: number,
  ms: number,
  reason: string | null = 'daily',
  { past = false, id }: { past?: boolean; id?: string } = {},
): Promise<string> {
  const gameId = id ?? `day-${String(++attempts).padStart(16, '0')}`;
  const done = reason !== null;
  await db
    .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, daily_day, daily_past) VALUES (?, ?, 1, 1, ?, ?, ?, 0, 0, 0, ?, ?, ?)')
    .bind(gameId, userId, startedAt, done ? startedAt + ms : null, done ? ms : null, reason, dayNumber(day), past ? 1 : 0)
    .run();
  return gameId;
}

describe('the Daily board (GET /api/board?window=daily)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    serverOn('2026-12-10');
  });
  afterEach(() => vi.useRealTimers());
  const daily = (today: string, cookie?: string) => windowed(`window=daily&today=${today}&tz=0`, cookie);
  const noon = Date.parse('2026-12-10T12:00:00Z');

  it("GET /api/board?window=daily ranks first attempts by ms, then finish; pins 'you' when outside the top", async () => {
    const ana = await user('ana@example.com', 'Meridian');
    const bo = await user('bo@example.com', 'Comet');
    const cy = await user('cy@example.com', 'Nova');
    const di = await user('di@example.com', 'Vega');
    const nameless = await user('ed@example.com', null);
    await attempt(ana, '2026-12-10', noon, 50_000);
    await attempt(ana, '2026-12-10', noon + 100_000, 10_000); // a second attempt: off the board
    await attempt(bo, '2026-12-10', noon + 1000, 40_000);
    await attempt(cy, '2026-12-10', noon + 2000, 50_000); // as fast as Ana's first, finished later
    await attempt(di, '2026-12-10', noon + 2000, 50_000); // tied with Cy on (ms, finish): they share a rank
    await attempt(nameless, '2026-12-10', noon, 1_000); // no name: off the board
    await attempt(null, '2026-12-10', noon, 1_000); // a guest's: off the board until claimed
    await attempt(bo, '2026-12-09', noon - 86_400_000, 5_000); // yesterday's board
    await attempt(cy, '2026-12-10', noon - 86_400_000, 2_000, 'past', { past: true }); // a past start of the day: never on the board, never the first attempt
    await run(ana, 1_000, noon); // a random run: the main board's
    const b = await daily('2026-12-10');
    expect(b.total).toBe(4);
    expect(b.rows).toEqual([
      { rank: 1, name: 'Comet', ms: 40_000, finishedAt: noon + 41_000, mine: false },
      { rank: 2, name: 'Meridian', ms: 50_000, finishedAt: noon + 50_000, mine: false },
      { rank: 3, name: 'Nova', ms: 50_000, finishedAt: noon + 52_000, mine: false },
      { rank: 3, name: 'Vega', ms: 50_000, finishedAt: noon + 52_000, mine: false },
    ]);
    expect((await daily('2026-12-09')).rows.map((r) => r.ms)).toEqual([5_000]);
    // The headers are the other windows'.
    const res = await call(env, 'GET', '/api/board?window=daily&today=2026-12-10&tz=0');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
    expect(res.headers.get('Vary')).toBe('Cookie');
    // Fifty faster first attempts push Ana's below the list: pinned with its place among first attempts.
    const fast = await Promise.all(Array.from({ length: 50 }, (_, k) => user(`p${k}@example.com`, `Player${k}`)));
    for (const [k, id] of fast.entries()) await attempt(id, '2026-12-10', noon + k, 30_000 + k);
    resetBoardCache(); // runs straight into D1 show once the isolate's copy of the day expires
    const anaCookie = await signIn(env, 'ana@example.com');
    const pinned = await daily('2026-12-10', anaCookie);
    expect(pinned.rows).toHaveLength(BOARD_TOP);
    expect(pinned.total).toBe(54);
    expect(pinned.rows.some((r) => r.mine)).toBe(false);
    expect(pinned.you).toEqual({ rank: 52, name: 'Meridian', ms: 50_000, finishedAt: noon + 50_000, mine: true });
    expect((await daily('2026-12-10', await signIn(env, 'bo@example.com'))).you).toMatchObject({ rank: 51, ms: 40_000 });
    // A run in the top: marked, nothing pinned.
    const top = await daily('2026-12-10', await signIn(env, 'p3@example.com'));
    expect(top.rows.filter((r) => r.mine).map((r) => r.ms)).toEqual([30_003]);
    expect(top.you).toBeNull();
    // A player whose first attempt was abandoned, or judged too fast, has nothing pinned.
    for (const [email, name, reason] of [['fy@example.com', 'Lyra', null], ['gu@example.com', 'Orion', 'too_fast']] as const) {
      const id = await user(email, name);
      await attempt(id, '2026-12-10', noon, 60_000, reason);
      await attempt(id, '2026-12-10', noon + 1, 1_000);
      const b2 = await daily('2026-12-10', await signIn(env, email));
      expect(b2.you).toBeNull();
      expect(b2.total).toBe(54);
    }
  });

  it('first attempts that start at the same instant go to the lower id', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await attempt(ana, '2026-12-10', noon, 50_000, 'daily', { id: 'day-b000000000000000' });
    await attempt(ana, '2026-12-10', noon, 40_000, 'daily', { id: 'day-a000000000000000' });
    expect((await daily('2026-12-10')).rows.map((r) => r.ms)).toEqual([40_000]);
  });

  it("the viewer's day is clamped to the server's day ±1, the offset must be a whole quarter hour, and the day must be real", async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await attempt(ana, '2026-12-09', noon - 86_400_000, 10_000);
    await attempt(ana, '2026-12-11', noon + 86_400_000, 30_000);
    expect(msOf(await daily('2026-12-01'))).toEqual([10_000]);
    expect(msOf(await daily('2027-03-01'))).toEqual([30_000]);
    expect((await daily('2026-12-10')).total).toBe(0);
    const bad = await call(env, 'GET', '/api/board?window=daily&today=2026-12-10&tz=7');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid', message: 'tz must be a whole quarter hour.' });
    for (const q of ['', 'today=2026-12-10', 'today=2026-02-30&tz=0']) expect((await call(env, 'GET', `/api/board?window=daily&${q}`)).status).toBe(400);
  });

  it("reads each day's attempts through games_daily (migration 0006): seeks only, the first-attempt check per run included", async () => {
    const plan = async (sql: string, ...bind: number[]): Promise<string[]> =>
      (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...bind).all<{ detail: string }>()).results.map((r) => r.detail);
    const day = 'SEARCH g USING INDEX games_daily (daily_day=?)';
    const earlier = 'SEARCH e USING INDEX games_daily (daily_day=? AND user_id=? AND started_at<?)';
    const user = 'SEARCH u USING INTEGER PRIMARY KEY (rowid=?)';
    for (const [sql, bind] of [
      [DAILY_TOP_SQL, [1]],
      [DAILY_TOTAL_SQL, [1]],
      [DAILY_RANK_SQL, [1, 1, 1]],
    ] as const) {
      const p = await plan(sql, ...bind);
      expect(p, sql).toEqual(expect.arrayContaining([day, earlier, user]));
      expect(p.join(), sql).not.toContain('SCAN');
    }
    const best = await plan(DAILY_BEST_SQL, 1, 1);
    expect(best).toEqual(expect.arrayContaining(['SEARCH g USING INDEX games_daily (daily_day=? AND user_id=?)', earlier]));
    expect(best.join()).not.toContain('SCAN');
    const first = await plan(DAILY_FIRST_SQL, 1, 1);
    expect(first[0]).toBe('SEARCH games USING INDEX games_daily (daily_day=? AND user_id=?)');
    expect(first.join()).not.toContain('SCAN');
  });
});

describe('the board cache (isolate memory, BOARD_TTL_MS)', () => {
  afterEach(() => vi.useRealTimers());

  it('serves the top 50 and the total from memory until they expire', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 50_000, 1000);
    expect((await board()).total).toBe(1);
    await run(ana, 40_000, 2000); // another isolate's finish, say
    vi.setSystemTime(1_800_000_000_000 + BOARD_TTL_MS - 1);
    const cached = await board();
    expect(cached.total).toBe(1);
    expect(cached.rows.map((r) => r.ms)).toEqual([50_000]);
    vi.setSystemTime(1_800_000_000_000 + BOARD_TTL_MS);
    const fresh = await board();
    expect(fresh.total).toBe(2);
    expect(fresh.rows.map((r) => r.ms)).toEqual([40_000, 50_000]);
  });

  it('counts the board once per BOARD_TTL_MS, not once per request', async () => {
    await run(await user('ana@example.com', 'Meridian'), 50_000, 1000);
    let statements = 0;
    const counting: Db = {
      prepare: (q) => {
        statements++;
        return db.prepare(q);
      },
      batch: (s) => db.batch(s),
    };
    const t = 1_800_000_000_000;
    expect(await cachedTotal(counting, t)).toBe(1);
    expect(await cachedTotal(counting, t + BOARD_TTL_MS - 1)).toBe(1);
    expect(statements).toBe(1);
    expect(await cachedTotal(counting, t + BOARD_TTL_MS)).toBe(1);
    expect(statements).toBe(2);
  });

  /** A Db that counts the statements it prepares. */
  function counted(): { db: Db; n: () => number } {
    let statements = 0;
    return {
      db: {
        prepare: (q) => {
          statements++;
          return db.prepare(q);
        },
        batch: (s) => db.batch(s),
      },
      n: () => statements,
    };
  }

  it('keeps each window apart (keyed by its start), each with its own age', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 50_000, 1000);
    await run(ana, 40_000, 5000);
    const t = 1_800_000_000_000;
    expect(await cachedTopAndTotal(db, t)).toMatchObject({ total: 2 });
    expect(await cachedTopAndTotal(db, t + 5, 2000)).toMatchObject({ total: 1 });
    await run(ana, 30_000, 6000); // another isolate's finish, say
    expect((await cachedTopAndTotal(db, t + 6)).top.map((r) => r.ms)).toEqual([40_000, 50_000]);
    expect((await cachedTopAndTotal(db, t + 6, 2000)).top.map((r) => r.ms)).toEqual([40_000]);
    expect(await cachedTopAndTotal(db, t + 6, 3000)).toMatchObject({ total: 2 }); // a window not seen yet is read now
    // All time expires first; the later window keeps its copy a little longer.
    expect(await cachedTopAndTotal(db, t + BOARD_TTL_MS)).toMatchObject({ total: 3 });
    expect(await cachedTopAndTotal(db, t + BOARD_TTL_MS, 2000)).toMatchObject({ total: 1 });
    expect(await cachedTopAndTotal(db, t + BOARD_TTL_MS + 5, 2000)).toMatchObject({ total: 2 });
  });

  it("runs joining the board in this isolate re-read every window's top, and count in each cached total they fall in", async () => {
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 50_000, 1000);
    await run(ana, 40_000, 5000);
    const t = 1_800_000_000_000;
    await cachedTopAndTotal(db, t);
    await cachedTopAndTotal(db, t, 2000);
    await cachedTopAndTotal(db, t, 7000);
    // A claim of two runs finished signed out earlier: one before the window from 2000, one in it; neither in 7000's.
    await run(ana, 30_000, 6000);
    await run(ana, 60_000, 1500);
    boardGrew([6000, 1500]);
    const c = counted();
    expect(await cachedTotal(c.db, t + 1)).toBe(4); // bumped, not counted again
    expect(await cachedTotal(c.db, t + 1, 2000)).toBe(2);
    expect(await cachedTotal(c.db, t + 1, 7000)).toBe(0);
    expect(c.n()).toBe(0);
    expect((await cachedTopAndTotal(c.db, t + 1)).top.map((r) => r.ms)).toEqual([30_000, 40_000, 50_000, 60_000]);
    expect(await cachedTopAndTotal(c.db, t + 1, 2000)).toMatchObject({ top: [{ ms: 30_000 }, { ms: 40_000 }], total: 2 });
    expect(await cachedTopAndTotal(c.db, t + 1, 7000)).toMatchObject({ top: [], total: 0 });
    expect(c.n()).toBe(6); // each window's top again (with its total, in one batch)
    boardGrew([]);
    expect(await cachedTopAndTotal(c.db, t + 2)).toMatchObject({ total: 4 });
    expect(c.n()).toBe(6); // nothing joined: nothing to re-read
  });

  it(`holds at most ${BOARD_CACHE_WINDOWS} windows, dropping the oldest`, async () => {
    await run(await user('ana@example.com', 'Meridian'), 50_000, 1000);
    const t = 1_800_000_000_000;
    const c = counted();
    for (let k = 0; k <= BOARD_CACHE_WINDOWS; k++) await cachedTopAndTotal(c.db, t, 100 + k);
    expect(c.n()).toBe(2 * (BOARD_CACHE_WINDOWS + 1));
    await cachedTopAndTotal(c.db, t, 101); // still held
    expect(c.n()).toBe(2 * (BOARD_CACHE_WINDOWS + 1));
    await cachedTopAndTotal(c.db, t, 100); // the first was dropped for the seventeenth
    expect(c.n()).toBe(2 * (BOARD_CACHE_WINDOWS + 2));
    resetBoardCache();
    await cachedTopAndTotal(c.db, t, 101);
    expect(c.n()).toBe(2 * (BOARD_CACHE_WINDOWS + 3));
  });

  it('your pinned best stays live while the top 50 are cached', async () => {
    const bo = await user('bo@example.com', 'Comet');
    await db.batch(
      Array.from({ length: 50 }, (_, k) =>
        db
          .prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, ranked) VALUES (?, ?, 1, 1, 0, ?, ?, 1)")
          .bind(`fast-${String(k).padStart(16, '0')}`, bo, 1000 + k, 10_000 + k),
      ),
    );
    const ana = await user('ana@example.com', 'Meridian');
    await run(ana, 99_000, 5000);
    const cookie = await signIn(env, 'ana@example.com');
    expect((await board(cookie)).you).toMatchObject({ ms: 99_000, rank: 51 });
    await run(ana, 90_000, 6000);
    expect((await board(cookie)).you).toMatchObject({ ms: 90_000, rank: 51 });
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
        { id: clock, ms: 30_000, finishedAt: 4000, ranked: false, reason: 'clock', isBest: false, imported: false, daily: null, dailyFirst: false },
        { id: slower, ms: 60_000, finishedAt: 3000, ranked: true, reason: null, isBest: false, imported: false, daily: null, dailyFirst: false },
        { id: best, ms: 45_000, finishedAt: 2000, ranked: true, reason: null, isBest: true, imported: false, daily: null, dailyFirst: false },
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
