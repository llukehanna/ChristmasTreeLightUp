import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAME_RULE } from '../../src/api/names';
import type { MeResponse } from '../../src/api/types';
import type { Db, DbStatement } from '../../worker/lib/db';
import { checkIdToken, safeReturn } from '../../worker/routes/auth';
import { call, cookiesFrom, signIn, startDb, testEnv, wipe } from './harness';

let db: Db;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(() => dispose());
beforeEach(() => wipe(db));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SITE = 'https://aglow.lukeghanna.com';
const idToken = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const goodClaims = { iss: 'https://accounts.google.com', aud: 'client-123', exp: Date.now() / 1000 + 600, sub: 'g-1', email: 'Ana@Example.com', email_verified: true };
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;
const sessionOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-aglow_session='))?.split(';')[0] ?? '';
const me = async (cookie?: string, env = testEnv(db)) => (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponse;
const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

/** Real-Google sign-in with Google's token endpoint stubbed: start, then the callback with `query`. */
async function googleRound(query: (state: string) => string, token: () => Promise<Response>, ret = '/admin') {
  const env = testEnv(db, { AUTH_MODE: 'google' });
  vi.stubGlobal('fetch', vi.fn(token));
  const start = await call(env, 'GET', `/api/auth/google?return=${encodeURIComponent(ret)}`, { base: SITE });
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state') ?? '';
  return call(env, 'GET', `/api/auth/google/callback?${query(state)}`, { base: SITE, cookie: cookiesFrom(start) });
}

describe('pure helpers', () => {
  it('safeReturn keeps same-site paths only', () => {
    expect(safeReturn('/admin')).toBe('/admin');
    expect(safeReturn('/?x=1#y')).toBe('/?x=1#y');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com', '/\n/evil.com', '/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', null, '', 'admin']) {
      expect(safeReturn(bad), String(bad)).toBe('/');
    }
    expect(safeReturn('/ /evil.com')).toBe('/%20/evil.com');
  });

  it('safeReturn drops a stale auth=failed, keeping the rest of the query', () => {
    expect(safeReturn('/?auth=failed')).toBe('/');
    expect(safeReturn('/admin?x=1&auth=failed#y')).toBe('/admin?x=1#y');
    expect(safeReturn('/?x=a%20b')).toBe('/?x=a%20b'); // untouched without an auth param
  });

  it('checkIdToken accepts only Google tokens for this app with a verified email', () => {
    const now = Date.now();
    expect(checkIdToken(idToken(goodClaims), 'client-123', now)).toEqual({ sub: 'g-1', email: 'ana@example.com' });
    expect(checkIdToken(idToken({ ...goodClaims, iss: 'accounts.google.com' }), 'client-123', now)).not.toBeNull();
    for (const bad of [{ aud: 'other' }, { iss: 'https://evil.com' }, { exp: now / 1000 - 1 }, { email_verified: false }, { email_verified: 'true' }, { sub: 5 }]) {
      expect(checkIdToken(idToken({ ...goodClaims, ...bad }), 'client-123', now), JSON.stringify(bad)).toBeNull();
    }
    expect(checkIdToken('garbage', 'client-123', now)).toBeNull();
  });
});

describe('Google sign-in', () => {
  it('sends you to Google with PKCE (S256), a state, and a 10-minute flow cookie', async () => {
    const res = await call(testEnv(db, { AUTH_MODE: 'google' }), 'GET', '/api/auth/google?return=/admin', { base: SITE });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('Location') ?? '');
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      client_id: 'client-123',
      redirect_uri: `${SITE}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-aglow_oauth=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.%2Fadmin; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    const verifier = (res.headers.get('Set-Cookie') ?? '').split('=')[1].split('.')[1];
    expect(to.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('exchanges the code, creates the user and a session, and goes back where you were', async () => {
    const token = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id_token: idToken(goodClaims) }));
    const env = testEnv(db, { AUTH_MODE: 'google' });
    vi.stubGlobal('fetch', token);
    const start = await call(env, 'GET', '/api/auth/google?return=/admin', { base: SITE });
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
    const back = await call(env, 'GET', `/api/auth/google/callback?code=abc&state=${state}`, { base: SITE, cookie: cookiesFrom(start) });
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe('/admin');
    expect(token.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const sent = token.mock.calls[0][1].body as URLSearchParams;
    expect(Object.fromEntries(sent)).toMatchObject({ code: 'abc', client_id: 'client-123', redirect_uri: `${SITE}/api/auth/google/callback`, grant_type: 'authorization_code' });
    expect(sent.get('code_verifier')).toHaveLength(43);
    const cookies = back.headers.getSetCookie();
    expect(cookies).toContain('__Host-aglow_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    expect(cookies.find((c) => c.startsWith('__Host-aglow_session='))).toMatch(/^__Host-aglow_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/);
    expect(await db.prepare('SELECT google_sub, email, name FROM users').first()).toEqual({ google_sub: 'g-1', email: 'ana@example.com', name: null });
    // Only an HMAC of the token is stored.
    expect((await db.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>())?.token_hash).not.toBe(sessionOf(back).split('=')[1]);
    expect(await me(sessionOf(back), env)).toEqual({ user: { name: null, isAdmin: false } });
  });

  it('fails back to the page with ?auth=failed: wrong state, refused or bad token, unverified email, a cancel, no flow cookie', async () => {
    const ok = async () => Response.json({ id_token: idToken(goodClaims) });
    const cases: [(s: string) => string, () => Promise<Response>][] = [
      [() => 'code=abc&state=wrong', ok],
      [(s) => `code=abc&state=${s}`, async () => new Response('no', { status: 400 })],
      [(s) => `code=abc&state=${s}`, async () => Response.json({ id_token: idToken({ ...goodClaims, aud: 'someone-else' }) })],
      [(s) => `code=abc&state=${s}`, async () => Response.json({ id_token: idToken({ ...goodClaims, email_verified: false }) })],
      [(s) => `code=abc&state=${s}`, async () => Promise.reject(new TypeError('network'))],
      [(s) => `error=access_denied&state=${s}`, ok],
    ];
    for (const [query, token] of cases) {
      const res = await googleRound(query, token);
      expect(res.headers.get('Location')).toBe('/admin?auth=failed');
      expect(sessionOf(res)).toBe('');
    }
    const lost = await call(testEnv(db, { AUTH_MODE: 'google' }), 'GET', '/api/auth/google/callback?code=abc&state=x', { base: SITE });
    expect(lost.headers.get('Location')).toBe('/?auth=failed');
    expect(await count('users')).toBe(0);
  });

  it('?auth=failed joins a return path that already has a query', async () => {
    const res = await googleRound(() => 'code=abc&state=wrong', async () => Response.json({ id_token: idToken(goodClaims) }), '/admin?x=1#top');
    expect(res.headers.get('Location')).toBe('/admin?x=1&auth=failed#top');
  });

  it('a sign-in started from /?auth=failed comes back without it', async () => {
    const env = testEnv(db);
    const start = await call(env, 'GET', `/api/auth/google?return=${encodeURIComponent('/?x=1&auth=failed')}&as=ana@example.com`);
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
    expect(back.headers.get('Location')).toBe('/?x=1');
    expect(sessionOf(back)).not.toBe('');
  });

  it('in google mode a fake: code is just a code: it goes to Google and never signs in as that email', async () => {
    const empty = await googleRound((s) => `code=${encodeURIComponent('fake:x@y.z')}&state=${s}`, async () => Response.json({}));
    expect(empty.headers.get('Location')).toBe('/admin?auth=failed');
    expect(sessionOf(empty)).toBe('');
    const google = vi.fn(async () => Response.json({ id_token: idToken(goodClaims) }));
    const res = await googleRound((s) => `code=${encodeURIComponent('fake:x@y.z')}&state=${s}`, google);
    expect(google).toHaveBeenCalledTimes(1);
    expect(res.headers.get('Location')).toBe('/admin');
    expect(await db.prepare('SELECT google_sub, email FROM users').all()).toMatchObject({ results: [{ google_sub: 'g-1', email: 'ana@example.com' }] });
  });

  it('a missing GOOGLE_CLIENT_SECRET or AUTH_SECRET fails sign-in and logs not_configured, without values', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const over of [{ GOOGLE_CLIENT_SECRET: undefined }, { AUTH_SECRET: ' ' }]) {
      log.mockClear();
      const env = testEnv(db, { AUTH_MODE: 'google', ...over });
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id_token: idToken(goodClaims) })));
      const start = await call(env, 'GET', '/api/auth/google?return=/admin', { base: SITE });
      const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
      const back = await call(env, 'GET', `/api/auth/google/callback?code=abc&state=${state}`, { base: SITE, cookie: cookiesFrom(start) });
      expect(back.headers.get('Location'), JSON.stringify(over)).toBe('/admin?auth=failed');
      expect(log.mock.calls, JSON.stringify(over)).toEqual([['api', 'auth', 'not_configured']]);
    }
    expect(await count('users')).toBe(0);
  });

  it('a failed account write goes back with ?auth=failed and logs only the error class', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: Db = { prepare: (q) => db.prepare(q), batch: async () => Promise.reject(new TypeError('D1 is down: secret-ish detail')) };
    const env = testEnv(broken);
    const start = await call(env, 'GET', '/api/auth/google?return=/admin&as=ana@example.com');
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe('/admin?auth=failed');
    expect(sessionOf(back)).toBe('');
    expect(log.mock.calls).toEqual([['api', 'auth', 'callback', 'TypeError']]);
  });

  it('signing in prunes expired sessions', async () => {
    const env = testEnv(db);
    await signIn(env, 'ana@example.com');
    await db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    await signIn(env, 'bo@example.com');
    expect(await count('sessions')).toBe(1);
    expect(await db.prepare('SELECT u.email FROM sessions s JOIN users u ON u.id = s.user_id').first()).toEqual({ email: 'bo@example.com' });
  });

  it('a returning Google account is the same user, with its email refreshed', async () => {
    const env = testEnv(db);
    await signIn(env, 'ana@example.com', 'Meridian');
    await db.prepare("UPDATE users SET google_sub = 'fake:new@example.com'").run();
    const again = await signIn(env, 'new@example.com');
    expect(await me(again)).toEqual({ user: { name: 'Meridian', isAdmin: false } });
    expect(await db.prepare('SELECT email FROM users').first()).toEqual({ email: 'new@example.com' });
    expect(await count('users')).toBe(1);
  });

  it("signing in again revokes the browser's previous session", async () => {
    const env = testEnv(db);
    const first = await signIn(env, 'ana@example.com');
    const start = await call(env, 'GET', '/api/auth/google?return=/&as=ana@example.com', { cookie: first });
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: `${first}; ${cookiesFrom(start)}` });
    expect(sessionOf(back)).not.toBe(first);
    expect(await me(first)).toEqual({ user: null });
    expect(await count('sessions')).toBe(1);
  });

  it('fake mode signs in as ?as= or the aglow_fake_as cookie, and needs a plausible email', async () => {
    const env = testEnv(db);
    const viaCookie = await call(env, 'GET', '/api/auth/google?return=/', { cookie: 'aglow_fake_as=bo@example.com' });
    expect(new URL(viaCookie.headers.get('Location') ?? '').searchParams.get('code')).toBe('fake:bo@example.com');
    const start = await call(env, 'GET', '/api/auth/google?return=/&as=not-an-email');
    const to = new URL(start.headers.get('Location') ?? '');
    const back = await call(env, 'GET', to.pathname + to.search, { cookie: cookiesFrom(start) });
    expect(back.headers.get('Location')).toBe('/?auth=failed');
  });

  it('fake mode is refused for every route anywhere but localhost', async () => {
    for (const path of ['/api/me', '/api/auth/google?as=x@y.z', '/api/auth/google/callback?code=fake:x@y.z&state=s', '/api/stations']) {
      const res = await call(testEnv(db), 'GET', path, { base: SITE });
      expect(res.status, path).toBe(500);
      expect(await body(res)).toEqual({ error: 'misconfigured', message: 'Sign-in is misconfigured.' });
    }
  });
});

describe('sessions', () => {
  it('GET /api/me renews a session with under 182 days left, and only then', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    expect((await call(env, 'GET', '/api/me', { cookie: s })).headers.get('Set-Cookie')).toBeNull();
    await db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 100 * 86_400_000).run();
    const renewed = await call(env, 'GET', '/api/me', { cookie: s });
    expect(renewed.headers.get('Set-Cookie')).toBe(`${s}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
    const row = await db.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThan(Date.now() + 364 * 86_400_000);
  });

  it('an expired, unknown or malformed session is signed out', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    await db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect(await me(s)).toEqual({ user: null });
    expect(await me(`__Host-aglow_session=${'x'.repeat(43)}`)).toEqual({ user: null });
    expect(await me('__Host-aglow_session=short')).toEqual({ user: null });
  });

  it('sign-out deletes the session and clears the cookie', async () => {
    const env = testEnv(db);
    const s = await signIn(env, 'ana@example.com');
    const res = await call(env, 'POST', '/api/auth/signout', { cookie: s });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBe('__Host-aglow_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    expect(await count('sessions')).toBe(0);
    expect(await me(s)).toEqual({ user: null });
  });

  it('isAdmin follows ADMIN_EMAILS (comma-separated, any case, spaces ignored)', async () => {
    const env = testEnv(db, { ADMIN_EMAILS: ' other@example.com , ANA@example.com ' });
    const s = await signIn(env, 'ana@example.com');
    expect(await me(s, env)).toEqual({ user: { name: null, isAdmin: true } });
    expect(await me(s, testEnv(db, { ADMIN_EMAILS: undefined }))).toEqual({ user: { name: null, isAdmin: false } });
  });

  it('without AUTH_SECRET: signed-out calls still work, a session cookie gets 503 not_configured', async () => {
    const env = testEnv(db, { AUTH_SECRET: undefined });
    expect(await me(undefined, env)).toEqual({ user: null });
    const res = await call(env, 'GET', '/api/me', { cookie: `__Host-aglow_session=${'x'.repeat(43)}` });
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe('not_configured');
  });

  it('writes need same-origin JSON; unknown paths are 404 and wrong methods 405', async () => {
    const env = testEnv(db);
    expect((await call(env, 'POST', '/api/auth/signout', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'POST', '/api/auth/signout', { origin: null })).status).toBe(403);
    expect((await call(env, 'GET', '/api/nope')).status).toBe(404);
    expect((await call(env, 'GET', '/api/auth/signout')).status).toBe(405);
  });
});

describe('names', () => {
  it('checks a name: invalid, reserved, taken (any case) or available', async () => {
    const env = testEnv(db);
    await signIn(env, 'bo@example.com', 'Comet');
    const check = async (n: string) => body(await call(env, 'GET', `/api/auth/name?n=${encodeURIComponent(n)}`));
    expect(await check('ab')).toEqual({ available: false, reason: 'invalid' });
    expect(await check('s-a n_t a')).toEqual({ available: false, reason: 'reserved' });
    expect(await check('comet')).toEqual({ available: false, reason: 'taken' });
    expect(await check('  Tinsel Tom ')).toEqual({ available: true });
  });

  it('sets the name once; a name taken in between is 409 and the card can try another', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    await signIn(env, 'bo@example.com', 'Comet');
    const taken = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'COMET' } });
    expect(taken.status).toBe(409);
    expect(await body(taken)).toEqual({ error: 'taken', message: 'That name is taken.' });
    const ok = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: ' Tinsel Tom ' } });
    expect(await body(ok)).toEqual({ user: { name: 'Tinsel Tom', isAdmin: false } });
    const again = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Other Name' } });
    expect(again.status).toBe(409);
    expect((await body(again)).error).toBe('has_name');
  });

  it('names that differ only by case, spaces, - or _ collide: taken in the check and 409 on set', async () => {
    const env = testEnv(db);
    await signIn(env, 'bo@example.com', 'Tinsel Tom');
    const check = async (n: string) => body(await call(env, 'GET', `/api/auth/name?n=${encodeURIComponent(n)}`));
    for (const n of ['tinsel-tom', 'Tinsel_Tom', 'TinselTom', 'tinsel tom']) expect(await check(n), n).toEqual({ available: false, reason: 'taken' });
    const ana = await signIn(env, 'ana@example.com');
    const res = await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'TINSEL_TOM' } });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe('taken');
  });

  it('a name set by another tab in between is 409 has_name, not a second name', async () => {
    const ana = await signIn(testEnv(db), 'ana@example.com');
    // The other tab's write lands after this request read the session (name still null) and before its update.
    const racing: Db = {
      batch: (s) => db.batch(s),
      prepare(q: string): DbStatement {
        const real = db.prepare(q);
        if (!q.startsWith('UPDATE users SET name')) return real;
        const wrap = (st: DbStatement): DbStatement => ({
          bind: (...v) => wrap(st.bind(...v)),
          first: () => st.first(),
          all: () => st.all(),
          run: async () => {
            await db.prepare("UPDATE users SET name = 'Other Tab', name_key = 'othertab'").run();
            return st.run();
          },
        });
        return wrap(real);
      },
    };
    const res = await call(testEnv(racing), 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Meridian' } });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe('has_name');
    expect(await db.prepare('SELECT name FROM users').first()).toEqual({ name: 'Other Tab' });
  });

  it('refuses invalid and reserved names, and needs a session', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    expect(await body(await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'a!' } }))).toEqual({ error: 'invalid', message: `${NAME_RULE}.` });
    expect((await body(await call(env, 'POST', '/api/auth/name', { cookie: ana, body: { name: 'Santa' } }))).error).toBe('reserved');
    const anon = await call(env, 'POST', '/api/auth/name', { body: { name: 'Tinsel Tom' } });
    expect(anon.status).toBe(401);
    expect((await body(anon)).error).toBe('signed_out');
  });
});

describe('deleting an account', () => {
  it('needs the name typed (any case), then deletes the user, their sessions and games, and clears the cookie', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com', 'Meridian');
    const user = await db.prepare('SELECT id FROM users').first<{ id: number }>();
    await db.prepare("INSERT INTO games (id, user_id, gen_version, seed, started_at) VALUES ('owned-aaaaaaaaaaaaaa', ?, 1, 1, 1)").bind(user?.id).run();
    const wrong = await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: 'nope' } });
    expect(wrong.status).toBe(400);
    expect((await body(wrong)).error).toBe('confirm');
    const res = await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: ' meridian ' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBe('__Host-aglow_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    for (const t of ['users', 'sessions', 'games']) expect(await count(t), t).toBe(0);
  });

  it('an account without a name confirms with its email', async () => {
    const env = testEnv(db);
    const ana = await signIn(env, 'ana@example.com');
    expect((await call(env, 'DELETE', '/api/me', { cookie: ana, body: { confirm: 'ANA@example.com' } })).status).toBe(200);
    expect(await count('users')).toBe(0);
  });

  it('needs a session', async () => {
    expect((await call(testEnv(db), 'DELETE', '/api/me', { body: { confirm: 'x' } })).status).toBe(401);
  });
});
