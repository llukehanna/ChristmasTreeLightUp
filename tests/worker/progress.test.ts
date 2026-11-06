import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishResult, ProgressResponse, RunContext, StartResponse } from '../../src/api/types';
import { runFacts } from '../../src/core/facts';
import { evaluate, type RunRecord } from '../../src/core/goals';
import type { LogEntry } from '../../src/core/log';
import { replay } from '../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../src/core/seeded';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
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

const DAY = 86_400_000;
/** Only Date is faked; timers run. */
const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(iso) });
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;
const row = (id: string) => db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<Record<string, unknown>>();
const start = async (cookie?: string, daily?: { today: string }): Promise<StartResponse> =>
  json<StartResponse>(await call(env, 'POST', '/api/games', { cookie, body: daily ? { daily } : {} }));

/**
 * Plays a tree like an honest client: the scripted solver from 3 s after the start, `gap` ms between taps, then the
 * (faked, frozen) clock moves on to the start plus the log's span plus 300 ms of network, and the finish is sent with
 * `ctx` (left out when undefined).
 */
async function play(cookie?: string, { gap = 50, ctx }: { gap?: number; ctx?: unknown } = {}) {
  const game = await start(cookie);
  const board = seededBoard(game.seed, GEN_VERSION);
  if (!board) throw new Error('no board');
  const log: LogEntry[] = solvingTaps(board, 3000, gap);
  const headless = seededBoard(game.seed, GEN_VERSION, true);
  const span = headless && replay(headless, log)?.solvedAt;
  if (!span) throw new Error('does not replay');
  vi.setSystemTime(Number((await row(game.id))?.started_at) + span + 300);
  const res = await call(env, 'POST', `/api/games/${game.id}/finish`, { cookie, body: ctx === undefined ? { log } : { log, ctx } });
  if (!res.ok) throw new Error(`finish failed: ${res.status}`);
  return { game, log, result: await json<FinishResult>(res) };
}
const later = (ms = 60_000) => vi.setSystemTime(Date.now() + ms);
const progress = (cookie?: string) => call(env, 'GET', '/api/me/progress', { cookie });

describe('facts and context at the finish', () => {
  it('a finish stores the facts and the reported context', async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const ctx: RunContext = { tz: -60, station: 'fireplace', world: 'secret' };
    const { game, log, result } = await play(ana, { ctx });
    expect(result).toMatchObject({ ranked: true, reason: null });
    const facts = runFacts(game.seed, GEN_VERSION, log);
    expect(facts).not.toBeNull();
    const pick = 'SELECT turns, min_turns, feats, tz, station, world, claimed_at FROM games WHERE id = ?';
    expect(await db.prepare(pick).bind(game.id).first()).toEqual({
      turns: facts?.turns,
      min_turns: facts?.minTurns,
      feats: facts?.feats,
      tz: -60,
      station: 'fireplace',
      world: 'secret',
      claimed_at: null,
    });
    expect(facts?.turns).toBe(log.length); // the solver's every entry is a tap

    // An unranked run (too fast) and a guest's run keep theirs too; a null station and world are a valid report.
    later();
    const fast = await play(ana, { gap: 20, ctx: { tz: 0, station: null, world: null } });
    expect(fast.result.reason).toBe('too_fast');
    expect(await db.prepare(pick).bind(fast.game.id).first()).toMatchObject({ turns: fast.log.length, tz: 0, station: null, world: null });
    later();
    const guest = await play(undefined, { ctx: { tz: 300, station: 'music-box', world: 'home-alone' } });
    expect(await db.prepare(pick).bind(guest.game.id).first()).toMatchObject({ turns: guest.log.length, tz: 300, station: 'music-box', world: 'home-alone' });
  });

  it('a malformed ctx is dropped, the run still finishes', async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const good = { tz: 0, station: 'fireplace', world: 'secret' };
    for (const ctx of [
      null,
      'secret',
      [],
      {},
      { ...good, tz: 841 },
      { ...good, tz: 1.5 },
      { ...good, tz: '60' },
      { ...good, station: 'Fire Place' },
      { ...good, station: 'x'.repeat(65) },
      { ...good, station: '' },
      { ...good, station: 7 },
      { tz: 0, world: null }, // station missing
      { ...good, world: 'mars' },
      { ...good, world: 'Secret' },
    ]) {
      const { game, log, result } = await play(ana, { ctx });
      expect(result.ranked, JSON.stringify(ctx)).toBe(true);
      expect(await row(game.id), JSON.stringify(ctx)).toMatchObject({ turns: log.length, tz: null, station: null, world: null });
      later();
    }
    // The longest station that passes.
    const { game } = await play(ana, { ctx: { tz: -840, station: 'a-1'.repeat(21) + 'z', world: null } });
    expect(await row(game.id)).toMatchObject({ tz: -840, station: 'a-1'.repeat(21) + 'z' });
  });
});

describe("housekeeping keeps an account's unfinished games", () => {
  it("signed in: an unfinished game is never swept; a guest's is, after a day", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const random = await start(ana);
    const daily = await start(ana, { today: '2026-12-10' });
    const guestOld = await start();
    const guestDaily = await start(undefined, { today: '2026-12-10' });
    vi.setSystemTime(Date.parse('2026-12-11T00:00:00Z'));
    const guestNew = await start();
    vi.setSystemTime(Date.parse('2026-12-11T13:00:00Z')); // the first three are a day and an hour old, guestNew 13 hours
    await start();
    expect(await row(random.id)).not.toBeNull();
    expect(await row(daily.id)).not.toBeNull();
    expect(await row(guestOld.id)).toBeNull();
    expect(await row(guestDaily.id)).toBeNull();
    expect(await row(guestNew.id)).not.toBeNull();
    vi.setSystemTime(Date.parse('2026-12-10T12:00:00Z') + 400 * DAY);
    await start();
    expect(await row(random.id)).not.toBeNull();
    expect(await row(daily.id)).not.toBeNull();
    expect(await row(guestNew.id)).toBeNull();
  });
});

describe('GET /api/me/progress', () => {
  it('GET /api/me/progress: 401 signed out; the evaluation of the rows signed in', async () => {
    expect((await progress()).status).toBe(401);
    at('2026-12-24T23:00:00Z');
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const empty = await json<ProgressResponse>(await progress(ana));
    expect(empty).toEqual({ ...evaluate({ treesLit: 0, runs: [], topTenDays: 0 }), treesLit: 0 });
    expect(empty.earned).toEqual([]);

    // 2026-12-25, 00:00 and on in UTC+1 (tz -60): Christmas Day there, by the Fireplace in secret mode.
    const fresh = await play(ana, { gap: 90, ctx: { tz: -60, station: 'fireplace', world: 'secret' } });
    later();
    const fast = await play(ana, { gap: 20, ctx: { tz: 0, station: null, world: null } }); // too fast: a tree lit, no time
    later();
    const open = await start(ana); // never finished
    const record = async (id: string, log: LogEntry[] | null, seed: number, result: FinishResult | null, ctx: RunContext | null): Promise<RunRecord> => {
      const r = await row(id);
      const facts = log && runFacts(seed, GEN_VERSION, log);
      return {
        started: Number(r?.started_at),
        finished: result && Number(r?.finished_at),
        ms: result && result.ms,
        reason: result && result.reason,
        imported: false,
        daily: null,
        past: false,
        turns: facts?.turns ?? null,
        minTurns: facts?.minTurns ?? null,
        feats: facts?.feats ?? null,
        pauses: result && 0,
        tz: ctx?.tz ?? null,
        station: ctx?.station ?? null,
        world: ctx?.world ?? null,
      };
    };
    const runs = [
      await record(fresh.game.id, fresh.log, fresh.game.seed, fresh.result, { tz: -60, station: 'fireplace', world: 'secret' }),
      await record(fast.game.id, fast.log, fast.game.seed, fast.result, { tz: 0, station: null, world: null }),
      await record(open.id, null, open.seed, null, null),
    ];
    const body = await json<ProgressResponse>(await progress(ana));
    expect(body).toEqual({ ...evaluate({ treesLit: 2, runs, topTenDays: 0 }), treesLit: 2 });
    // What that says: two trees lit; the fresh run's time, never the faster too-fast one; the reported context.
    expect(fast.result.ms).toBeLessThan(fresh.result.ms);
    expect(body.goals.m1).toEqual({ have: 1, need: 1, done: true });
    expect(body.goals.m5).toEqual({ have: 2, need: 5, done: false });
    expect(body.goals.s120.have).toBe(fresh.result.ms);
    expect(body.goals.xmasDay.done).toBe(true);
    expect(body.goals.eggSecret.done).toBe(true);
    expect(body.goals.fireplace100).toEqual({ have: 1, need: 100, done: false });
    expect(body.earned).toEqual(expect.arrayContaining(['decor:tinsel', 'palette:disco', 'garland:candlelight']));
    // Another account's rows are not yours.
    const bo = await signIn(env, 'bo@example.com');
    expect((await json<ProgressResponse>(await progress(bo))).treesLit).toBe(0);
  });

  it('progress counts imported runs as trees lit', async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const id = (await db.prepare("SELECT id FROM users WHERE email = 'ana@example.com'").first<{ id: number }>())?.id;
    // As the history import writes them (worker/routes/admin/history.ts): ranked, no log, source 'import'. Faster than any play.
    await db.batch(
      [1, 2, 3, 4].map((k) =>
        db
          .prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, paused_ms, pauses, ranked, source) VALUES (?, ?, 0, 0, ?, ?, 1000, 0, 0, 1, 'import')")
          .bind(`imported-${String(k).padStart(12, '0')}`, id, Date.now() - k * DAY - 1000, Date.now() - k * DAY),
      ),
    );
    const before = await json<ProgressResponse>(await progress(ana));
    expect(before.treesLit).toBe(4);
    expect(before.goals.m1.done).toBe(true);
    expect(before.goals.s120).toEqual({ have: 0, need: 120_000, done: false }); // imported runs count as trees lit, nothing else
    const { result } = await play(ana);
    const after = await json<ProgressResponse>(await progress(ana));
    expect(after.treesLit).toBe(5);
    expect(after.goals.m5).toEqual({ have: 5, need: 5, done: true });
    expect(after.earned).toEqual(expect.arrayContaining(['decor:tinsel', 'scene:midnight', 'decor:canes', 'presents:game']));
    expect(after.goals.s120.have).toBe(result.ms);
  });
});
