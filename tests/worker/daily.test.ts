import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CLAIMS_PER_REQUEST, type BoardResponse, type ClaimResponse, type DailyRequest, type FinishResult, type MyGamesResponse, type StartResponse } from '../../src/api/types';
import type { LogEntry } from '../../src/core/log';
import { replay } from '../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../src/core/seeded';
import { dailySeed } from '../../worker/lib/daily';
import { DAILY_FIRSTS_SQL, dailyTopAndTotal } from '../../worker/lib/daily-board';
import { dayNumber } from '../../worker/lib/days';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { authSecret } from '../../worker/lib/users';
import { solvingTaps, withPause } from '../unit/core/solver';
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

const DAY = 86_400_000;
/** Only Date is faked; timers run. */
const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(iso) });
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;
const startDaily = (daily: DailyRequest | undefined, cookie?: string, ip?: string): Promise<Response> =>
  call(env, 'POST', '/api/games', { cookie, ip, body: daily ? { daily } : {} });
const row = (id: string) => db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Record<string, unknown>>();
const seedOf = (text: string) => dailySeed(authSecret(env), dayNumber(text) as number);

describe('starting the Daily Tree', () => {
  it('on 2026-11-06 gives every player the same seed and daily {day, past:false, repeat:false}', async () => {
    at('2026-11-06T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const guest = await json<StartResponse>(await startDaily({ today: '2026-11-06' }, undefined, '203.0.113.1'));
    const other = await json<StartResponse>(await startDaily({ today: '2026-11-06' }, undefined, '203.0.113.2'));
    const user = await json<StartResponse>(await startDaily({ today: '2026-11-06' }, ana, '203.0.113.3'));
    const info = { day: '2026-11-06', past: false, repeat: false };
    expect(guest.daily).toEqual(info);
    expect(other.daily).toEqual(info);
    expect(user.daily).toEqual(info);
    expect(guest.seed).toBe(await seedOf('2026-11-06'));
    expect(other.seed).toBe(guest.seed);
    expect(user.seed).toBe(guest.seed);
    expect(guest.id).not.toBe(other.id);
  });

  it('a random start still says daily: null and gets its own random seed', async () => {
    at('2026-11-06T12:00:00Z');
    const a = await json<StartResponse>(await startDaily(undefined));
    const b = await json<StartResponse>(await startDaily(undefined));
    expect(a.daily).toBeNull();
    expect(b.daily).toBeNull();
    expect(a.seed).not.toBe(b.seed);
    expect(a.seed).not.toBe(await seedOf('2026-11-06'));
  });

  it('a local date one day ahead of UTC is accepted; two days ahead is a 400 invalid', async () => {
    at('2026-11-06T23:30:00Z');
    const ahead = await startDaily({ today: '2026-11-07' });
    expect(ahead.status).toBe(200);
    expect((await json<StartResponse>(ahead)).daily).toEqual({ day: '2026-11-07', past: false, repeat: false });
    const tooFar = await startDaily({ today: '2026-11-08' });
    expect(tooFar.status).toBe(400);
    expect(await json(tooFar)).toMatchObject({ error: 'invalid', message: "That day's tree isn't open." });
  });

  it('a past day: {today, day} gives that day\'s seed and past:true', async () => {
    at('2026-12-10T12:00:00Z');
    const res = await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-03' }));
    expect(res.daily).toEqual({ day: '2026-12-03', past: true, repeat: false });
    expect(res.seed).toBe(await seedOf('2026-12-03'));
    expect(res.seed).not.toBe(await seedOf('2026-12-10'));
  });

  it('a day after today, before 2026-11-01, or not a real date is a 400; a today that is not live is too', async () => {
    at('2026-12-10T12:00:00Z');
    for (const daily of [
      { today: '2026-12-10', day: '2026-12-11' },
      { today: '2026-12-10', day: '2026-10-31' },
      { today: '2026-12-10', day: '2026-02-30' },
      { today: '2026-12-10', day: 'yesterday' },
      { today: '2026-12-20' },
      { today: '2026-12-01' },
      { today: 'nope' },
      '2026-12-10',
      [],
      5,
      {},
      { today: '2026-12-10', day: null },
    ]) {
      const res = await startDaily(daily as DailyRequest);
      expect(res.status, JSON.stringify(daily)).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'invalid', message: "That day's tree isn't open." });
    }
    expect((await startDaily({ today: '2026-12-10', day: '2026-11-01' })).status).toBe(200);
    expect((await db.prepare('SELECT count(*) AS n FROM games').first<{ n: number }>())?.n).toBe(1);
  });

  it("a signed-in player's second start of the day says repeat:true; a past start of the same day does not count as their live attempt", async () => {
    // A past start of Dec 9 opens once the day has closed (Dec 11, 00:00 UTC), after any live start could come. The clock
    // is set back to Dec 10 only to check that a past start already on record isn't taken for the live attempt.
    at('2026-12-12T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const bea = await signIn(env, 'bea@example.com');
    const past = await json<StartResponse>(await startDaily({ today: '2026-12-12', day: '2026-12-09' }, ana));
    expect(past.daily).toEqual({ day: '2026-12-09', past: true, repeat: false });
    vi.setSystemTime(Date.parse('2026-12-10T12:00:00Z'));
    const live = await json<StartResponse>(await startDaily({ today: '2026-12-09' }, ana));
    expect(live.daily).toEqual({ day: '2026-12-09', past: false, repeat: false });
    const again = await json<StartResponse>(await startDaily({ today: '2026-12-09' }, ana));
    expect(again.daily?.repeat).toBe(true);
    vi.setSystemTime(Date.parse('2026-12-12T12:00:00Z'));
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-12', day: '2026-12-09' }, ana))).daily).toEqual({ day: '2026-12-09', past: true, repeat: true });
    vi.setSystemTime(Date.parse('2026-12-10T12:00:00Z'));
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-09' }, bea))).daily?.repeat).toBe(false);
    // Guests are never repeats.
    await startDaily({ today: '2026-12-09' });
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-09' }))).daily?.repeat).toBe(false);
  });

  it("a past start of a day that hasn't closed yet (today=S+1, day=S) is a 400", async () => {
    // Dec 9 closes at Dec 11, 00:00 UTC: until then it is still someone's live day, so it can't be practised as a past run.
    at('2026-12-10T12:00:00Z');
    for (const daily of [
      { today: '2026-12-10', day: '2026-12-09' },
      { today: '2026-12-11', day: '2026-12-09' }, // a player far ahead of UTC
      { today: '2026-12-11', day: '2026-12-10' },
    ]) {
      const res = await startDaily(daily);
      expect(res.status, JSON.stringify(daily)).toBe(400);
      expect(await json(res)).toEqual({ error: 'invalid', message: "That day's tree isn't open." });
    }
    expect((await startDaily({ today: '2026-12-10', day: '2026-12-08' })).status).toBe(200);
    vi.setSystemTime(Date.parse('2026-12-11T00:00:00Z') - 1);
    expect((await startDaily({ today: '2026-12-11', day: '2026-12-09' })).status).toBe(400);
    vi.setSystemTime(Date.parse('2026-12-11T00:00:00Z'));
    const opened = await startDaily({ today: '2026-12-11', day: '2026-12-09' });
    expect(opened.status).toBe(200);
    expect((await json<StartResponse>(opened)).daily).toEqual({ day: '2026-12-09', past: true, repeat: false });
  });

  it('the row stores daily_day and daily_past', async () => {
    at('2026-12-10T12:00:00Z');
    const live = await json<StartResponse>(await startDaily({ today: '2026-12-10' }));
    const past = await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-03' }));
    const random = await json<StartResponse>(await startDaily(undefined));
    expect(await row(live.id)).toMatchObject({ daily_day: dayNumber('2026-12-10'), daily_past: 0, seed: live.seed });
    expect(await row(past.id)).toMatchObject({ daily_day: dayNumber('2026-12-03'), daily_past: 1, seed: past.seed });
    expect(await row(random.id)).toMatchObject({ daily_day: null, daily_past: 0 });
  });

  it("a signed-in player's unfinished Daily survives the one-day housekeeping and goes after three days; a guest's, like a random game, goes after one", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const daily = await json<StartResponse>(await startDaily({ today: '2026-12-10' }, ana));
    const dailyOld = await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-08' }, ana));
    // A guest's unfinished Daily can never be claimed (a claim needs a finished run), so nothing is kept for it.
    const guest = await json<StartResponse>(await startDaily({ today: '2026-12-10' }));
    const random = await json<StartResponse>(await startDaily(undefined));
    const age = (id: string, days: number) => db.prepare('UPDATE games SET started_at = ? WHERE id = ?').bind(Date.now() - days * DAY, id).run();
    await age(daily.id, 2);
    await age(dailyOld.id, 4);
    await age(guest.id, 1.5);
    await age(random.id, 2);
    await startDaily(undefined);
    expect(await row(daily.id)).not.toBeNull();
    expect(await row(dailyOld.id)).toBeNull();
    expect(await row(guest.id)).toBeNull();
    expect(await row(random.id)).toBeNull();
    await age(daily.id, 3.5);
    await startDaily(undefined);
    expect(await row(daily.id)).toBeNull();
  });

  it("an unverifiable finish deletes a random game but never a Daily attempt: the player's next start of that day is a repeat", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const garbage = (id: string) => call(env, 'POST', `/api/games/${id}/finish`, { cookie: ana, body: { log: 'x' } });
    const daily = await json<StartResponse>(await startDaily({ today: '2026-12-10' }, ana));
    expect((await garbage(daily.id)).status).toBe(422);
    expect(await row(daily.id)).toMatchObject({ finished_at: null, daily_day: dayNumber('2026-12-10') });
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-10' }, ana))).daily?.repeat).toBe(true);
    const random = await json<StartResponse>(await startDaily(undefined, ana));
    expect((await garbage(random.id)).status).toBe(422);
    expect(await row(random.id)).toBeNull();
  });

  it('the repeat lookup reads through games_daily, not a scan of every game', async () => {
    const plan = JSON.stringify((await db.prepare('EXPLAIN QUERY PLAN SELECT 1 AS one FROM games WHERE daily_day = ? AND user_id = ? AND daily_past = 0 LIMIT 1').bind(1, 1).all()).results);
    expect(plan).toContain('games_daily');
  });
});

/** The scripted solver's log for this game's tree, from 3 s after the local start, `gap` ms between taps. */
function solvingLog(game: StartResponse, gap: number): LogEntry[] {
  const b = seededBoard(game.seed, GEN_VERSION);
  if (!b) throw new Error('no board');
  return solvingTaps(b, 3000, gap);
}
/**
 * Finishes `log` like an honest client: the (faked, frozen) clock moves on to the game's start plus the log's span plus
 * 300 ms of network, so the server sees exactly that, and a later start is later than this one.
 */
async function finishLog(game: StartResponse, log: LogEntry[], cookie?: string): Promise<FinishResult> {
  const b = seededBoard(game.seed, GEN_VERSION, true);
  const span = b && replay(b, log)?.solvedAt;
  if (!span) throw new Error('does not replay');
  const at = Number((await row(game.id))?.started_at) + span + 300;
  if (at < Date.now()) throw new Error('the log is too short to finish now');
  vi.setSystemTime(at);
  const res = await call(env, 'POST', `/api/games/${game.id}/finish`, { cookie, body: { log } });
  if (!res.ok) throw new Error(`finish failed: ${res.status}`);
  return json<FinishResult>(res);
}
const solve = (game: StartResponse, { cookie, gap = 50 }: { cookie?: string; gap?: number } = {}): Promise<FinishResult> => finishLog(game, solvingLog(game, gap), cookie);
const later = (ms = 60_000) => vi.setSystemTime(Date.now() + ms);
const play = async (daily: DailyRequest | undefined, opts: { cookie?: string; gap?: number; ip?: string } = {}) => {
  const game = await json<StartResponse>(await startDaily(daily, opts.cookie, opts.ip));
  return { game, result: await solve(game, opts) };
};
const board = async (q: string, cookie?: string) => json<BoardResponse>(await call(env, 'GET', `/api/board?${q}`, { cookie }));
const dailyBoard = (today: string, cookie?: string) => board(`window=daily&today=${today}&tz=0`, cookie);
/** Every main board: today, this week and all time. */
const mainBoards = async (today: string) => Promise.all([board(`window=today&today=${today}&tz=0`), board(`window=week&today=${today}&tz=0`), board('window=all')]);
const EMPTY = { rows: [], total: 0, you: null };

describe('finishing a Daily run', () => {
  it("a solved Daily run: ranked false, reason 'daily', daily {first:true, rank:1, total:1}; the All time board is unchanged", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { game, result } = await play({ today: '2026-12-10' }, { cookie: ana });
    expect(result).toEqual({
      id: game.id,
      ranked: false,
      reason: 'daily',
      ms: expect.any(Number),
      rank: null,
      total: 0,
      best: null,
      newBest: false,
      daily: { day: '2026-12-10', past: false, first: true, rank: 1, total: 1 },
    });
    expect(await row(game.id)).toMatchObject({ ranked: 0, unranked_reason: 'daily' });
    expect(await mainBoards('2026-12-10')).toEqual([EMPTY, EMPTY, EMPTY]);
    expect((await dailyBoard('2026-12-10', ana)).rows).toEqual([{ rank: 1, name: 'Meridian', ms: result.ms, finishedAt: Date.now(), mine: true }]);
    // A random run is unchanged, with daily: null.
    const random = await play(undefined, { cookie: ana });
    expect(random.result).toMatchObject({ ranked: true, reason: null, rank: 1, total: 1, daily: null });
  });

  it("a Daily run judged 'too_fast' keeps that reason and is not on the Daily board", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { result } = await play({ today: '2026-12-10' }, { cookie: ana, gap: 20 });
    expect(result).toMatchObject({ ranked: false, reason: 'too_fast', rank: null, daily: { day: '2026-12-10', past: false, first: true, rank: null, total: 0 } });
    expect(await dailyBoard('2026-12-10')).toEqual(EMPTY);
    // It was the first attempt: a clean second one doesn't take its place.
    later();
    const second = await play({ today: '2026-12-10' }, { cookie: ana });
    expect(second.result).toMatchObject({ reason: 'daily', daily: { first: false, rank: null, total: 0 } });
    expect(await dailyBoard('2026-12-10')).toEqual(EMPTY);
  });

  it("the second attempt of the day: daily.first false, rank null; the Daily board still shows the first run's time", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    const first = await play({ today: '2026-12-10' }, { cookie: ana, gap: 90 });
    const firstAt = Date.now();
    later();
    await play({ today: '2026-12-10' }, { cookie: bo, gap: 70 });
    later();
    const second = await play({ today: '2026-12-10' }, { cookie: ana, gap: 50 });
    expect(second.result.ms).toBeLessThan(first.result.ms);
    expect(second.result).toMatchObject({ ranked: false, reason: 'daily', rank: null, daily: { day: '2026-12-10', past: false, first: false, rank: null, total: 2 } });
    const b = await dailyBoard('2026-12-10', ana);
    expect(b.total).toBe(2);
    expect(b.rows.map((r) => [r.name, r.ms])).toEqual([
      ['Comet', expect.any(Number)],
      ['Meridian', first.result.ms],
    ]);
    expect(b.rows[1]).toMatchObject({ rank: 2, finishedAt: firstAt, mine: true });
    // The first attempt's own result is unchanged on a retry.
    const retry = await call(env, 'POST', `/api/games/${first.game.id}/finish`, { cookie: ana, body: { log: [] } });
    expect((await json<FinishResult>(retry)).daily).toEqual({ day: '2026-12-10', past: false, first: true, rank: 2, total: 2 });
  });

  it('an abandoned first attempt forfeits the day: the later finished run is not on the Daily board', async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    await startDaily({ today: '2026-12-10' }, ana); // opened, never finished
    later();
    const { result } = await play({ today: '2026-12-10' }, { cookie: ana });
    expect(result).toMatchObject({ reason: 'daily', daily: { first: false, rank: null, total: 0 } });
    expect(await dailyBoard('2026-12-10', ana)).toEqual(EMPTY);
  });

  it("a past day's run: reason 'past', on no board", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { result } = await play({ today: '2026-12-10', day: '2026-12-08' }, { cookie: ana });
    expect(result).toMatchObject({ ranked: false, reason: 'past', rank: null, daily: { day: '2026-12-08', past: true, first: false, rank: null, total: 0 } });
    // Dec 8's board is past the window the route serves: read it directly.
    expect(await dailyTopAndTotal(db, dayNumber('2026-12-08') as number)).toEqual({ top: [], total: 0 });
    expect(await mainBoards('2026-12-10')).toEqual([EMPTY, EMPTY, EMPTY]);
    // Too fast still says so on a past day.
    later();
    expect((await play({ today: '2026-12-10', day: '2026-12-08' }, { cookie: ana, gap: 20 })).result.reason).toBe('too_fast');
    // A guest's past run is no first attempt either.
    later();
    expect((await play({ today: '2026-12-10', day: '2026-12-08' })).result).toMatchObject({ reason: 'past', daily: { past: true, first: false, rank: null } });
  });

  it("a guest's Daily run, claimed after sign-in and naming, joins the Daily board and never the All time board; its reason stays 'daily'", async () => {
    at('2026-12-10T12:00:00Z');
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    await play({ today: '2026-12-10' }, { cookie: bo, gap: 50 });
    later();
    const guest = await play({ today: '2026-12-10' }, { gap: 90 });
    // The place it would take once claimed: "#2 of 2".
    expect(guest.result).toMatchObject({ ranked: false, reason: 'daily', rank: null, best: null, daily: { day: '2026-12-10', past: false, first: true, rank: 2, total: 2 } });
    later();
    // A guest is never a repeat: every live run of theirs is a first attempt until claimed.
    const again = await play({ today: '2026-12-10' }, { gap: 70 });
    expect(again.result.daily).toMatchObject({ first: true, rank: 2, total: 2 });
    const ana = await signIn(env, 'ana@example.com');
    await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Meridian' } });
    const { results } = await json<ClaimResponse>(
      await call(env, 'POST', '/api/games/claim', { cookie: ana, body: { claims: [{ id: guest.game.id, claim: guest.game.claim }, { id: again.game.id, claim: again.game.claim }] } }),
    );
    expect(results).toEqual([
      { ...guest.result, daily: { day: '2026-12-10', past: false, first: true, rank: 2, total: 2 } },
      { ...again.result, daily: { day: '2026-12-10', past: false, first: false, rank: null, total: 2 } },
    ]);
    expect(await row(guest.game.id)).toMatchObject({ ranked: 0, unranked_reason: 'daily', claim_hash: null });
    const b = await dailyBoard('2026-12-10', ana);
    expect(b.rows.map((r) => [r.rank, r.name, r.ms, r.mine])).toEqual([
      [1, 'Comet', expect.any(Number), false],
      [2, 'Meridian', guest.result.ms, true],
    ]);
    const [today, week, all] = await mainBoards('2026-12-10');
    expect([today.total, week.total, all.total]).toEqual([0, 0, 0]);
  });

  it("a claimed guest run that started before the account's own run of the day becomes the first attempt: it joins the board, the account's run leaves", async () => {
    at('2026-12-10T12:00:00Z');
    const guest = await json<StartResponse>(await startDaily({ today: '2026-12-10' })); // another device, signed out
    later(1000);
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const own = await play({ today: '2026-12-10' }, { cookie: ana, gap: 50 });
    expect(own.result.daily).toEqual({ day: '2026-12-10', past: false, first: true, rank: 1, total: 1 });
    // The guest's tab sat paused through all that, then finished.
    const guestResult = await finishLog(guest, withPause(solvingLog(guest, 90), 5, Date.now() - Number((await row(guest.id))?.started_at)));
    expect(guestResult).toMatchObject({ reason: 'daily', daily: { first: true, rank: 2, total: 2 } });
    const { results } = await json<ClaimResponse>(await call(env, 'POST', '/api/games/claim', { cookie: ana, body: { claims: [{ id: guest.id, claim: guest.claim }] } }));
    expect(results).toMatchObject([{ id: guest.id, reason: 'daily', ranked: false, daily: { day: '2026-12-10', past: false, first: true, rank: 1, total: 1 } }]);
    const b = await dailyBoard('2026-12-10', ana);
    expect(b).toEqual({ rows: [{ rank: 1, name: 'Meridian', ms: guestResult.ms, finishedAt: Date.now(), mine: true }], total: 1, you: null });
    expect(guestResult.ms).not.toBe(own.result.ms);
    const retry = await call(env, 'POST', `/api/games/${own.game.id}/finish`, { cookie: ana, body: { log: [] } });
    expect((await json<FinishResult>(retry)).daily).toEqual({ day: '2026-12-10', past: false, first: false, rank: null, total: 1 });
  });

  it('a claim before naming: the would-be place counts the run in the total', async () => {
    at('2026-12-10T12:00:00Z');
    const guest = await play({ today: '2026-12-10' });
    const ana = await signIn(env, 'ana@example.com');
    const { results } = await json<ClaimResponse>(await call(env, 'POST', '/api/games/claim', { cookie: ana, body: { claims: [{ id: guest.game.id, claim: guest.game.claim }] } }));
    expect(results[0].daily).toEqual({ day: '2026-12-10', past: false, first: true, rank: 1, total: 1 });
    expect(await dailyBoard('2026-12-10')).toEqual(EMPTY);
    await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Meridian' } });
    expect((await dailyBoard('2026-12-10')).total).toBe(1);
  });

  it('a full claim of Daily runs on 8 different days stays within the D1 query budget', async () => {
    at('2026-12-01T12:00:00Z');
    const runs = [];
    for (let k = 0; k < 8; k++) {
      const today = new Date(Date.now()).toISOString().slice(0, 10);
      runs.push(await play({ today }));
      vi.setSystemTime(Date.parse(`${today}T12:00:00Z`) + DAY);
    }
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    let statements = 0;
    const counting: Db = {
      prepare: (q) => {
        statements++;
        return db.prepare(q);
      },
      batch: (s) => db.batch(s),
    };
    const res = await call({ ...env, DB: counting }, 'POST', '/api/games/claim', { cookie: ana, body: { claims: runs.map((r) => ({ id: r.game.id, claim: r.game.claim })) } });
    const { results } = await json<ClaimResponse>(res);
    expect(results.map((r) => r.daily)).toEqual(runs.map((r) => ({ ...r.result.daily, rank: 1, total: 1 })));
    // The worst case is 3 + 5 × MAX_CLAIMS_PER_REQUEST statements (43), against D1's 50 per request on Workers Free:
    // the session, the main total and the owner's best, then per claim its read and update, and per Daily day its
    // total, the owner's first attempt and the run's place.
    expect(statements).toBeLessThanOrEqual(3 + 5 * MAX_CLAIMS_PER_REQUEST);
  });
});

describe('Your games and the Daily', () => {
  it('Your games labels a Daily run with its day, and a random run with null', async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const daily = await play({ today: '2026-12-10' }, { cookie: ana });
    later();
    const past = await play({ today: '2026-12-10', day: '2026-12-03' }, { cookie: ana });
    later();
    const random = await play(undefined, { cookie: ana });
    const g = await json<MyGamesResponse>(await call(env, 'GET', '/api/me/games', { cookie: ana }));
    expect(g.games.map((x) => [x.id, x.daily, x.dailyFirst, x.reason, x.ranked, x.isBest])).toEqual([
      [random.game.id, null, false, null, true, true],
      [past.game.id, '2026-12-03', false, 'past', false, false],
      [daily.game.id, '2026-12-10', true, 'daily', false, false],
    ]);
    // Daily runs are not your best, nor on the main board.
    expect(g).toMatchObject({ best: { ms: random.result.ms, rank: 1 }, inTop: 1, total: 1 });
  });

  it("Your games tells each day's first attempt from a repeat, reading each Daily day's first attempts once", async () => {
    at('2026-12-09T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const nine = await play({ today: '2026-12-09' }, { cookie: ana });
    later();
    const nineAgain = await play({ today: '2026-12-09' }, { cookie: ana });
    vi.setSystemTime(Date.parse('2026-12-10T12:00:00Z'));
    await startDaily({ today: '2026-12-10' }, ana); // abandoned: the day's first attempt, not in the list
    later();
    const tenRepeat = await play({ today: '2026-12-10' }, { cookie: ana });
    later();
    const tooFast = await play({ today: '2026-12-11' }, { cookie: ana, gap: 20 }); // a first attempt, judged too fast
    later();
    const random = await play(undefined, { cookie: ana });
    let statements = 0;
    const counting: Db = {
      prepare: (q) => {
        statements++;
        return db.prepare(q);
      },
      batch: (s) => db.batch(s),
    };
    const g = await json<MyGamesResponse>(await call(env, 'GET', '/api/me/games', { cookie: ana }));
    expect(g.games.map((x) => [x.id, x.daily, x.dailyFirst])).toEqual([
      [random.game.id, null, false],
      [tooFast.game.id, '2026-12-11', true],
      [tenRepeat.game.id, '2026-12-10', false],
      [nineAgain.game.id, '2026-12-09', false],
      [nine.game.id, '2026-12-09', true],
    ]);
    // One read for every Daily day in the list; none at all without a Daily run.
    await call({ ...env, DB: counting }, 'GET', '/api/me/games', { cookie: ana });
    const withDaily = statements;
    await db.prepare('DELETE FROM games WHERE daily_day IS NOT NULL').run();
    statements = 0;
    await call({ ...env, DB: counting }, 'GET', '/api/me/games', { cookie: ana });
    expect(withDaily - statements).toBe(1);
  });

  it("Your games' first-attempt read seeks games_daily for each of the list's days", async () => {
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${DAILY_FIRSTS_SQL}`).bind(1, '[1,2]').all<{ detail: string }>()).results.map((r) => r.detail);
    expect(plan).toEqual(
      expect.arrayContaining([
        'SEARCH g USING INDEX games_daily (daily_day=? AND user_id=?)',
        'SEARCH e USING INDEX games_daily (daily_day=? AND user_id=? AND started_at<?)',
      ]),
    );
    expect(plan.filter((d) => /^SCAN/.test(d))).toEqual(['SCAN d VIRTUAL TABLE INDEX 1:']); // only the list of days itself
    expect(plan.join()).not.toContain('games_user');
  });
});
