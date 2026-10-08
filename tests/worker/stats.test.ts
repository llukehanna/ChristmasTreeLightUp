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
    const out = await stats(undefined);
    expect(out.status).toBe(401);
    expect(await out.json()).toMatchObject({ error: 'signed_out' });
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    for (const q of ['', 'today=2026-10-08', 'tz=420', 'today=2026-02-30&tz=420', 'today=10/08/2026&tz=420', 'today=2026-10-08&tz=1.5', 'today=2026-10-08&tz=900', 'today=2026-10-08&tz=841', 'today=2026-10-08&tz=-841', 'today=2026-10-08&tz=0420']) {
      const res = await stats(cookie, q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid', message: 'today must be YYYY-MM-DD and tz whole minutes from -840 to 840.' });
    }
  });

  it('accepts the offset limits, 840 and -840', async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    for (const tz of [840, -840]) expect((await stats(cookie, `today=2026-10-08&tz=${tz}`)).status).toBe(200);
  });

  it('a new account: zeros and nulls', async () => {
    const res = await stats(await signIn(env, 'ana@example.com', 'Meridian'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AccountStats;
    expect(typeof body.userId).toBe('number');
    expect({ ...body, userId: 0 }).toEqual({ userId: 0, solved: 0, totalMs: 0, averageMs: null, bestMs: null, streak: 0, longestStreak: 0, lastSolvedDay: null, imported: 0 } satisfies AccountStats);
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
      userId: ana,
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

  it('a finish exactly at local midnight belongs to the new day; one millisecond before, to the old', async () => {
    const bo = await user('bo@example.com', 'Comet');
    await game(bo, 50_000, Date.UTC(2026, 9, 9, 6, 59, 59, 999));
    const cookie = await signIn(env, 'bo@example.com');
    expect(await (await stats(cookie, 'today=2026-10-08&tz=420')).json()).toMatchObject({ lastSolvedDay: '2026-10-08' });
    await game(bo, 51_000, Date.UTC(2026, 9, 9, 7, 0, 0, 0));
    expect(await (await stats(cookie, 'today=2026-10-09&tz=420')).json()).toMatchObject({ lastSolvedDay: '2026-10-09', streak: 2, longestStreak: 2 });
  });
});

describe('GET /api/me/stats cost', () => {
  it('reads about two rows per game (the index entry and the row), not three', async () => {
    const ana = await user('ana@example.com', 'Meridian');
    for (let i = 0; i < 60; i++) await game(ana, 60_000 + i, noonPdt(i % 6), { source: i % 4 === 0 ? 'import' : 'play' });
    const cookie = await signIn(env, 'ana@example.com');
    const read: number[] = [];
    const counting: AppEnv = {
      ...env,
      DB: {
        prepare: (q: string) => db.prepare(q),
        batch: async (s) => {
          const out = await db.batch(s);
          for (const r of out) read.push((r.meta as unknown as { rows_read: number }).rows_read);
          return out;
        },
      },
    };
    const res = await call(counting, 'GET', '/api/me/stats?today=2026-10-08&tz=420', { cookie });
    expect(await res.json()).toMatchObject({ solved: 60, imported: 15 });
    // The batch: the per-day statement, then BEST_SQL (a handful of rows through games_best).
    expect(read).toHaveLength(2);
    expect(read[0]).toBeGreaterThanOrEqual(60);
    expect(read[0]).toBeLessThanOrEqual(2 * 60 + 2);
    expect(read[1]).toBeLessThanOrEqual(3);
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
