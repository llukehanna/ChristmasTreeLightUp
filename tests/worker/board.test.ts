import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse, MyGamesResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { BOARD_TTL_MS, cachedTotal, resetBoardCache } from '../../worker/lib/board-cache';
import { BEST_SQL, TOP_SQL } from '../../worker/lib/ranks';
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
    expect(b.rows).toHaveLength(50);
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
        { id: clock, ms: 30_000, finishedAt: 4000, ranked: false, reason: 'clock', isBest: false, imported: false },
        { id: slower, ms: 60_000, finishedAt: 3000, ranked: true, reason: null, isBest: false, imported: false },
        { id: best, ms: 45_000, finishedAt: 2000, ranked: true, reason: null, isBest: true, imported: false },
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
