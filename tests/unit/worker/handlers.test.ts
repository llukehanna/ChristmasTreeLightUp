import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUrl, type StationsFile } from '../../../src/radio/schema';
import type { AppEnv, RateLimitBinding } from '../../../worker/lib/env';
import { resetPublicCache } from '../../../worker/lib/public-stations';
import { createToken, sessionKey, verifyToken } from '../../../worker/lib/session';
import { CURRENT } from '../../../worker/lib/stations-store';
import { resetLoginLimits } from '../../../worker/routes/admin/login';
import { handle } from '../../../worker/router';
import { FakeBucket } from './fake-bucket';

const SECRET = 'test-session-secret-not-real';
const PASSWORD = 'let-it-snow';
const SITE = 'https://aglow.example';
const B = 'https://aglow-music.example';
const CONFLICT = 'Stations changed somewhere else. Reload to get the latest, then redo your change.';
const MB = 1024 * 1024;

const v3: StationsFile = {
  version: 3,
  stations: [
    {
      id: 'christmas-jazz',
      name: 'Christmas Jazz',
      description: '',
      cover: `${B}/covers/christmas-jazz/c.png`,
      tracks: [
        { id: 'a', url: `${B}/tracks/christmas-jazz/a.mp3`, title: 'A', artist: '', credit: '', duration: 1 },
        { id: 'b', url: `${B}/tracks/christmas-jazz/b%20b.mp3`, title: 'B', artist: '', credit: '', duration: 1 },
      ],
    },
  ],
};
const onlyB = () => [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];

let bucket: FakeBucket;
let pending: Promise<unknown>[];
const env = (over: Partial<AppEnv> = {}): AppEnv => ({ MUSIC: bucket, MUSIC_BASE_URL: B, ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, ...over });
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
const call = (req: Request, e: AppEnv = env()) => handle(req, e, ctx);
const settle = () => Promise.all(pending);

interface ReqOpts {
  headers?: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  /** Send the site's own Origin (default for anything but GET), none, or another one. */
  origin?: string | null;
}
function req(method: string, path: string, { headers = {}, body, origin }: ReqOpts = {}): Request {
  const o = origin === undefined ? (method === 'GET' ? null : SITE) : origin;
  return new Request(`${SITE}${path}`, { method, headers: { ...(o === null ? {} : { origin: o }), ...headers }, body });
}
const cookie = async (secret = SECRET, password = PASSWORD) =>
  `aglow_admin=${await createToken(await sessionKey(secret, password), Math.floor(Date.now() / 1000))}`;
const authed = async (extra: Record<string, string> = {}) => ({ cookie: await cookie(), ...extra });
const putStations = async (body: unknown, opts: ReqOpts = {}) =>
  call(req('PUT', '/api/admin/stations', { ...opts, headers: { ...(await authed()), ...opts.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const stored = (): StationsFile => JSON.parse(bucket.text(CURRENT) ?? 'null') as StationsFile;

beforeEach(() => {
  bucket = new FakeBucket();
  bucket.seed(CURRENT, JSON.stringify(v3), { contentType: 'application/json' });
  for (const k of ['tracks/christmas-jazz/a.mp3', 'tracks/christmas-jazz/b b.mp3', 'covers/christmas-jazz/c.png']) bucket.seed(k, 'media');
  pending = [];
  resetPublicCache();
  resetLoginLimits();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('routing', () => {
  it('serves every route in the table (unauthenticated callers get 401 from admin data routes)', async () => {
    const table: [string, string, number][] = [
      ['GET', '/api/stations', 200],
      ['POST', '/api/admin/login', 401],
      ['POST', '/api/admin/logout', 200],
      ['GET', '/api/admin/session', 200],
      ['GET', '/api/admin/stations', 401],
      ['PUT', '/api/admin/stations', 401],
      ['PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3', 401],
    ];
    for (const [method, path, status] of table) {
      const r = await call(req(method, path, { headers: { 'content-type': 'audio/mpeg' }, body: method === 'GET' ? undefined : '{}' }));
      expect(r.status, `${method} ${path}`).toBe(status);
      expect(r.headers.get('content-type'), `${method} ${path}`).toMatch(/^application\/json/);
    }
  });
  it('answers 404 JSON, never cached, for unknown /api paths', async () => {
    for (const path of ['/api/nope', '/api/stations/', '/api/admin', '/api/admin/', '/api/admin/upload-token', '/api/__proto__', '/api/admin/constructor', '/']) {
      const r = await call(req('GET', path));
      expect(r.status, path).toBe(404);
      expect(r.headers.get('cache-control'), path).toBe('no-store');
      expect(await r.json(), path).toEqual({ error: 'Not found' });
    }
  });
  it('answers 405, never cached and with Allow, for a known path with the wrong method', async () => {
    const cases: [string, string, string][] = [
      ['POST', '/api/stations', 'GET'],
      ['HEAD', '/api/stations', 'GET'],
      ['GET', '/api/admin/login', 'POST'],
      ['GET', '/api/admin/logout', 'POST'],
      ['POST', '/api/admin/session', 'GET'],
      ['DELETE', '/api/admin/stations', 'GET, PUT'],
      ['POST', '/api/admin/stations', 'GET, PUT'],
      ['GET', '/api/admin/upload', 'PUT'],
      ['POST', '/api/admin/upload', 'PUT'],
    ];
    for (const [method, path, allow] of cases) {
      const r = await call(req(method, path));
      expect(r.status, `${method} ${path}`).toBe(405);
      expect(r.headers.get('cache-control'), `${method} ${path}`).toBe('no-store');
      expect(r.headers.get('allow'), `${method} ${path}`).toBe(allow);
    }
  });
  it('turns an unexpected error into a 503, never a 500', async () => {
    const broken = new Proxy(env(), {
      get(target, p, receiver) {
        if (p === 'ADMIN_PASSWORD') throw new Error('boom');
        return Reflect.get(target, p, receiver) as unknown;
      },
    });
    const r = await call(req('GET', '/api/admin/session'), broken);
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('logs the route, method and error class of an unexpected error, never its message, body, cookie or secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const broken = new Proxy(env(), {
        get(target, p, receiver) {
          if (p === 'ADMIN_PASSWORD') throw new RangeError(`boom ${PASSWORD} ${SECRET}`);
          return Reflect.get(target, p, receiver) as unknown;
        },
      });
      const r = await call(req('PUT', '/api/admin/upload?folder=tracks&station=x&name=secret-name.mp3', { headers: { cookie: 'aglow_admin=abc.def' }, body: 'private body' }), broken);
      expect(r.status).toBe(503);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toEqual(['api', '/api/admin/upload', 'PUT', 'RangeError']);
      const logged = JSON.stringify(log.mock.calls);
      for (const leak of ['boom', PASSWORD, SECRET, 'private body', 'abc.def', 'secret-name']) expect(logged).not.toContain(leak);
      expect(JSON.stringify(await r.json())).not.toContain('boom');

      log.mockClear();
      const odd = new Proxy(env(), {
        get() {
          throw 'a thrown string';
        },
      });
      expect((await call(req('GET', '/api/admin/session'), odd)).status).toBe(503);
      expect(log.mock.calls).toEqual([['api', '/api/admin/session', 'GET', 'error']]);
    } finally {
      log.mockRestore();
    }
  });
});

describe('origin check', () => {
  const mutating: [string, string][] = [
    ['POST', '/api/admin/login'],
    ['POST', '/api/admin/logout'],
    ['PUT', '/api/admin/stations'],
    ['PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3'],
  ];
  it('refuses admin POST/PUT without an Origin header, or from another origin, even with a session', async () => {
    for (const [method, path] of mutating) {
      for (const origin of [null, 'https://evil.example', 'null', 'http://aglow.example', 'https://aglow.example:444']) {
        const r = await call(req(method, path, { origin, headers: await authed({ 'content-type': 'audio/mpeg', 'content-length': '2' }), body: '{}' }));
        expect(r.status, `${method} ${path} ${origin}`).toBe(403);
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('set-cookie')).toBeNull();
      }
    }
    expect(stored()).toEqual(v3);
  });
  it('lets same-origin requests through', async () => {
    const r = await call(req('POST', '/api/admin/login', { body: JSON.stringify({ password: PASSWORD }) }));
    expect(r.status).toBe(200);
  });
  it('does not apply to reads', async () => {
    expect((await call(req('GET', '/api/admin/stations', { headers: await authed() }))).status).toBe(200);
    expect((await call(req('GET', '/api/stations', { origin: 'https://evil.example' }))).status).toBe(200);
  });
});

describe('login', () => {
  const post = (password: string, ip: string | null, e: AppEnv = env()) =>
    call(req('POST', '/api/admin/login', { headers: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: JSON.stringify({ password }) }), e);
  it('rejects a wrong password', async () => {
    const r = await post('nope', '1.1.1.1');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Wrong password' });
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('sets a locked-down session cookie for the right password, holding a token that verifies', async () => {
    const r = await post(PASSWORD, '2.2.2.2');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const set = r.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^aglow_admin=\d+\.[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=604800$/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const token = /^aglow_admin=([^;]+)/.exec(set)?.[1];
    expect(await verifyToken(token, await sessionKey(SECRET, PASSWORD), Math.floor(Date.now() / 1000))).toBe(true);
  });
  it('rate-limits after 10 attempts from one address (CF-Connecting-IP)', async () => {
    for (let k = 0; k < 10; k++) await post('nope', '3.3.3.3');
    const r = await post(PASSWORD, '3.3.3.3');
    expect(r.status).toBe(429);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await post(PASSWORD, '3.3.3.4')).status).toBe(200);
  });
  it('keys on CF-Connecting-IP, so a forged X-Forwarded-For does not reset the count', async () => {
    const forged = (k: number) =>
      call(req('POST', '/api/admin/login', { headers: { 'cf-connecting-ip': '7.7.7.7', 'x-forwarded-for': `9.9.9.${k}` }, body: JSON.stringify({ password: 'nope' }) }));
    for (let k = 0; k < 10; k++) await forged(k);
    expect((await forged(99)).status).toBe(429);
  });
  it('counts callers without an address together as "unknown"', async () => {
    for (let k = 0; k < 10; k++) await post('nope', null);
    expect((await post(PASSWORD, null)).status).toBe(429);
  });
  it('also limits all callers together, so rotating addresses does not help', async () => {
    for (let k = 0; k < 100; k++) await post('nope', `10.0.${Math.floor(k / 200)}.${k}`);
    expect((await post(PASSWORD, '10.9.9.9')).status).toBe(429);
  });
  it('asks the LOGIN_LIMITER binding, keyed by IP, and answers 429 when it says no', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: key !== '8.8.8.8' }));
    const LOGIN_LIMITER: RateLimitBinding = { limit };
    expect((await post(PASSWORD, '8.8.8.8', env({ LOGIN_LIMITER }))).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '8.8.8.8' });
    const ok = await post(PASSWORD, '8.8.4.4', env({ LOGIN_LIMITER }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).not.toBeNull();
  });
  it('rejects an oversized body with 413, before parsing it', async () => {
    const big = req('POST', '/api/admin/login', { headers: { 'cf-connecting-ip': '4.4.4.4' }, body: JSON.stringify({ password: 'x'.repeat(5000) }) });
    const r = await call(big);
    expect(r.status).toBe(413);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('treats malformed JSON and a missing password as a wrong password', async () => {
    for (const body of ['{nope', 'null', '[]', '{}', '{"password":5}']) {
      const r = await call(req('POST', '/api/admin/login', { headers: { 'cf-connecting-ip': '5.5.5.5' }, body }));
      expect(r.status, body).toBe(401);
    }
  });
  it('answers 503, never a login, when either secret is unset or blank', async () => {
    for (const over of [{ ADMIN_PASSWORD: undefined }, { ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: '   ' }, { SESSION_SECRET: undefined }, { SESSION_SECRET: ' ' }]) {
      const e = env(over);
      const r = await post(e.ADMIN_PASSWORD ?? '', '6.6.6.6', e);
      expect(r.status, JSON.stringify(over)).toBe(503);
      expect(await r.json()).toEqual({ error: 'Admin is not configured' });
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('logout and session', () => {
  it('logout clears the cookie', async () => {
    const r = await call(req('POST', '/api/admin/logout'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('set-cookie')).toMatch(/^aglow_admin=; .*Max-Age=0/);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('reports whether the caller is an admin', async () => {
    expect(await (await call(req('GET', '/api/admin/session'))).json()).toEqual({ admin: false });
    const yes = await call(req('GET', '/api/admin/session', { headers: await authed() }));
    expect(await yes.json()).toEqual({ admin: true });
    expect(yes.headers.get('cache-control')).toBe('no-store');
    const forged = await call(req('GET', '/api/admin/session', { headers: { cookie: await cookie('another secret') } }));
    expect(await forged.json()).toEqual({ admin: false });
  });
  it('says "not admin" rather than failing when either secret is unset', async () => {
    const headers = await authed();
    for (const over of [{ ADMIN_PASSWORD: undefined }, { SESSION_SECRET: '' }]) {
      const r = await call(req('GET', '/api/admin/session', { headers }), env(over));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ admin: false });
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('admin stations', () => {
  it('requires a session', async () => {
    for (const r of [await call(req('GET', '/api/admin/stations')), await call(req('PUT', '/api/admin/stations', { body: JSON.stringify({ expectedVersion: 3, stations: [] }) }))]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Not signed in' });
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(stored()).toEqual(v3);
  });
  it('answers 503 instead of failing when a secret is unset', async () => {
    const headers = await authed();
    for (const over of [{ ADMIN_PASSWORD: undefined }, { SESSION_SECRET: undefined }]) {
      const get = await call(req('GET', '/api/admin/stations', { headers }), env(over));
      expect(get.status).toBe(503);
      expect(await get.json()).toEqual({ error: 'Admin is not configured' });
      const put = await call(req('PUT', '/api/admin/stations', { headers, body: JSON.stringify({ expectedVersion: 3, stations: [] }) }), env(over));
      expect(put.status).toBe(503);
    }
    expect(stored()).toEqual(v3);
  });
  it('returns the stored file to an admin', async () => {
    const r = await call(req('GET', '/api/admin/stations', { headers: await authed() }));
    expect(await r.json()).toEqual(v3);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('returns an empty version-0 list when nothing has been saved', async () => {
    await bucket.delete(CURRENT);
    const r = await call(req('GET', '/api/admin/stations', { headers: await authed() }));
    expect(await r.json()).toEqual({ version: 0, stations: [] });
  });
  it('answers 503 when the stored file cannot be read', async () => {
    bucket.seed(CURRENT, '{broken');
    const r = await call(req('GET', '/api/admin/stations', { headers: await authed() }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'Could not read the stations' });
    expect((await putStations({ expectedVersion: 3, stations: v3.stations })).status).toBe(503);
  });
  it('saves the next version over the version it read, and deletes removed media in the background', async () => {
    const before = bucket.objects.get(CURRENT)?.etag;
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 4 });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(stored()).toEqual({ version: 4, stations: onlyB() });
    expect(bucket.objects.get(CURRENT)?.etag).not.toBe(before);
    expect(bucket.objects.get(CURRENT)?.httpMetadata).toEqual({ contentType: 'application/json' });
    // Removal happens through ctx.waitUntil.
    expect(pending.length).toBe(1);
    await settle();
    expect(bucket.objects.has('tracks/christmas-jazz/a.mp3')).toBe(false);
    expect(bucket.objects.has('tracks/christmas-jazz/b b.mp3')).toBe(true);
    expect(bucket.objects.has('covers/christmas-jazz/c.png')).toBe(true);
  });
  it('saves version 1 into an empty bucket, creating the file only if nobody else did', async () => {
    await bucket.delete(CURRENT);
    const put = vi.spyOn(bucket, 'put');
    const r = await putStations({ expectedVersion: 0, stations: onlyB() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 1 });
    expect(put.mock.calls[0][2]).toMatchObject({ onlyIf: { etagDoesNotMatch: '*' } });
    expect(stored()).toEqual({ version: 1, stations: onlyB() });
  });
  it('refuses a stale save (version mismatch) without writing', async () => {
    const put = vi.spyOn(bucket, 'put');
    for (const expectedVersion of [2, 4, '3', undefined]) {
      const r = await putStations({ expectedVersion, stations: v3.stations });
      expect(r.status, String(expectedVersion)).toBe(409);
      expect(await r.json()).toEqual({ error: CONFLICT });
    }
    expect(put).not.toHaveBeenCalled();
    expect(pending).toEqual([]);
  });
  it('reports a write that lost the etag race (somebody saved in between) as a conflict, and deletes nothing', async () => {
    const realPut = bucket.put.bind(bucket);
    vi.spyOn(bucket, 'put').mockImplementationOnce(async (k, v, o) => {
      bucket.seed(CURRENT, JSON.stringify({ ...v3, version: 4 })); // another admin's save lands first
      return realPut(k, v, o);
    });
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: CONFLICT });
    expect(stored()).toEqual({ ...v3, version: 4 });
    expect(pending).toEqual([]);
  });
  it('rejects invalid data and malformed bodies', async () => {
    const put = vi.spyOn(bucket, 'put');
    const bad = await putStations({ expectedVersion: 3, stations: [{ ...v3.stations[0], id: 'Not An Id' }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Some station or track fields are invalid. Every track needs a title.' });
    for (const body of ['nope', 'null', '[]', '5']) {
      const r = await putStations(body);
      expect(r.status, body).toBe(400);
      expect(await r.json()).toEqual({ error: 'Invalid JSON' });
    }
    expect((await putStations({ expectedVersion: 3 })).status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('refuses a body over 4 MB with 413', async () => {
    const r = await putStations(JSON.stringify({ expectedVersion: 3, stations: v3.stations, pad: 'x'.repeat(4 * MB) }));
    expect(r.status).toBe(413);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(stored()).toEqual(v3);
  });
  it('treats a lost response as success when the stored file is exactly what was sent', async () => {
    const realPut = bucket.put.bind(bucket);
    vi.spyOn(bucket, 'put').mockImplementationOnce(async (k, v, o) => {
      await realPut(k, v, o);
      throw new Error('connection reset');
    });
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 4 });
    await settle();
    expect(bucket.objects.has('tracks/christmas-jazz/a.mp3')).toBe(false);
  });
  it('answers 503 "Could not save" when the write failed and the stored file is not ours', async () => {
    vi.spyOn(bucket, 'put').mockRejectedValueOnce(new Error('network down'));
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'Could not save. Try again.' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(stored()).toEqual(v3);
    expect(pending).toEqual([]);
  });
  it('answers 503 "Could not confirm" when the write failed and the re-read fails too', async () => {
    vi.spyOn(bucket, 'put').mockRejectedValueOnce(new Error('network down'));
    const realGet = bucket.get.bind(bucket);
    vi.spyOn(bucket, 'get').mockImplementationOnce(realGet).mockRejectedValueOnce(new Error('still down'));
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'Could not confirm whether the save went through. Reload to check.' });
    expect(pending).toEqual([]);
  });
  it('never deletes media outside MUSIC_BASE_URL/tracks/ and /covers/', async () => {
    const foreign: StationsFile = {
      version: 3,
      stations: [
        {
          ...v3.stations[0],
          cover: 'https://elsewhere.example/covers/christmas-jazz/c.png',
          tracks: [
            { id: 'x', url: 'https://elsewhere.example/tracks/christmas-jazz/a.mp3', title: 'X', artist: '', credit: '', duration: 1 },
            { id: 'y', url: `${B}/tracks/../stations/current.json`, title: 'Y', artist: '', credit: '', duration: 1 },
            { id: 'z', url: '/audio/piano/x.m4a', title: 'Z', artist: '', credit: '', duration: 1 },
          ],
        },
      ],
    };
    bucket.seed(CURRENT, JSON.stringify(foreign));
    const del = vi.spyOn(bucket, 'delete');
    const r = await putStations({ expectedVersion: 3, stations: [{ ...v3.stations[0], cover: undefined, tracks: [] }] });
    expect(r.status).toBe(200);
    await settle();
    expect(del).not.toHaveBeenCalled();
    expect(bucket.objects.has('tracks/christmas-jazz/a.mp3')).toBe(true);
    expect(bucket.objects.has('covers/christmas-jazz/c.png')).toBe(true);
    expect(bucket.objects.has(CURRENT)).toBe(true);
  });
  it('still reports success when cleanup fails, and the background task does not reject', async () => {
    vi.spyOn(bucket, 'delete').mockRejectedValue(new Error('boom'));
    const r = await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(r.status).toBe(200);
    await expect(settle()).resolves.toBeDefined();
  });
  it('the public list in this isolate shows a save at once', async () => {
    expect(((await (await call(req('GET', '/api/stations'))).json()) as StationsFile).version).toBe(3);
    await putStations({ expectedVersion: 3, stations: onlyB() });
    expect(((await (await call(req('GET', '/api/stations'))).json()) as StationsFile).version).toBe(4);
  });
});

describe('uploads', () => {
  const up = async (query: string, opts: { type?: string | null; length?: string | null; body?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}) => {
    const body = opts.body ?? new Uint8Array([1, 2, 3, 4, 5]);
    const headers: Record<string, string> = opts.headers ?? (await authed());
    if (opts.type !== null) headers['content-type'] = opts.type ?? 'audio/mpeg';
    if (opts.length !== null) headers['content-length'] = opts.length ?? String(body.byteLength);
    return call(req('PUT', `/api/admin/upload?${query}`, { headers, body }));
  };
  const media = () => [...bucket.objects.keys()].filter((k) => k !== CURRENT && !['tracks/christmas-jazz/a.mp3', 'tracks/christmas-jazz/b b.mp3', 'covers/christmas-jazz/c.png'].includes(k));

  it('streams the file to R2 under <folder>/<station>/<8 hex>-<name> and returns its public URL', async () => {
    const put = vi.spyOn(bucket, 'put');
    const r = await up('folder=tracks&station=christmas-jazz&name=Sleigh%20Ride%20%232%20(100%25).mp3');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { url, key, size } = (await r.json()) as { url: string; key: string; size: number };
    expect(key).toMatch(/^tracks\/christmas-jazz\/[0-9a-f]{8}-Sleigh Ride #2 \(100%\)\.mp3$/);
    expect(url).toBe(`${B}/tracks/christmas-jazz/${key.slice(22, 30)}-Sleigh%20Ride%20%232%20(100%25).mp3`);
    expect(isUrl(url)).toBe(true);
    expect(size).toBe(5);
    expect([...(bucket.objects.get(key)?.body ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(bucket.objects.get(key)?.httpMetadata).toEqual({ contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' });
    // The body is handed over as a stream, never read into memory first.
    expect(put.mock.calls[0][1]).toBeInstanceOf(ReadableStream);
  });
  it('gives every upload a fresh random prefix', async () => {
    const keys = new Set<string>();
    for (let k = 0; k < 5; k++) keys.add(((await (await up('folder=tracks&station=christmas-jazz&name=a.mp3')).json()) as { key: string }).key);
    expect(keys.size).toBe(5);
  });
  it('takes covers as images, and every allowed type for each folder', async () => {
    for (const type of ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg']) expect((await up('folder=tracks&station=christmas-jazz&name=a', { type })).status, type).toBe(200);
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      const r = await up('folder=covers&station=christmas-jazz&name=c.png', { type });
      expect(r.status, type).toBe(200);
      expect(((await r.json()) as { key: string }).key).toMatch(/^covers\/christmas-jazz\/[0-9a-f]{8}-c\.png$/);
    }
    // Media types are case-insensitive and may carry parameters; the stored type is the bare, lower-case one.
    const r = await up('folder=tracks&station=christmas-jazz&name=a', { type: 'Audio/MPEG; foo=bar' });
    expect(r.status).toBe(200);
    expect(bucket.objects.get(((await r.json()) as { key: string }).key)?.httpMetadata?.contentType).toBe('audio/mpeg');
  });
  it('refuses a bad folder, station or name with 400', async () => {
    const queries = [
      'station=christmas-jazz&name=a.mp3',
      'folder=stations&station=christmas-jazz&name=a.mp3',
      'folder=Tracks&station=christmas-jazz&name=a.mp3',
      'folder=tracks&name=a.mp3',
      'folder=tracks&station=Christmas%20Jazz&name=a.mp3',
      'folder=tracks&station=-a&name=a.mp3',
      'folder=tracks&station=a%2Fb&name=a.mp3',
      'folder=tracks&station=..&name=a.mp3',
      `folder=tracks&station=${'a'.repeat(65)}&name=a.mp3`,
      'folder=tracks&station=christmas-jazz',
      'folder=tracks&station=christmas-jazz&name=',
      'folder=tracks&station=christmas-jazz&name=.',
      'folder=tracks&station=christmas-jazz&name=..',
      'folder=tracks&station=christmas-jazz&name=a%2Fb.mp3',
      'folder=tracks&station=christmas-jazz&name=a%5Cb.mp3',
      'folder=tracks&station=christmas-jazz&name=a%00b.mp3',
      'folder=tracks&station=christmas-jazz&name=a%0Ab.mp3',
      'folder=tracks&station=christmas-jazz&name=a%7Fb.mp3',
      `folder=tracks&station=christmas-jazz&name=${'x'.repeat(201)}`,
    ];
    for (const q of queries) {
      const r = await up(q);
      expect(r.status, q).toBe(400);
      expect(((await r.json()) as { error: string }).error, q).toMatch(/tracks\/<station>\/<file>/);
    }
    expect((await up(`folder=tracks&station=christmas-jazz&name=${'x'.repeat(200)}`)).status).toBe(200);
    expect((await up(`folder=tracks&station=${'a'.repeat(64)}&name=a.mp3`)).status).toBe(200);
    expect(media().length).toBe(2);
  });
  it('refuses a type that is not allowed for the folder with 415', async () => {
    const cases: [string, string | null][] = [
      ['folder=tracks&station=christmas-jazz&name=a.mp3', 'image/png'],
      ['folder=tracks&station=christmas-jazz&name=a.mp3', 'text/html'],
      ['folder=tracks&station=christmas-jazz&name=a.mp3', 'audio/wav'],
      ['folder=tracks&station=christmas-jazz&name=a.mp3', null],
      ['folder=covers&station=christmas-jazz&name=c.svg', 'image/svg+xml'],
      ['folder=covers&station=christmas-jazz&name=c.png', 'audio/mpeg'],
    ];
    for (const [q, type] of cases) {
      const r = await up(q, { type });
      expect(r.status, `${q} ${type}`).toBe(415);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(media()).toEqual([]);
  });
  it('requires a Content-Length (411) and refuses more than 30 MB (413) without reading the body', async () => {
    const put = vi.spyOn(bucket, 'put');
    for (const length of [null, '', 'abc', '-1', '1.5', '1e3']) {
      const r = await up('folder=tracks&station=christmas-jazz&name=a.mp3', { length });
      expect(r.status, String(length)).toBe(411);
    }
    const big = await up('folder=tracks&station=christmas-jazz&name=a.mp3', { length: String(30 * MB + 1) });
    expect(big.status).toBe(413);
    expect(big.headers.get('cache-control')).toBe('no-store');
    expect(put).not.toHaveBeenCalled();
    expect(media()).toEqual([]);
  });
  it('refuses an empty file, and removes a stored object whose size does not match what was declared', async () => {
    expect((await up('folder=tracks&station=christmas-jazz&name=a.mp3', { body: new Uint8Array(0) })).status).toBe(400);
    const r = await up('folder=tracks&station=christmas-jazz&name=a.mp3', { length: '3' });
    expect(r.status).toBe(400);
    expect(media()).toEqual([]);
  });
  it('answers 503 when R2 refuses the write', async () => {
    vi.spyOn(bucket, 'put').mockRejectedValueOnce(new Error('r2 down'));
    const r = await up('folder=tracks&station=christmas-jazz&name=a.mp3');
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'Upload failed. Try again.' });
  });
  it('requires a session (401), and answers 503 when a secret is unset, without touching the bucket', async () => {
    const put = vi.spyOn(bucket, 'put');
    const anon = await up('folder=tracks&station=christmas-jazz&name=a.mp3', { headers: {} });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('cache-control')).toBe('no-store');
    const forged = await up('folder=tracks&station=christmas-jazz&name=a.mp3', { headers: { cookie: await cookie('another secret') } });
    expect(forged.status).toBe(401);
    const headers = await authed();
    const r = await call(req('PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3', { headers: { ...headers, 'content-type': 'audio/mpeg', 'content-length': '1' }, body: 'x' }), env({ SESSION_SECRET: undefined }));
    expect(r.status).toBe(503);
    expect(put).not.toHaveBeenCalled();
  });
  it('answers 503 when MUSIC_BASE_URL is not a usable https origin', async () => {
    const headers = await authed({ 'content-type': 'audio/mpeg', 'content-length': '1' });
    const r = await call(req('PUT', '/api/admin/upload?folder=tracks&station=christmas-jazz&name=a.mp3', { headers, body: 'x' }), env({ MUSIC_BASE_URL: '' }));
    expect(r.status).toBe(503);
    expect(media()).toEqual([]);
  });
});

describe('public list', () => {
  it('serves the stored file with a 60s public cache header', async () => {
    const r = await call(req('GET', '/api/stations'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await r.json()).toEqual(v3);
  });
  it('serves an empty list when nothing has been saved', async () => {
    await bucket.delete(CURRENT);
    const r = await call(req('GET', '/api/stations'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await r.json()).toEqual({ version: 0, stations: [] });
  });
  it('answers 503 with no-store when the stored file is invalid or unreadable, and does not cache the failure', async () => {
    for (const body of ['{broken', JSON.stringify({ version: 1, stations: 'nope' })]) {
      bucket.seed(CURRENT, body);
      const r = await call(req('GET', '/api/stations'));
      expect(r.status, body).toBe(503);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ error: 'Stations are unavailable' });
    }
    vi.spyOn(bucket, 'get').mockRejectedValueOnce(new Error('r2 down'));
    expect((await call(req('GET', '/api/stations'))).status).toBe(503);
    bucket.seed(CURRENT, JSON.stringify(v3));
    expect((await call(req('GET', '/api/stations'))).status).toBe(200);
  });
  it('keeps the list in memory for 60 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const get = vi.spyOn(bucket, 'get');
    await call(req('GET', '/api/stations'));
    await call(req('GET', '/api/stations'));
    expect(get).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 59_000);
    await call(req('GET', '/api/stations'));
    expect(get).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2_000);
    await call(req('GET', '/api/stations'));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
