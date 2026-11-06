import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRequest, StartResponse } from '../../src/api/types';
import { dailySeed } from '../../worker/lib/daily';
import { dayNumber } from '../../worker/lib/days';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { authSecret } from '../../worker/lib/users';
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
    ]) {
      const res = await startDaily(daily as DailyRequest);
      expect(res.status, JSON.stringify(daily)).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'invalid', message: "That day's tree isn't open." });
    }
    expect((await startDaily({ today: '2026-12-10', day: '2026-11-01' })).status).toBe(200);
    expect((await db.prepare('SELECT count(*) AS n FROM games').first<{ n: number }>())?.n).toBe(1);
  });

  it("a signed-in player's second start of the day says repeat:true; a past start of the same day does not count as their live attempt", async () => {
    at('2026-12-10T12:00:00Z');
    const ana = await signIn(env, 'ana@example.com');
    const bea = await signIn(env, 'bea@example.com');
    const past = await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-09' }, ana));
    expect(past.daily?.repeat).toBe(false);
    const live = await json<StartResponse>(await startDaily({ today: '2026-12-09' }, ana));
    expect(live.daily).toEqual({ day: '2026-12-09', past: false, repeat: false });
    const again = await json<StartResponse>(await startDaily({ today: '2026-12-09' }, ana));
    expect(again.daily?.repeat).toBe(true);
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-09' }, ana))).daily).toEqual({ day: '2026-12-09', past: true, repeat: true });
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-09' }, bea))).daily?.repeat).toBe(false);
    // Guests are never repeats.
    await startDaily({ today: '2026-12-09' });
    expect((await json<StartResponse>(await startDaily({ today: '2026-12-09' }))).daily?.repeat).toBe(false);
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

  it('an unfinished daily game survives the one-day housekeeping and is deleted after three days; an unfinished random game still goes after one', async () => {
    at('2026-12-10T12:00:00Z');
    const daily = await json<StartResponse>(await startDaily({ today: '2026-12-10' }));
    const dailyOld = await json<StartResponse>(await startDaily({ today: '2026-12-10', day: '2026-12-09' }));
    const random = await json<StartResponse>(await startDaily(undefined));
    const age = (id: string, days: number) => db.prepare('UPDATE games SET started_at = ? WHERE id = ?').bind(Date.now() - days * DAY, id).run();
    await age(daily.id, 2);
    await age(dailyOld.id, 4);
    await age(random.id, 2);
    await startDaily(undefined);
    expect(await row(daily.id)).not.toBeNull();
    expect(await row(dailyOld.id)).toBeNull();
    expect(await row(random.id)).toBeNull();
    await age(daily.id, 3.5);
    await startDaily(undefined);
    expect(await row(daily.id)).toBeNull();
  });
});
