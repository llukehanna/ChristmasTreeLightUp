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

  it('a date the parser refuses (the future, or too close after local midnight) or a wrongly typed field is a 400, never a 503', async () => {
    const admin = await signIn(env, ADMIN, 'Tinsel');
    const tomorrow = dayText(localDayOf(Date.now(), 420) + 2);
    for (const bad of [body({ lastSolvedDay: tomorrow }), { ...body(), tz: '420' }, { ...body(), lastSolvedDay: 20260929 }, { ...body(), solved: null }]) {
      const res = await importAs(admin, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid' });
    }
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
