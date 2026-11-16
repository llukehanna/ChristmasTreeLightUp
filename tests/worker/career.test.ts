import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAREER_DAILY_FIRST, CAREER_IMPORTED, CAREER_PAST, CAREER_REPLAY, type CareerResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { dayNumber } from '../../worker/lib/days';
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

interface Seed {
  finishedAt: number | null;
  ms?: number | null;
  turns?: number | null;
  minTurns?: number | null;
  source?: 'play' | 'import';
  reason?: string | null;
  day?: string | null;
  past?: boolean;
  log?: string | null;
}
let runs = 0;
/** A game straight into D1: finished unless `finishedAt` is null; ranked when it has no reason. */
async function run(userId: number, s: Seed): Promise<string> {
  const id = `run-${String(++runs).padStart(16, '0')}`;
  const reason = s.reason ?? null;
  await db
    .prepare('INSERT INTO games (id, user_id, gen_version, seed, started_at, finished_at, ms, turns, min_turns, source, ranked, unranked_reason, daily_day, daily_past, log) VALUES (?, ?, 1, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, s.finishedAt, s.ms ?? (s.finishedAt === null ? null : 5000), s.turns ?? null, s.minTurns ?? null, s.source ?? 'play', reason === null && s.finishedAt !== null ? 1 : 0, reason, s.day ? dayNumber(s.day) : null, s.past ? 1 : 0, s.log ?? null)
    .run();
  return id;
}
const career = (cookie?: string) => call(env, 'GET', '/api/me/career', { cookie });
const body = async (cookie: string): Promise<CareerResponse> => (await career(cookie)).json() as Promise<CareerResponse>;

describe('GET /api/me/career', () => {
  it('requires a user', async () => {
    expect((await career()).status).toBe(401);
  });

  it("returns every finished run, oldest first, and no one else's", async () => {
    const ana = await user('ana@example.com', 'Ana');
    const cookie = await signIn(env, 'ana@example.com');
    const bob = await user('bob@example.com', 'Bob');
    const late = await run(ana, { finishedAt: 3000 });
    const early = await run(ana, { finishedAt: 1000 });
    const mid = await run(ana, { finishedAt: 2000 });
    await run(ana, { finishedAt: null });
    await run(bob, { finishedAt: 1500 });
    await run(bob, { finishedAt: 2500 });
    const res = await body(cookie);
    expect(res.runs.map((r) => r[0])).toEqual([early, mid, late]);
    expect(res.runs.map((r) => r[1])).toEqual([1000, 2000, 3000]);
  });

  it('gives the fields and flags of each row', async () => {
    const ana = await user('ana@example.com', 'Ana');
    const cookie = await signIn(env, 'ana@example.com');
    const imported = await run(ana, { finishedAt: 1000, ms: 61000, source: 'import' });
    const played = await run(ana, { finishedAt: 2000, ms: 52000, turns: 40, minTurns: 31, log: '[]' });
    const past = await run(ana, { finishedAt: 3000, ms: 70000, turns: 22, minTurns: 22, reason: 'past', day: '2026-11-10', past: true, log: '[]' });
    const unranked = await run(ana, { finishedAt: 4000, ms: 900, reason: 'too_fast' });
    const rows = Object.fromEntries((await body(cookie)).runs.map((r) => [r[0], r]));
    expect(rows[imported]).toEqual([imported, 1000, 61000, null, null, CAREER_IMPORTED, null, null]);
    expect(rows[played]).toEqual([played, 2000, 52000, 40, 31, CAREER_REPLAY, null, null]);
    expect(rows[past]).toEqual([past, 3000, 70000, 22, 22, CAREER_REPLAY | CAREER_PAST, 'past', '2026-11-10']);
    expect(rows[unranked]).toEqual([unranked, 4000, 900, null, null, 0, 'too_fast', null]);
  });

  it("marks a live Daily first attempt, not a repeat, a past day's tree or a random run", async () => {
    const ana = await user('ana@example.com', 'Ana');
    const cookie = await signIn(env, 'ana@example.com');
    const first = await run(ana, { finishedAt: 1000, reason: 'daily', day: '2026-11-10' });
    const repeat = await run(ana, { finishedAt: 2000, reason: 'daily', day: '2026-11-10' });
    const other = await run(ana, { finishedAt: 3000, reason: 'daily', day: '2026-11-11' });
    const past = await run(ana, { finishedAt: 4000, reason: 'past', day: '2026-11-09', past: true });
    const random = await run(ana, { finishedAt: 5000 });
    const flags = Object.fromEntries((await body(cookie)).runs.map((r) => [r[0], (r[5] & CAREER_DAILY_FIRST) !== 0]));
    expect(flags).toEqual({ [first]: true, [repeat]: false, [other]: true, [past]: false, [random]: false });
  });

  it('gives the ranked best, its place and how many of the top are yours', async () => {
    const ana = await user('ana@example.com', 'Ana');
    const cookie = await signIn(env, 'ana@example.com');
    const bob = await user('bob@example.com', 'Bob');
    await run(bob, { finishedAt: 1000, ms: 40000 });
    await run(ana, { finishedAt: 2000, ms: 45000 });
    const best = await run(ana, { finishedAt: 3000, ms: 41000 });
    await run(bob, { finishedAt: 4000, ms: 50000 });
    await run(ana, { finishedAt: 5000, ms: 500, reason: 'too_fast' });
    const res = await body(cookie);
    expect(res.best).toEqual({ id: best, ms: 41000, rank: 2 });
    expect(res.inTop).toBe(2);
    expect(res.total).toBe(4);
  });

  it('has no best for an account without a ranked run, and no place without a name', async () => {
    const ana = await user('ana@example.com', null);
    const cookie = await signIn(env, 'ana@example.com');
    await run(ana, { finishedAt: 1000, ms: 900, reason: 'too_fast' });
    expect(await body(cookie)).toMatchObject({ best: null, inTop: 0, total: 0 });
    const best = await run(ana, { finishedAt: 2000, ms: 30000 });
    expect((await body(cookie)).best).toEqual({ id: best, ms: 30000, rank: null });
  });

  it('is not cached', async () => {
    await user('ana@example.com', 'Ana');
    const cookie = await signIn(env, 'ana@example.com');
    expect((await career(cookie)).headers.get('Cache-Control')).toBe('private, no-store');
  });
});
