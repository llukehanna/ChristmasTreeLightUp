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
/** The only ip_hash in `starts` (after a single start). */
const startsHash = async () => String((await db.prepare('SELECT DISTINCT ip_hash FROM starts').first<{ ip_hash: string }>())?.ip_hash);
const fillStarts = (ipHash: string, n: number, at = Date.now()) =>
  db.batch(Array.from({ length: n }, () => db.prepare('INSERT INTO starts (ip_hash, at) VALUES (?, ?)').bind(ipHash, at)));
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
    expect(await startsHash()).not.toContain('203.0.113.7'); // only an HMAC of the IP
    const ana = await signIn(env, 'ana@example.com');
    expect((await start(ana)).claim).toBeNull();
  });

  it('limits starts per IP per hour (429), counting only that IP and only the last hour', async () => {
    await start();
    const ipHash = await startsHash();
    await fillStarts(ipHash, STARTS_PER_HOUR - 1);
    const limited = await call(env, 'POST', '/api/games', {});
    expect(limited.status).toBe(429);
    expect((await json<{ error: string }>(limited)).error).toBe('rate_limited');
    expect((await call(env, 'POST', '/api/games', { ip: '198.51.100.9' })).status).toBe(200);
    await db.prepare('UPDATE starts SET at = at - 3600001').run();
    expect((await call(env, 'POST', '/api/games', {})).status).toBe(200);
  });

  it('a start still counts after its game is deleted by a 422', async () => {
    await start();
    await fillStarts(await startsHash(), STARTS_PER_HOUR - 2);
    const last = await start(); // the 200th
    expect((await call(env, 'POST', `/api/games/${last.id}/finish`, { body: { log: [{ t: 0, a: 'nope' }] } })).status).toBe(422);
    expect(await row(last.id)).toBeNull();
    expect((await call(env, 'POST', '/api/games', {})).status).toBe(429);
  });

  it('IPv6 starts share a limit per /64, however the address is written; another /64 has its own', async () => {
    await start(undefined, '2001:db8:aa:1::1');
    await fillStarts(await startsHash(), STARTS_PER_HOUR - 1);
    for (const ip of ['2001:DB8:AA:1:ffff:0:0:2', '2001:0db8:00aa:0001::9', '2001:db8:aa:1:0:0:0:0']) {
      expect((await call(env, 'POST', '/api/games', { ip })).status, ip).toBe(429);
    }
    expect((await call(env, 'POST', '/api/games', { ip: '2001:db8:aa:2::1' })).status).toBe(200);
    expect((await call(env, 'POST', '/api/games', { ip: '203.0.113.7' })).status).toBe(200);
  });

  it('prunes starts older than an hour, at most 50 per start', async () => {
    await fillStarts('old', 120, Date.now() - 3_600_001);
    await fillStarts('recent', 5, Date.now() - 3_000_000);
    await start();
    const n = async (h: string) => (await db.prepare('SELECT count(*) AS n FROM starts WHERE ip_hash = ?').bind(h).first<{ n: number }>())?.n;
    expect(await n('old')).toBe(70);
    expect(await n('recent')).toBe(5);
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
        db.prepare("INSERT INTO games (id, gen_version, seed, started_at, finished_at) VALUES (?, 1, 1, ?, ?)").bind(`stale-${String(i).padStart(12, '0')}`, old, i % 2 ? old : null),
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

  it('the start limit and its pruning read through indexes, not a scan of every start', async () => {
    const plan = async (sql: string) => JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind('h', 1).all()).results);
    expect(await plan('SELECT count(*) AS n FROM starts WHERE ip_hash = ? AND at > ?')).toContain('starts_ip');
    expect(await plan('SELECT rowid FROM starts WHERE at < ? LIMIT ?')).toContain('starts_at');
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
    // "#r of 2": the board has 1 run, and this one would join it.
    expect(anon.result).toMatchObject({ ranked: false, reason: 'anonymous', rank: expect.any(Number), total: 2, best: null, newBest: false });
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const { results } = await claim(ana, [{ id: anon.game.id, claim: anon.game.claim }]);
    expect(results).toEqual([{ ...anon.result, ranked: true, reason: null, total: 2, best: anon.result.ms, newBest: true }]);
    expect(await row(anon.game.id)).toMatchObject({ claim_hash: null, ranked: 1, unranked_reason: null });
  });

  it('ranked but off the board (no name yet): the rank counts this run in the total', async () => {
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    await play(bo);
    const ana = await signIn(env, 'ana@example.com');
    const { result } = await play(ana);
    expect(result).toMatchObject({ ranked: true, reason: null, total: 2, best: result.ms, newBest: true });
    expect(result.rank).toBeLessThanOrEqual(2);
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

  it('a full claim request stays within a D1 query budget (Workers Free allows 50)', async () => {
    const runs = [];
    for (let k = 0; k < 8; k++) runs.push(await play());
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
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.ranked && r.total === 8)).toBe(true);
    expect(statements).toBeLessThanOrEqual(30);
  });
});
