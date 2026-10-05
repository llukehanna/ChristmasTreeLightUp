import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({ list: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ handleUpload: vi.fn(async () => ({ type: 'blob.generate-client-token', clientToken: 'tok' })) }));

import { del, list, put } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { resetPublicCache } from '../../../api/_lib/public-stations';
import { createToken, sessionKey } from '../../../api/_lib/session';
import * as login from '../../../api/admin/login';
import * as logout from '../../../api/admin/logout';
import * as sessionApi from '../../../api/admin/session';
import * as adminStations from '../../../api/admin/stations';
import * as upload from '../../../api/admin/upload-token';
import * as publicStations from '../../../api/stations';

const PASSWORD = 'let-it-snow';
// A fake token in the real shape: vercel_blob_rw_<storeId>_<secret>. The store id is mixed case, the host is lower case.
const FAKE_TOKEN = 'vercel_blob_rw_AbC123_notARealSecret';
const B = 'https://abc123.public.blob.vercel-storage.com';
const authed = () => ({ cookie: `aglow_admin=${createToken(sessionKey(PASSWORD), Math.floor(Date.now() / 1000))}` });
const v3 = {
  version: 3,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [
    { id: 'a', url: `${B}/tracks/christmas-jazz/a.mp3`, title: 'A', artist: '', credit: '', duration: 1 },
    { id: 'b', url: `${B}/tracks/christmas-jazz/b.mp3`, title: 'B', artist: '', credit: '', duration: 1 },
  ] }],
};
const listReturns = (...numbers: number[]) =>
  vi.mocked(list).mockResolvedValue({
    blobs: numbers.map((n) => ({ pathname: `stations/v${String(n).padStart(6, '0')}.json`, url: `${B}/stations/v${String(n).padStart(6, '0')}.json` })),
    hasMore: false,
  } as unknown as Awaited<ReturnType<typeof list>>);
const put_ = (body: unknown) => new Request('https://x/', { method: 'PUT', headers: authed(), body: JSON.stringify(body) });
const json = (v: unknown) => new Response(JSON.stringify(v));

beforeEach(() => {
  process.env.ADMIN_PASSWORD = PASSWORD;
  process.env.BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
  resetPublicCache();
  vi.mocked(list).mockReset();
  listReturns(3);
  vi.mocked(put).mockReset();
  vi.mocked(del).mockReset();
  vi.mocked(handleUpload).mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => json(v3)));
});
afterEach(() => vi.unstubAllGlobals());

describe('login', () => {
  const post = (password: string, ip: string, mod: typeof login = login) =>
    mod.POST(new Request('https://x/api/admin/login', { method: 'POST', headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' }, body: JSON.stringify({ password }) }));
  it('rejects a wrong password', async () => {
    const r = await post('nope', '1.1.1.1');
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('sets a locked-down session cookie for the right password', async () => {
    const r = await post(PASSWORD, '2.2.2.2');
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/^aglow_admin=.+; HttpOnly; Secure; SameSite=Strict/);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('rate-limits after 10 attempts from one address', async () => {
    for (let k = 0; k < 10; k++) await post('nope', '3.3.3.3');
    expect((await post(PASSWORD, '3.3.3.3')).status).toBe(429);
    expect((await post(PASSWORD, '3.3.3.4')).status).toBe(200);
  });
  it('also limits all callers together, so rotating addresses does not help', async () => {
    vi.resetModules();
    const fresh = await import('../../../api/admin/login');
    for (let k = 0; k < 100; k++) await post('nope', `10.0.${Math.floor(k / 200)}.${k}`, fresh);
    expect((await post(PASSWORD, '10.9.9.9', fresh)).status).toBe(429);
  });
  it('rejects an oversized body with 413, before parsing it', async () => {
    const big = new Request('https://x/api/admin/login', { method: 'POST', headers: { 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify({ password: 'x'.repeat(5000) }) });
    expect((await login.POST(big)).status).toBe(413);
  });
  it('treats malformed JSON as a wrong password', async () => {
    const r = await login.POST(new Request('https://x/', { method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' }, body: '{nope' }));
    expect(r.status).toBe(401);
  });
  it('answers 503, never a login, when the password is unset or blank', async () => {
    for (const v of [undefined, '', '   ']) {
      if (v === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = v;
      const r = await post(v ?? '', '6.6.6.6');
      expect(r.status, String(v)).toBe(503);
      expect(await r.json()).toEqual({ error: 'Admin is not configured' });
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });
});

describe('logout and session', () => {
  it('logout clears the cookie', async () => {
    const r = logout.POST();
    expect(r.headers.get('set-cookie')).toMatch(/^aglow_admin=; .*Max-Age=0/);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('reports whether the caller is an admin', async () => {
    expect(await sessionApi.GET(new Request('https://x/')).json()).toEqual({ admin: false });
    const yes = sessionApi.GET(new Request('https://x/', { headers: authed() }));
    expect(await yes.json()).toEqual({ admin: true });
    expect(yes.headers.get('cache-control')).toBe('no-store');
  });
  it('says "not admin" rather than crashing when the password is unset', async () => {
    const headers = authed();
    delete process.env.ADMIN_PASSWORD;
    const r = sessionApi.GET(new Request('https://x/', { headers }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ admin: false });
  });
});

describe('admin stations', () => {
  it('requires a session', async () => {
    const r = await adminStations.GET(new Request('https://x/api/admin/stations'));
    expect(r.status).toBe(401);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('answers 503 instead of crashing when the password is unset', async () => {
    delete process.env.ADMIN_PASSWORD;
    expect((await adminStations.GET(new Request('https://x/', { headers: { cookie: 'aglow_admin=1.x' } }))).status).toBe(503);
    expect((await adminStations.PUT(put_({ expectedVersion: 3, stations: [] }))).status).toBe(503);
  });
  it('returns the latest version to an admin', async () => {
    const r = await adminStations.GET(new Request('https://x/api/admin/stations', { headers: authed() }));
    expect(await r.json()).toEqual(v3);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('refuses a stale save', async () => {
    const r = await adminStations.PUT(put_({ expectedVersion: 2, stations: v3.stations }));
    expect(r.status).toBe(409);
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects invalid data and malformed bodies', async () => {
    const bad = [{ ...v3.stations[0], id: 'Not An Id' }];
    expect((await adminStations.PUT(put_({ expectedVersion: 3, stations: bad }))).status).toBe(400);
    expect((await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: 'nope' }))).status).toBe(400);
    expect((await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: 'null' }))).status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('writes the next version and the public copy, then deletes files that were removed', async () => {
    const next = [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: next }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 4 });
    expect(r.headers.get('cache-control')).toBe('no-store');
    const calls = vi.mocked(put).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['stations/v000004.json', 'stations/current.json']);
    expect(calls[0][2]).toMatchObject({ allowOverwrite: false });
    expect(calls[1][2]).toMatchObject({ access: 'public', allowOverwrite: true, addRandomSuffix: false, cacheControlMaxAge: 60 });
    expect(JSON.parse(calls[1][1] as string)).toEqual({ version: 4, stations: next });
    expect(vi.mocked(del)).toHaveBeenCalledWith([`${B}/tracks/christmas-jazz/a.mp3`]);
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('prunes old versions from the list it already has: one list() per save', async () => {
    listReturns(1, 2, 3, 4, 5, 6);
    vi.mocked(fetch).mockImplementation(async () => json({ ...v3, version: 6 }));
    const r = await adminStations.PUT(put_({ expectedVersion: 6, stations: v3.stations }));
    expect(await r.json()).toEqual({ version: 7 });
    expect(list).toHaveBeenCalledTimes(1);
    expect(vi.mocked(del)).toHaveBeenCalledWith([`${B}/stations/v000001.json`, `${B}/stations/v000002.json`]);
  });
  it('writes current.json only after the version has been written', async () => {
    const order: string[] = [];
    vi.mocked(put).mockImplementation(async (p) => {
      order.push(p);
      return {} as Awaited<ReturnType<typeof put>>;
    });
    await adminStations.PUT(put_({ expectedVersion: 3, stations: v3.stations }));
    expect(order).toEqual(['stations/v000004.json', 'stations/current.json']);
  });
  // Re-read results for the save-failure cases: first list() is the pre-save read, second is the re-read after put failed.
  const reread = (version: number, content: unknown) => {
    vi.mocked(list).mockReset();
    listReturns(3);
    vi.mocked(list).mockResolvedValueOnce({ blobs: [{ pathname: 'stations/v000003.json', url: `${B}/stations/v000003.json` }], hasMore: false } as never);
    const name = `v${String(version).padStart(6, '0')}.json`;
    vi.mocked(list).mockResolvedValueOnce({ blobs: [{ pathname: `stations/${name}`, url: `${B}/stations/${name}` }], hasMore: false } as never);
    vi.mocked(fetch).mockImplementation(async (u) => json(String(u).endsWith(name) ? content : v3));
  };
  it('reports a concurrent save (version N+1 holds different content) as a conflict, and writes no public copy', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('This blob already exists'));
    reread(4, { version: 4, stations: [{ ...v3.stations[0], name: 'Somebody Else' }] });
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: v3.stations }));
    expect(r.status).toBe(409);
    expect(put).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
  it('answers 503, not 409, when the write failed and nothing newer exists', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('network down'));
    const next = [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];
    reread(3, v3);
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: next }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'Could not save. Try again.' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(put).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
  it('answers 503 when the write failed and the re-read fails too', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('network down'));
    vi.mocked(list).mockReset();
    listReturns(3);
    vi.mocked(list).mockResolvedValueOnce({ blobs: [{ pathname: 'stations/v000003.json', url: `${B}/stations/v000003.json` }], hasMore: false } as never);
    vi.mocked(list).mockRejectedValueOnce(new Error('list failed'));
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: v3.stations }));
    expect(r.status).toBe(503);
    expect(put).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
  it('treats a lost-response retry as success when the stored version is exactly what was sent', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('This blob already exists'));
    const next = [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];
    const stored = { version: 4, stations: next };
    listReturns(3);
    vi.mocked(list).mockResolvedValueOnce({ blobs: [{ pathname: 'stations/v000003.json', url: `${B}/stations/v000003.json` }], hasMore: false } as never);
    vi.mocked(list).mockResolvedValueOnce({ blobs: [{ pathname: 'stations/v000004.json', url: `${B}/stations/v000004.json` }], hasMore: false } as never);
    vi.mocked(fetch).mockImplementation(async (u) => json(String(u).endsWith('v000004.json') ? stored : v3));
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: next }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 4 });
    expect(vi.mocked(put).mock.calls.map((c) => c[0])).toEqual(['stations/v000004.json', 'stations/current.json']);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('is a conflict, not a success, when a newer version than ours already exists', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('This blob already exists'));
    reread(5, { version: 5, stations: v3.stations });
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: v3.stations }));
    expect(r.status).toBe(409);
    expect(del).not.toHaveBeenCalled();
  });
  it('still reports success, with a warning, if the public copy cannot be refreshed', async () => {
    vi.mocked(put).mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('boom'));
    const r = await adminStations.PUT(put_({ expectedVersion: 3, stations: v3.stations }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { version: number; warning?: string };
    expect(body.version).toBe(4);
    expect(body.warning).toMatch(/public list/);
  });
  it('still reports success when cleanup fails', async () => {
    vi.mocked(del).mockRejectedValue(new Error('boom'));
    const next = [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];
    expect((await adminStations.PUT(put_({ expectedVersion: 3, stations: next }))).status).toBe(200);
  });
});

describe('uploads', () => {
  const tokenReq = (pathname: string, headers: Record<string, string> = authed()) =>
    new Request('https://x/', { method: 'POST', headers, body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: false } }) });
  it('refuses to issue upload tokens without a session', async () => {
    const r = await upload.POST(tokenReq('tracks/christmas-jazz/x.mp3', {}));
    expect(r.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
  });
  it('issues tokens to an admin', async () => {
    const r = await upload.POST(tokenReq('tracks/christmas-jazz/x.mp3'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ type: 'blob.generate-client-token', clientToken: 'tok' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('lets the signed completion callback through without a session (the SDK verifies its signature)', async () => {
    const r = await upload.POST(new Request('https://x/', { method: 'POST', body: JSON.stringify({ type: 'blob.upload-completed', payload: { blob: {} } }) }));
    expect(r.status).toBe(200);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });
  it('requires a session for any other event type', async () => {
    const r = await upload.POST(new Request('https://x/', { method: 'POST', body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: {} }) }));
    expect(r.status).toBe(401);
  });
  it('answers 503 instead of crashing when the password is unset', async () => {
    delete process.env.ADMIN_PASSWORD;
    expect((await upload.POST(tokenReq('tracks/christmas-jazz/x.mp3', { cookie: 'aglow_admin=1.x' }))).status).toBe(503);
  });
  it('only allows tracks/<station>/<file> and covers/<station>/<file>, with the right types and size', async () => {
    type Opts = { onBeforeGenerateToken: (p: string, c: string | null, m: boolean) => Promise<Record<string, unknown>> };
    await upload.POST(tokenReq('tracks/christmas-jazz/x.mp3'));
    const { onBeforeGenerateToken } = vi.mocked(handleUpload).mock.calls[0][0] as unknown as Opts;
    const track = await onBeforeGenerateToken('tracks/christmas-jazz/x.mp3', null, false);
    expect(track).toMatchObject({ maximumSizeInBytes: 30 * 1024 * 1024, addRandomSuffix: true });
    expect(track.allowedContentTypes).toEqual(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg']);
    await expect(onBeforeGenerateToken(`tracks/christmas-jazz/${'x'.repeat(200)}`, null, false)).resolves.toBeDefined();
    expect((await onBeforeGenerateToken('covers/christmas-jazz/c.png', null, false)).allowedContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    for (const bad of ['stations/v000009.json', 'tracks/x.mp3', 'tracks//x.mp3', 'tracks/christmas-jazz/', 'tracks/Christmas Jazz/x.mp3', 'tracks/-a/x.mp3', 'tracks/christmas-jazz/a/b.mp3', 'tracks/christmas-jazz/..', 'tracks/../x/y.mp3', '/tracks/christmas-jazz/x.mp3', 'tracks/christmas-jazz/a\\b.mp3', `tracks/christmas-jazz/${'x'.repeat(201)}`]) {
      await expect(onBeforeGenerateToken(bad, null, false), bad).rejects.toThrow();
    }
  });
  it('turns a refused path into a 400', async () => {
    vi.mocked(handleUpload).mockImplementationOnce(async (o) => {
      await o.onBeforeGenerateToken('stations/v000009.json', null, false);
      throw new Error('unreachable');
    });
    const r = await upload.POST(tokenReq('stations/v000009.json'));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/tracks/);
  });
  it('rejects malformed and oversized bodies', async () => {
    expect((await upload.POST(new Request('https://x/', { method: 'POST', headers: authed(), body: 'nope' }))).status).toBe(400);
    expect((await upload.POST(new Request('https://x/', { method: 'POST', headers: authed(), body: 'x'.repeat(20000) }))).status).toBe(413);
  });
});

describe('public list', () => {
  const cacheHeader = 'public, s-maxage=60, stale-while-revalidate=600';
  it('serves stations/current.json by its public URL, and never calls list()', async () => {
    const r = await publicStations.GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(cacheHeader);
    expect(await r.json()).toEqual(v3);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${B}/stations/current.json`);
    expect(list).not.toHaveBeenCalled();
  });
  it('serves an empty list, with the same cache header, when nothing has been saved (404)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('missing', { status: 404 }));
    const r = await publicStations.GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(cacheHeader);
    expect(await r.json()).toEqual({ version: 0, stations: [] });
    expect(list).not.toHaveBeenCalled();
  });
  it('answers 503 with no-store on any other failure', async () => {
    for (const make of [() => new Response('x', { status: 500 }), () => json({ version: 1, stations: 'nope' })]) {
      resetPublicCache();
      vi.mocked(fetch).mockResolvedValue(make());
      const r = await publicStations.GET();
      expect(r.status).toBe(503);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    resetPublicCache();
    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    expect((await publicStations.GET()).status).toBe(503);
  });
  it('answers 503 (and does not leak the token) when the token is missing or malformed', async () => {
    for (const t of [undefined, '', 'garbage', 'vercel_blob_rw_a.b_secret']) {
      resetPublicCache();
      if (t === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = t;
      const r = await publicStations.GET();
      expect(r.status, String(t)).toBe(503);
      expect(JSON.stringify(await r.json())).not.toContain('garbage');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the list in memory for 5 minutes', async () => {
    await publicStations.GET();
    await publicStations.GET();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 200_000);
    await publicStations.GET();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 101_000);
    await publicStations.GET();
    vi.useRealTimers();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
