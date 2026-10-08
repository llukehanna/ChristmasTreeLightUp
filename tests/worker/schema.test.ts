import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../worker/lib/db';
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { fileURLToPath } from 'node:url';
import { startDb, statements, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(() => dispose());
beforeEach(() => wipe(db));

const count = async (sql: string): Promise<number> => (await db.prepare(sql).first<{ n: number }>())?.n ?? -1;

describe('migrations', () => {
  it('split into statements on ";" at a line end, without comments', () => {
    expect(statements('-- a comment\nCREATE TABLE a (x INTEGER);\nCREATE INDEX b ON a (x);\n')).toEqual(['CREATE TABLE a (x INTEGER)', 'CREATE INDEX b ON a (x)']);
  });

  it('create the tables and the indexes the spec names', async () => {
    const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all<{ name: string }>()).results.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['users', 'sessions', 'games', 'games_board', 'games_user', 'games_best', 'games_abandoned', 'starts', 'starts_ip', 'starts_at']));
  });

  it('games_board, games_best and games_abandoned are partial indexes', async () => {
    const sql = async (name: string) => (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first<{ sql: string }>())?.sql ?? '';
    expect(await sql('games_board')).toMatch(/WHERE ranked = 1$/);
    expect(await sql('games_best')).toMatch(/WHERE ranked = 1$/);
    expect(await sql('games_abandoned')).toMatch(/WHERE finished_at IS NULL$/);
  });

  it('deleting a user deletes their sessions and games (foreign keys cascade); signed-out games stay', async () => {
    const user = await db.prepare("INSERT INTO users (google_sub, email, created_at) VALUES ('g-1', 'a@example.com', 1) RETURNING id").first<{ id: number }>();
    if (!user) throw new Error('no user');
    await db.batch([
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', ?, 1, 2)").bind(user.id),
      db.prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at) VALUES ('owned-aaaaaaaaaaaaaa', ?, 1, 1, 1)").bind(user.id),
      db.prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at) VALUES ('anon-bbbbbbbbbbbbbbbb', NULL, 1, 1, 1)"),
    ]);
    await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    expect(await count('SELECT count(*) AS n FROM sessions')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM games')).toBe(1);
  });

  it('name_key is unique', async () => {
    await db.prepare("INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES ('g-1', 'a@example.com', 'Comet', 'comet', 1)").run();
    await expect(db.prepare("INSERT INTO users (google_sub, email, name, name_key, created_at) VALUES ('g-2', 'b@example.com', 'COMET', 'comet', 1)").run()).rejects.toThrow(/UNIQUE/);
  });

  it('games.source: play by default, import for imported runs, nothing else (migration 0002)', async () => {
    await db.prepare("INSERT INTO games (id, gen_version, seed, started_at) VALUES ('played-aaaaaaaaaaaaa', 1, 1, 1)").run();
    expect((await db.prepare("SELECT source FROM games WHERE id = 'played-aaaaaaaaaaaaa'").first<{ source: string }>())?.source).toBe('play');
    await db.prepare("INSERT INTO games (id, gen_version, seed, started_at, source) VALUES ('import-aaaaaaaaaaaaa', 0, 0, 1, 'import')").run();
    await expect(db.prepare("INSERT INTO games (id, gen_version, seed, started_at, source) VALUES ('bogus-aaaaaaaaaaaaaa', 0, 0, 1, 'bogus')").run()).rejects.toThrow(/CHECK/);
  });

  it('upgrading a database that already holds games (0001 → rows → 0002) makes those rows source play', async () => {
    const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: fileURLToPath(new URL('./wrangler.test.jsonc', import.meta.url)), persist: false });
    try {
      const old = proxy.env.DB;
      const run = (file: string) => old.batch(statements(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).map((s) => old.prepare(s)));
      await run('0001_init.sql');
      await old.prepare("INSERT INTO games (id, gen_version, seed, started_at) VALUES ('before-aaaaaaaaaaaaaa', 1, 1, 1)").run();
      await old.prepare("INSERT INTO games (id, gen_version, seed, started_at, finished_at, ms, ranked) VALUES ('before-bbbbbbbbbbbbbb', 1, 1, 1, 2, 1, 1)").run();
      await run('0002_history_import.sql');
      const rows = (await old.prepare('SELECT id, source FROM games ORDER BY id').all<{ id: string; source: string }>()).results;
      expect(rows).toEqual([
        { id: 'before-aaaaaaaaaaaaaa', source: 'play' },
        { id: 'before-bbbbbbbbbbbbbb', source: 'play' },
      ]);
    } finally {
      await proxy.dispose();
    }
  });
});
