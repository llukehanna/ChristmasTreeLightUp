import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GhostRun, ReplayResponse, StartResponse } from '../../src/api/types';
import type { LogEntry } from '../../src/core/log';
import { replay } from '../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../src/core/seeded';
import { dailyClosesAt } from '../../worker/lib/daily';
import type { Db } from '../../worker/lib/db';
import { dayNumber } from '../../worker/lib/days';
import type { AppEnv } from '../../worker/lib/env';
import { canWatch, type WatchRow } from '../../worker/lib/replays';
import { solvingTaps } from '../unit/core/solver';
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
afterEach(() => vi.useRealTimers());

const DAY = dayNumber('2026-12-10') as number;
const CLOSES = dailyClosesAt(DAY);

describe('canWatch (who may watch what)', () => {
  const base: WatchRow = { user_id: 7, named: 1, ranked: 1, daily_day: null, has_log: 1, finished_at: 1000 };
  const watch = (over: Partial<WatchRow>, viewer: number | null = 8, now = 5000) => canWatch({ ...base, ...over }, viewer, now);

  it("lets the owner watch their own finished run that has a log, and nothing else of theirs", () => {
    expect(watch({}, 7)).toBe(true);
    expect(watch({ named: 0, ranked: 0 }, 7)).toBe(true);
    expect(watch({ finished_at: null }, 7)).toBe(false);
    expect(watch({ has_log: 0 }, 7)).toBe(false);
  });

  it("lets anyone watch a named player's ranked run, but not an unnamed player's or an unranked random run", () => {
    expect(watch({})).toBe(true);
    expect(watch({}, null)).toBe(true);
    expect(watch({ named: 0 })).toBe(false);
    expect(watch({ ranked: 0 })).toBe(false);
    expect(watch({ has_log: 0 })).toBe(false);
  });

  it("never lets anyone watch a guest's run", () => {
    expect(watch({ user_id: null, named: 0 }, 7)).toBe(false);
    expect(watch({ user_id: null, named: 0 }, null)).toBe(false);
    expect(watch({ user_id: null, named: 0, ranked: 0 }, 8)).toBe(false);
  });

  it("keeps another player's Daily run closed until its day has closed", () => {
    const daily = { ranked: 0, daily_day: DAY };
    expect(watch(daily, 8, CLOSES - 1)).toBe(false);
    expect(watch(daily, 8, CLOSES)).toBe(true);
    expect(watch({ ...daily, named: 0 }, 8, CLOSES)).toBe(false);
    expect(watch(daily, 7, CLOSES - 1)).toBe(true);
  });
});

describe('GET /api/games/:id/replay', () => {
  const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;
  const replayOf = (id: string, cookie?: string) => call(env, 'GET', `/api/games/${id}/replay`, { cookie });

  /** Plays a tree like an honest client and finishes it. */
  async function play(cookie: string): Promise<{ game: StartResponse; log: LogEntry[] }> {
    const game = await json<StartResponse>(await call(env, 'POST', '/api/games', { cookie }));
    const board = seededBoard(game.seed, GEN_VERSION);
    const headless = seededBoard(game.seed, GEN_VERSION, true);
    if (!board || !headless) throw new Error('no board');
    const log = solvingTaps(board, 3000, 50);
    const span = replay(headless, log)?.solvedAt;
    if (!span) throw new Error('does not replay');
    // The clock stands still at exactly the log's span plus 300 ms of network, so a loaded machine can't make it 'clock'.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      await db.prepare('UPDATE games SET started_at = started_at - ? WHERE id = ?').bind(span + 300, game.id).run();
      const res = await call(env, 'POST', `/api/games/${game.id}/finish`, { cookie, body: { log } });
      if (!res.ok) throw new Error(`finish failed: ${res.status}`);
    } finally {
      vi.useRealTimers();
    }
    return { game, log };
  }

  async function user(email: string, name: string | null): Promise<number> {
    const row = await db
      .prepare('INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES (?, ?, ?, ?, 1) RETURNING id')
      .bind(`fake:${email}`, email, name, name === null ? null : name.toLowerCase())
      .first<{ id: number }>();
    if (!row) throw new Error('no user');
    return row.id;
  }

  /** A finished Daily run of `userId` straight into D1, with a log that parses. */
  async function dailyRun(userId: number, id: string, ms = 40_000, reason = 'daily', day = DAY): Promise<LogEntry[]> {
    const board = seededBoard(1, GEN_VERSION);
    if (!board) throw new Error('no board');
    const log = solvingTaps(board, 3000, 50);
    await db
      .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, unranked_reason, daily_day, daily_past, log) VALUES (?, ?, ?, 1, 0, ?, ?, 0, 0, 0, ?, ?, 0, ?)')
      .bind(id, userId, GEN_VERSION, ms, ms, reason, day, JSON.stringify(log))
      .run();
    return log;
  }

  it('returns your own finished run: its seed, generator version, exact log and ms, with mine: true', async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    const { game, log } = await play(cookie);
    const ms = (await db.prepare('SELECT ms FROM games WHERE id = ?').bind(game.id).first<{ ms: number }>())?.ms;
    const res = await replayOf(game.id, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(res.headers.get('Vary')).toBe('Cookie');
    const body = await json<ReplayResponse>(res);
    expect(body).toMatchObject({ id: game.id, name: 'Meridian', mine: true, seed: game.seed, genVersion: GEN_VERSION, log, ms, daily: null });
    expect(body.finishedAt).toBeGreaterThan(0);
    // A guest sees it too: it is a ranked run of a named player.
    expect(await json<ReplayResponse>(await replayOf(game.id))).toMatchObject({ mine: false, name: 'Meridian', log });
  });

  it('answers an unknown id, a bad id, a guest game, an unfinished one and an imported one with one 404', async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    const { game } = await play(cookie);
    const guest = await json<StartResponse>(await call(env, 'POST', '/api/games'));
    const open = await json<StartResponse>(await call(env, 'POST', '/api/games', { cookie }));
    await db.prepare('UPDATE games SET log = NULL WHERE id = ?').bind(game.id).run();
    const unknown = await replayOf('nope-nope-nope-nope-0000');
    expect(unknown.status).toBe(404);
    const body = await json<{ error: string; message: string }>(unknown);
    expect(body).toEqual({ error: 'not_found', message: 'That run has no replay.' });
    for (const id of [guest.id, open.id, game.id]) {
      const res = await replayOf(id, cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(body);
    }
  });

  it("is a 404 when the stored log doesn't parse", async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    const { game } = await play(cookie);
    await db.prepare('UPDATE games SET log = ? WHERE id = ?').bind('{"not":"a log"}', game.id).run();
    expect((await replayOf(game.id, cookie)).status).toBe(404);
    await db.prepare('UPDATE games SET log = ? WHERE id = ?').bind('not json', game.id).run();
    expect((await replayOf(game.id, cookie)).status).toBe(404);
  });

  it("hides another player's open Daily run, with the same body as an unknown id, until its day closes", async () => {
    const bo = await user('bo@example.com', 'Comet');
    const log = await dailyRun(bo, 'daily-bo-0000000000');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    vi.useFakeTimers({ toFake: ['Date'], now: CLOSES - 1 });
    const hidden = await replayOf('daily-bo-0000000000', ana);
    const unknown = await replayOf('nope-nope-nope-nope-0000', ana);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await unknown.json());
    vi.setSystemTime(CLOSES);
    const open = await replayOf('daily-bo-0000000000', ana);
    expect(open.status).toBe(200);
    expect(await json<ReplayResponse>(open)).toMatchObject({ name: 'Comet', mine: false, daily: '2026-12-10', log, ms: 40_000 });
  });

  it("lets the owner watch their own open Daily run", async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    const me = (await db.prepare('SELECT id FROM users WHERE email = ?').bind('ana@example.com').first<{ id: number }>())?.id as number;
    await dailyRun(me, 'daily-ana-000000000');
    vi.useFakeTimers({ toFake: ['Date'], now: CLOSES - 1 });
    expect(await json<ReplayResponse>(await replayOf('daily-ana-000000000', cookie))).toMatchObject({ mine: true, daily: '2026-12-10' });
  });

  describe('GET /api/me/ghost', () => {
    const ghostOf = (day: string, cookie?: string) => call(env, 'GET', `/api/me/ghost?day=${day}`, { cookie });
    const meId = async (email: string) => ((await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>())?.id as number);

    it("is your fastest run on the day's tree, whichever attempt, but never a run the judge refused", async () => {
      const cookie = await signIn(env, 'ana@example.com', 'Meridian');
      const me = await meId('ana@example.com');
      await dailyRun(me, 'ghost-daily-00000000', 52_000, 'daily');
      await dailyRun(me, 'ghost-paused-0000000', 48_000, 'paused');
      const log = await dailyRun(me, 'ghost-past-000000000', 50_000, 'past');
      const res = await ghostOf('2026-12-10', cookie);
      expect(res.status).toBe(200);
      expect(await json<{ ghost: GhostRun | null }>(res)).toEqual({ ghost: { seed: 1, genVersion: GEN_VERSION, log, ms: 50_000 } });
    });

    it("never returns another player's faster run", async () => {
      const cookie = await signIn(env, 'ana@example.com', 'Meridian');
      const bo = await user('bo@example.com', 'Comet');
      await dailyRun(bo, 'ghost-bo-000000000000', 30_000, 'daily');
      await dailyRun(await meId('ana@example.com'), 'ghost-ana-00000000000', 55_000, 'daily');
      expect((await json<{ ghost: GhostRun }>(await ghostOf('2026-12-10', cookie))).ghost.ms).toBe(55_000);
    });

    it('is null on a day with none of your runs, or when the stored log does not parse', async () => {
      const cookie = await signIn(env, 'ana@example.com', 'Meridian');
      const me = await meId('ana@example.com');
      await dailyRun(me, 'ghost-other-day-0000', 40_000, 'daily', DAY + 1);
      expect(await json(await ghostOf('2026-12-10', cookie))).toEqual({ ghost: null });
      await dailyRun(me, 'ghost-bad-log-000000');
      await db.prepare('UPDATE games SET log = ? WHERE id = ?').bind('{"not":"a log"}', 'ghost-bad-log-000000').run();
      expect(await json(await ghostOf('2026-12-10', cookie))).toEqual({ ghost: null });
    });

    it('is a 401 signed out, and a 400 for a day that is not a real date', async () => {
      expect((await ghostOf('2026-12-10')).status).toBe(401);
      const cookie = await signIn(env, 'ana@example.com', 'Meridian');
      for (const day of ['2026-02-30', 'tomorrow', '']) expect((await ghostOf(day, cookie)).status).toBe(400);
      expect((await call(env, 'GET', '/api/me/ghost', { cookie })).status).toBe(400);
    });
  });
});
