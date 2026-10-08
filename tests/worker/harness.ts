import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { Db } from '../../worker/lib/db';
import type { AppEnv } from '../../worker/lib/env';
import { handle } from '../../worker/router';
import { FakeBucket } from '../unit/worker/fake-bucket';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
/** Fake sign-in only works on localhost, so tests talk to this origin unless they pass `base`. */
export const ORIGIN = 'http://localhost';

/** The statements of a migration file, in order. Each ends with ";" at the end of a line. */
export function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A real local D1 (wrangler's miniflare, in memory) with every migration applied. One per test file. */
export async function startDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: Db }>({
    configPath: fileURLToPath(new URL('./wrangler.test.jsonc', import.meta.url)),
    persist: false,
  });
  const db = proxy.env.DB;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.batch(statements(readFileSync(new URL(file, MIGRATIONS), 'utf8')).map((s) => db.prepare(s)));
  }
  return { db, dispose: proxy.dispose };
}

export async function wipe(db: Db): Promise<void> {
  await db.batch(['games', 'sessions', 'users'].map((t) => db.prepare(`DELETE FROM ${t}`)));
}

export function testEnv(db: Db, over: Partial<AppEnv> = {}): AppEnv {
  return {
    DB: db,
    MUSIC: new FakeBucket(),
    MUSIC_BASE_URL: 'https://aglow-music.example',
    AUTH_MODE: 'fake',
    AUTH_SECRET: 'test-auth-secret-not-real',
    GOOGLE_CLIENT_ID: 'client-123',
    GOOGLE_CLIENT_SECRET: 'test-client-secret-not-real',
    ADMIN_EMAILS: 'admin@example.com',
    ...over,
  };
}

/** Signs in through fake mode (the whole redirect dance) and optionally picks a name. Returns "__Host-aglow_session=…". */
export async function signIn(env: AppEnv, email: string, name?: string): Promise<string> {
  const start = await call(env, 'GET', `/api/auth/google?return=/&as=${encodeURIComponent(email)}`);
  const to = new URL(start.headers.get('Location') ?? '');
  const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
  const session = back.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-aglow_session='))
    ?.split(';')[0];
  if (!session) throw new Error(`fake sign-in failed for ${email}`);
  if (name) {
    const res = await call(env, 'POST', '/api/auth/name', { cookie: session, body: { name } });
    if (!res.ok) throw new Error(`could not name ${email}: ${res.status}`);
  }
  return session;
}

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  /** null: send no Origin header. */
  origin?: string | null;
  ip?: string;
  /** Another site, e.g. to test real-Google mode or the fake-mode guard. */
  base?: string;
}

/** One request through the Worker's router. Writes are same-origin JSON unless told otherwise. */
export function call(env: AppEnv, method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const base = opts.base ?? ORIGIN;
  const headers = new Headers({ 'CF-Connecting-IP': opts.ip ?? '203.0.113.7' });
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const write = method !== 'GET';
  if (write) headers.set('Content-Type', 'application/json');
  if (write && opts.origin !== null) headers.set('Origin', opts.origin ?? base);
  const req = new Request(base + path, { method, headers, body: write ? JSON.stringify(opts.body ?? {}) : undefined });
  return handle(req, env, { waitUntil: () => undefined });
}

/** "name=value" pairs from a response's Set-Cookie headers, ready to send back. */
export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
