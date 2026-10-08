import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse } from '../../src/api/types';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { call, signIn, startDb, statements, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
let env: AppEnv;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
  env = testEnv(db);
});
afterAll(() => dispose());
beforeEach(() => wipe(db));

const me = async (cookie?: string) => (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponse;
const put = (cookie: string | undefined, body: unknown, origin?: string | null) => call(env, 'PUT', '/api/me/star-head', { cookie, body, origin });

describe('migration 0003 (star_head)', () => {
  it('adds users.star_head: 0 for accounts that already exist, 0 or 1 only', async () => {
    const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: fileURLToPath(new URL('./wrangler.test.jsonc', import.meta.url)), persist: false });
    try {
      const old = proxy.env.DB;
      const run = (file: string) => old.batch(statements(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).map((s) => old.prepare(s)));
      await run('0001_init.sql');
      await run('0002_history_import.sql');
      await old.prepare("INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES ('g-1', 'a@example.com', 'Comet', 'comet', 1)").run();
      await run('0003_star_head.sql');
      expect(await old.prepare('SELECT name, star_head FROM users').all()).toMatchObject({ results: [{ name: 'Comet', star_head: 0 }] });
      await old.prepare("UPDATE users SET star_head = 1 WHERE google_sub = 'g-1'").run();
      await expect(old.prepare("UPDATE users SET star_head = 2 WHERE google_sub = 'g-1'").run()).rejects.toThrow(/CHECK/);
    } finally {
      await proxy.dispose();
    }
  });
});

describe('PUT /api/me/star-head', () => {
  it('401 signed out', async () => {
    const res = await put(undefined, { on: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'signed_out' });
  });

  it('403 cross-origin or without an Origin', async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    expect((await put(cookie, { on: true }, 'https://evil.example')).status).toBe(403);
    expect((await put(cookie, { on: true }, null)).status).toBe(403);
    expect((await me(cookie)).user?.starHead).toBe(false);
  });

  it('400 unless the body is { on: boolean }', async () => {
    const cookie = await signIn(env, 'ana@example.com', 'Meridian');
    for (const bad of [{}, { on: 1 }, { on: 'true' }, { on: null }, [true], 'on']) {
      const res = await put(cookie, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await me(cookie)).user?.starHead).toBe(false);
  });

  it('sets it both ways, answers { starHead }, and /api/me follows; other accounts are untouched', async () => {
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const bo = await signIn(env, 'bo@example.com', 'Comet');
    expect(await me(ana)).toEqual({ user: { name: 'Meridian', isAdmin: false, starHead: false } });
    const on = await put(ana, { on: true });
    expect(on.status).toBe(200);
    expect(on.headers.get('Cache-Control')).toBe('no-store');
    expect(await on.json()).toEqual({ starHead: true });
    expect((await me(ana)).user?.starHead).toBe(true);
    expect((await me(bo)).user?.starHead).toBe(false);
    expect(await (await put(ana, { on: false })).json()).toEqual({ starHead: false });
    expect((await me(ana)).user?.starHead).toBe(false);
  });

  it('works before a name is picked, and the name answer carries it', async () => {
    const cookie = await signIn(env, 'ana@example.com');
    expect((await put(cookie, { on: true })).status).toBe(200);
    const named = await call(env, 'POST', '/api/auth/name', { cookie, body: { name: 'Meridian' } });
    expect(await named.json()).toEqual({ user: { name: 'Meridian', isAdmin: false, starHead: true } });
  });

  it('GET is 405', async () => {
    const res = await call(env, 'GET', '/api/me/star-head', { cookie: await signIn(env, 'ana@example.com') });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('PUT');
  });
});
