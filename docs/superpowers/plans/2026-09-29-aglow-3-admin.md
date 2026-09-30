# Aglow — Plan 3: Radio Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Luke a password-protected `/admin` page to create stations and upload tracks to Vercel Blob, and serve the station list to the game at `GET /api/stations`.

**Architecture:** Vercel Functions in `api/` use web-standard handlers (`export async function GET/POST/PUT(request: Request)`).
- **Auth:** a password from `ADMIN_PASSWORD`, then an HMAC-signed, HttpOnly session cookie signed with `ADMIN_SECRET`.
- **Uploads:** files go straight from the browser to Blob via `@vercel/blob/client` `upload()`, authorised by `/api/admin/upload-token`.
- **Station list:** stored as **immutable, versioned JSON blobs** (`stations/v000001.json`, …). The newest is found with `list()`, which is strongly consistent, so there's no CDN staleness. Writes use optimistic concurrency: the client sends `expectedVersion`, and Blob refuses to overwrite an existing version path.

**Tech Stack:** Vercel Functions (Node.js runtime, web handlers), `@vercel/blob` 2.x (`list`, `put`, `del`, `handleUpload`, `upload`), `node:crypto`, Vitest (with mocked Blob), Vite multi-page build.

**Spec:** `docs/superpowers/specs/2026-09-29-aglow-design.md` §7 (admin), §8 (errors).

**Prerequisites:** Plans 1 and 2 are complete. Plan 2 defines `src/radio/schema.ts` (reused here) and fetches `/api/stations`.

## Global Constraints

- Plan 1 and 2 constraints still apply (strict TS, no `any`, commit trailer).
- Station ids must be exactly `christmas-jazz` and `christmas-classics` for Luke's two stations (Plan 2's scene suggestions rely on them). The admin derives ids from names with `slugify`, so name them "Christmas Jazz" and "Christmas Classics".
- Allowed uploads: audio `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/aac`, `audio/ogg` up to **30 MB**; covers `image/jpeg`, `image/png`, `image/webp`. Paths must start with `tracks/` or `covers/`.
- Cookie: `aglow_admin`, `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` (7 days).
- Login: constant-time comparison; basic rate limit of 10 attempts per 15 minutes per IP (per function instance).
- **Secrets are Luke's.** Never pick, print or commit `ADMIN_PASSWORD`. `ADMIN_SECRET` is generated with `openssl rand` and piped straight into `vercel env add`. The Blob store is created by Luke in the Vercel dashboard, and it must be a **public** store.
- `@vercel/blob` is the only runtime dependency. It's used by `api/` and `src/admin/` only; the game bundle must not import it.
- `Music MP3s/` stays local. Verify with a generated test tone, not Luke's files.

---

## File Map

```
api/_lib/session.ts          token sign/verify, cookie helpers, password check, isAdmin(request)
api/_lib/ratelimit.ts        in-memory limiter
api/_lib/stations-store.ts   versioned stations blobs: readLatest, writeVersion, prune, removedUrls
api/stations.ts              GET  public station list (cached 30s at the edge)
api/admin/login.ts           POST
api/admin/logout.ts          POST
api/admin/session.ts         GET  {admin: boolean}
api/admin/upload-token.ts    POST Blob client-upload token (session required)
api/admin/stations.ts        GET/PUT station list (session required)
admin.html                   admin page shell
src/admin/api.ts             fetch wrappers + upload + helpers
src/admin/main.ts            admin UI
src/admin/admin.css
tests/unit/api/*.test.ts
tests/e2e/admin.spec.ts
```

---

### Task 1: Server libraries (session, rate limit, versioned store)

**Files:**
- Create: `api/_lib/session.ts`, `api/_lib/ratelimit.ts`, `api/_lib/stations-store.ts`
- Modify: `tsconfig.json` (include `api`), `package.json` (dependency)
- Test: `tests/unit/api/session.test.ts`, `tests/unit/api/ratelimit.test.ts`, `tests/unit/api/stations-store.test.ts`

**Interfaces:**
- Consumes: `parseStationsFile`, `StationsFile` from `src/radio/schema.ts`.
- Produces:
  - `COOKIE`, `SESSION_SECONDS`, `createToken(secret, nowSec)`, `verifyToken(token, secret, nowSec)`, `passwordMatches(given, expected)`, `readCookie(req, name)`, `sessionCookie(token)`, `clearCookie()`, `env(name)`, `isAdmin(req)`.
  - `class RateLimiter(max, windowMs) { allow(key, now): boolean }`.
  - `PREFIX`, `versionPath(v)`, `readLatest(): Promise<{ file: StationsFile }>`, `writeVersion(file)`, `pruneOldVersions(keep?)`, `removedUrls(prev, next): string[]`, `isBlobUrl(url)`.

- [ ] **Step 1: Install the Blob SDK and include `api/` in type-checking**

```bash
npm install @vercel/blob
```

In `tsconfig.json`, change `"include"` to:
```json
  "include": ["src", "api", "tests", "vite.config.ts", "playwright.config.ts"]
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/api/session.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SESSION_SECONDS, createToken, passwordMatches, readCookie, sessionCookie, verifyToken } from '../../../api/_lib/session';

const SECRET = 'x'.repeat(40);

describe('session tokens', () => {
  it('verifies its own tokens until they expire', () => {
    const t = createToken(SECRET, 1000);
    expect(verifyToken(t, SECRET, 1000)).toBe(true);
    expect(verifyToken(t, SECRET, 1000 + SESSION_SECONDS + 1)).toBe(false);
  });
  it('rejects tampered, foreign and missing tokens', () => {
    const t = createToken(SECRET, 1000);
    const [exp, sig] = t.split('.');
    expect(verifyToken(`${Number(exp) + 999}.${sig}`, SECRET, 1000)).toBe(false);
    expect(verifyToken(t, 'y'.repeat(40), 1000)).toBe(false);
    expect(verifyToken(undefined, SECRET, 1000)).toBe(false);
    expect(verifyToken('garbage', SECRET, 1000)).toBe(false);
  });
  it('compares passwords exactly', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true);
    expect(passwordMatches('correct hors', 'correct horse')).toBe(false);
  });
  it('reads cookies and writes a locked-down session cookie', () => {
    const req = new Request('https://x/', { headers: { cookie: 'a=1; aglow_admin=tok%2Ben; b=2' } });
    expect(readCookie(req, 'aglow_admin')).toBe('tok+en');
    expect(sessionCookie('t')).toBe('aglow_admin=t; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800');
  });
});
```

`tests/unit/api/ratelimit.test.ts`:
```ts
import { expect, it } from 'vitest';
import { RateLimiter } from '../../../api/_lib/ratelimit';

it('allows up to max attempts per window, per key', () => {
  const r = new RateLimiter(3, 1000);
  expect([1, 2, 3, 4].map(() => r.allow('ip', 0))).toEqual([true, true, true, false]);
  expect(r.allow('other', 0)).toBe(true);
  expect(r.allow('ip', 1001)).toBe(true);
});
```

`tests/unit/api/stations-store.test.ts`:
```ts
import { expect, it } from 'vitest';
import { isBlobUrl, removedUrls, versionPath } from '../../../api/_lib/stations-store';
import type { StationsFile } from '../../../src/radio/schema';

const B = 'https://abc123.public.blob.vercel-storage.com';
const file = (urls: string[]): StationsFile => ({
  version: 1,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', cover: `${B}/covers/c.png`, tracks: urls.map((u, i) => ({ id: `t${i}`, url: u, title: 'T', artist: '', credit: '', duration: 1 })) }],
});

it('names versions so they sort lexically', () => {
  expect(versionPath(7)).toBe('stations/v000007.json');
});
it('lists blob URLs that are no longer referenced (never bundled paths)', () => {
  const prev = file([`${B}/tracks/a.mp3`, `${B}/tracks/b.mp3`, '/audio/piano/x.m4a']);
  const next = file([`${B}/tracks/b.mp3`]);
  expect(removedUrls(prev, next)).toEqual([`${B}/tracks/a.mp3`]);
  expect(isBlobUrl('/audio/piano/x.m4a')).toBe(false);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/api`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `api/_lib/session.ts`**

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'aglow_admin';
export const SESSION_SECONDS = 7 * 24 * 3600;

const sign = (payload: string, secret: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

/** `<expiry>.<hmac>`: stateless, so it works across function instances. */
export function createToken(secret: string, nowSec: number): string {
  const exp = nowSec + SESSION_SECONDS;
  return `${exp}.${sign(`admin.${exp}`, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string, nowSec: number): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < nowSec || !sig) return false;
  const expected = Buffer.from(sign(`admin.${exp}`, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Constant-time comparison (hash first so lengths match). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export const sessionCookie = (token: string): string =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = (): string => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const isAdmin = (req: Request): boolean =>
  verifyToken(readCookie(req, COOKIE), env('ADMIN_SECRET'), Math.floor(Date.now() / 1000));
```

- [ ] **Step 5: Implement `api/_lib/ratelimit.ts`**

```ts
/** Basic per-instance limiter (spec §7: "a basic rate limit applies to login attempts"). */
export class RateLimiter {
  private readonly hits = new Map<string, { n: number; reset: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  allow(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || now > h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}
```

- [ ] **Step 6: Implement `api/_lib/stations-store.ts`**

```ts
import { del, list, put } from '@vercel/blob';
import { parseStationsFile, type StationsFile } from '../../src/radio/schema';

export const PREFIX = 'stations/';
export const versionPath = (v: number): string => `${PREFIX}v${String(v).padStart(6, '0')}.json`;
const VERSION_RE = /^stations\/v\d{6}\.json$/;

async function versionBlobs(): Promise<{ pathname: string; url: string }[]> {
  const { blobs } = await list({ prefix: PREFIX });
  return blobs.filter((b) => VERSION_RE.test(b.pathname)).sort((a, b) => a.pathname.localeCompare(b.pathname));
}

/** Newest version, found via list() (strongly consistent). Each version blob is immutable, so reading it is safe to cache. */
export async function readLatest(): Promise<{ file: StationsFile }> {
  const latest = (await versionBlobs()).pop();
  if (!latest) return { file: { version: 0, stations: [] } };
  const r = await fetch(latest.url);
  const file = parseStationsFile(await r.json());
  if (!file) throw new Error('Stored stations file is invalid');
  return { file };
}

/** Throws if this version already exists (Blob refuses to overwrite by default), which signals a concurrent save. */
export async function writeVersion(file: StationsFile): Promise<void> {
  await put(versionPath(file.version), JSON.stringify(file), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
}

export async function pruneOldVersions(keep = 5): Promise<void> {
  const all = await versionBlobs();
  const old = all.slice(0, Math.max(0, all.length - keep)).map((b) => b.url);
  if (old.length) await del(old);
}

export const isBlobUrl = (u: string): boolean => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(u);

const urlsOf = (f: StationsFile): string[] =>
  f.stations.flatMap((s) => [s.cover, ...s.tracks.flatMap((t) => [t.url, t.cover])]).filter((u): u is string => typeof u === 'string');

/** Blob URLs referenced before but not after a save; their files get deleted. */
export function removedUrls(prev: StationsFile, next: StationsFile): string[] {
  const keep = new Set(urlsOf(next));
  return [...new Set(urlsOf(prev))].filter((u) => !keep.has(u) && isBlobUrl(u));
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run tests/unit/api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api tests/unit/api tsconfig.json package.json package-lock.json
git commit -m "feat(api): signed admin sessions, login rate limiter, versioned station storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API endpoints

**Files:**
- Create: `api/stations.ts`, `api/admin/login.ts`, `api/admin/logout.ts`, `api/admin/session.ts`, `api/admin/upload-token.ts`, `api/admin/stations.ts`
- Test: `tests/unit/api/handlers.test.ts`

**Interfaces:**
- Consumes: Task 1 libraries; `handleUpload`, `HandleUploadBody` from `@vercel/blob/client`.
- Produces:
  - `GET /api/stations` returns a `StationsFile`, or 503.
  - `POST /api/admin/login {password}` returns 200 with Set-Cookie, 401, or 429.
  - `POST /api/admin/logout` clears the cookie.
  - `GET /api/admin/session` returns `{admin: boolean}`.
  - `POST /api/admin/upload-token` is the Blob client-upload handshake.
  - `GET /api/admin/stations` returns a `StationsFile`.
  - `PUT /api/admin/stations {expectedVersion, stations}` returns `{version}`, 400, 401 or 409.

- [ ] **Step 1: Write the failing tests**

`tests/unit/api/handlers.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({ list: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ handleUpload: vi.fn(async () => ({ type: 'blob.generate-client-token', clientToken: 'tok' })) }));

import { del, list, put } from '@vercel/blob';
import { createToken } from '../../../api/_lib/session';
import * as login from '../../../api/admin/login';
import * as adminStations from '../../../api/admin/stations';
import * as upload from '../../../api/admin/upload-token';
import * as publicStations from '../../../api/stations';

const SECRET = 's'.repeat(40);
process.env.ADMIN_PASSWORD = 'let-it-snow';
process.env.ADMIN_SECRET = SECRET;
const B = 'https://abc123.public.blob.vercel-storage.com';
const authed = () => ({ cookie: `aglow_admin=${createToken(SECRET, Math.floor(Date.now() / 1000))}` });
const v3 = {
  version: 3,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [
    { id: 'a', url: `${B}/tracks/a.mp3`, title: 'A', artist: '', credit: '', duration: 1 },
    { id: 'b', url: `${B}/tracks/b.mp3`, title: 'B', artist: '', credit: '', duration: 1 },
  ] }],
};

beforeEach(() => {
  vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'stations/v000003.json', url: `${B}/stations/v000003.json` }], hasMore: false } as unknown as Awaited<ReturnType<typeof list>>);
  vi.mocked(put).mockReset();
  vi.mocked(del).mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(v3))));
});

describe('login', () => {
  const post = (password: string, ip: string) =>
    login.POST(new Request('https://x/api/admin/login', { method: 'POST', headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' }, body: JSON.stringify({ password }) }));
  it('rejects a wrong password', async () => {
    expect((await post('nope', '1.1.1.1')).status).toBe(401);
  });
  it('sets a locked-down session cookie for the right password', async () => {
    const r = await post('let-it-snow', '2.2.2.2');
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/^aglow_admin=.+; HttpOnly; Secure; SameSite=Strict/);
  });
  it('rate-limits after 10 attempts', async () => {
    for (let k = 0; k < 10; k++) await post('nope', '3.3.3.3');
    expect((await post('let-it-snow', '3.3.3.3')).status).toBe(429);
  });
});

describe('admin stations', () => {
  it('requires a session', async () => {
    expect((await adminStations.GET(new Request('https://x/api/admin/stations'))).status).toBe(401);
  });
  it('returns the latest version to an admin', async () => {
    const r = await adminStations.GET(new Request('https://x/api/admin/stations', { headers: authed() }));
    expect(await r.json()).toEqual(v3);
  });
  it('refuses a stale save', async () => {
    const r = await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: JSON.stringify({ expectedVersion: 2, stations: v3.stations }) }));
    expect(r.status).toBe(409);
  });
  it('rejects invalid data', async () => {
    const bad = [{ ...v3.stations[0], id: 'Not An Id' }];
    const r = await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: JSON.stringify({ expectedVersion: 3, stations: bad }) }));
    expect(r.status).toBe(400);
  });
  it('writes the next version and deletes files that were removed', async () => {
    const next = [{ ...v3.stations[0], tracks: [v3.stations[0].tracks[1]] }];
    const r = await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: JSON.stringify({ expectedVersion: 3, stations: next }) }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 4 });
    expect(vi.mocked(put).mock.calls[0][0]).toBe('stations/v000004.json');
    expect(vi.mocked(del)).toHaveBeenCalledWith([`${B}/tracks/a.mp3`]);
  });
  it('reports a concurrent save as a conflict', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('This blob already exists'));
    const r = await adminStations.PUT(new Request('https://x/', { method: 'PUT', headers: authed(), body: JSON.stringify({ expectedVersion: 3, stations: v3.stations }) }));
    expect(r.status).toBe(409);
  });
});

describe('uploads and the public list', () => {
  it('refuses to issue upload tokens without a session', async () => {
    const r = await upload.POST(new Request('https://x/', { method: 'POST', body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: 'tracks/x.mp3' } }) }));
    expect(r.status).toBe(401);
  });
  it('issues tokens to an admin', async () => {
    const r = await upload.POST(new Request('https://x/', { method: 'POST', headers: authed(), body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: 'tracks/x.mp3' } }) }));
    expect(r.status).toBe(200);
  });
  it('serves the public list with an edge cache header, and an empty list when nothing is stored', async () => {
    const r = await publicStations.GET();
    expect(r.headers.get('cache-control')).toContain('s-maxage=30');
    expect(await r.json()).toEqual(v3);
    vi.mocked(list).mockResolvedValueOnce({ blobs: [], hasMore: false } as unknown as Awaited<ReturnType<typeof list>>);
    expect(await (await publicStations.GET()).json()).toEqual({ version: 0, stations: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/api/handlers.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the endpoints**

`api/stations.ts`:
```ts
import { readLatest } from './_lib/stations-store';

/** Public station list for the game (Plan 2 fetches this). */
export async function GET(): Promise<Response> {
  try {
    const { file } = await readLatest();
    return Response.json(file, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300' } });
  } catch {
    return Response.json({ error: 'Stations are unavailable' }, { status: 503 });
  }
}
```

`api/admin/login.ts`:
```ts
import { RateLimiter } from '../_lib/ratelimit';
import { createToken, env, passwordMatches, sessionCookie } from '../_lib/session';

const limiter = new RateLimiter(10, 15 * 60 * 1000);

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!limiter.allow(ip, Date.now())) return Response.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  let password = '';
  try {
    const body: unknown = await req.json();
    if (typeof body === 'object' && body !== null && typeof (body as { password?: unknown }).password === 'string') {
      password = (body as { password: string }).password;
    }
  } catch {
    // treated as an empty password
  }
  if (!passwordMatches(password, env('ADMIN_PASSWORD'))) return Response.json({ error: 'Wrong password' }, { status: 401 });
  const token = createToken(env('ADMIN_SECRET'), Math.floor(Date.now() / 1000));
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
```

`api/admin/logout.ts`:
```ts
import { clearCookie } from '../_lib/session';

export function POST(): Response {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}
```

`api/admin/session.ts`:
```ts
import { isAdmin } from '../_lib/session';

export function GET(req: Request): Response {
  return Response.json({ admin: isAdmin(req) }, { headers: { 'Cache-Control': 'no-store' } });
}
```

`api/admin/upload-token.ts`:
```ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAdmin } from '../_lib/session';

const AUDIO = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg'];
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

/** Blob client-upload handshake. Token requests need a session; completion callbacks are verified by the SDK. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  if (body.type === 'blob.generate-client-token' && !isAdmin(req)) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^(tracks|covers)\/[a-z0-9-]+\//.test(pathname)) throw new Error('Uploads must go to tracks/<station>/ or covers/<station>/');
        return {
          allowedContentTypes: pathname.startsWith('covers/') ? IMAGES : AUDIO,
          maximumSizeInBytes: 30 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do: the admin saves the track into the station list itself.
      },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

`api/admin/stations.ts`:
```ts
import { del } from '@vercel/blob';
import { parseStationsFile } from '../../src/radio/schema';
import { isAdmin } from '../_lib/session';
import { pruneOldVersions, readLatest, removedUrls, writeVersion } from '../_lib/stations-store';

const unauthorized = () => Response.json({ error: 'Not signed in' }, { status: 401 });
const conflict = () => Response.json({ error: 'Stations changed somewhere else. Reload to get the latest, then redo your change.' }, { status: 409 });

export async function GET(req: Request): Promise<Response> {
  if (!isAdmin(req)) return unauthorized();
  const { file } = await readLatest();
  return Response.json(file, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: Request): Promise<Response> {
  if (!isAdmin(req)) return unauthorized();
  let body: { expectedVersion?: unknown; stations?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const current = (await readLatest()).file;
  if (body.expectedVersion !== current.version) return conflict();
  const next = parseStationsFile({ version: current.version + 1, stations: body.stations });
  if (!next) return Response.json({ error: 'Some station or track fields are invalid. Every track needs a title.' }, { status: 400 });
  try {
    await writeVersion(next);
  } catch {
    return conflict();
  }
  const removed = removedUrls(current, next);
  try {
    if (removed.length) await del(removed);
    await pruneOldVersions();
  } catch {
    // Cleanup is best-effort; the save itself succeeded.
  }
  return Response.json({ version: next.version });
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/unit/api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api tests/unit/api
git commit -m "feat(api): public station list, admin login/session, upload tokens, versioned station saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin page

**Files:**
- Create: `admin.html`, `src/admin/api.ts`, `src/admin/main.ts`, `src/admin/admin.css`
- Modify: `vite.config.ts` (multi-page build), `vercel.json` (rewrite `/admin`)
- Test: `tests/unit/admin/helpers.test.ts`, `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `StationsFile`, `Station`, `Track`, `parseStationsFile`, `upload` from `@vercel/blob/client`.
- Produces: `api` client, `audioDuration(file)`, `titleFromFilename(name)`, `slugify(name)`, and the admin UI mounted at `#admin`.

- [ ] **Step 1: Write the failing helper test**

`tests/unit/admin/helpers.test.ts`:
```ts
import { expect, it } from 'vitest';
import { slugify, titleFromFilename } from '../../../src/admin/api';

it('derives the station ids Plan 2 expects', () => {
  expect(slugify('Christmas Jazz')).toBe('christmas-jazz');
  expect(slugify('Christmas Classics')).toBe('christmas-classics');
  expect(slugify('  Crème Brûlée!! ')).toBe('creme-brulee');
});
it('guesses title and artist from "Artist - Title" filenames', () => {
  expect(titleFromFilename('Bing Crosby - White Christmas.mp3')).toEqual({ artist: 'Bing Crosby', title: 'White Christmas' });
  expect(titleFromFilename('Sleigh Ride.mp3')).toEqual({ artist: '', title: 'Sleigh Ride' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/admin`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/admin/api.ts`**

```ts
import { upload } from '@vercel/blob/client';
import type { Station, StationsFile } from '../radio/schema';

async function json<T>(r: Response): Promise<T> {
  const data: unknown = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data as T;
}

const send = (method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  session: () => fetch('/api/admin/session', { cache: 'no-store' }).then((r) => json<{ admin: boolean }>(r)),
  login: (password: string) => send('POST', '/api/admin/login', { password }).then((r) => json<{ ok: true }>(r)),
  logout: () => send('POST', '/api/admin/logout'),
  load: () => fetch('/api/admin/stations', { cache: 'no-store' }).then((r) => json<StationsFile>(r)),
  save: (expectedVersion: number, stations: Station[]) => send('PUT', '/api/admin/stations', { expectedVersion, stations }).then((r) => json<{ version: number }>(r)),
  uploadFile: (folder: 'tracks' | 'covers', stationId: string, file: File, onProgress: (pct: number) => void) =>
    upload(`${folder}/${stationId}/${file.name}`, file, {
      access: 'public',
      handleUploadUrl: '/api/admin/upload-token',
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: (e) => onProgress(e.percentage),
    }),
};

export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration) : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}

export function titleFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

export function slugify(s: string): string {
  return (
    s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'station'
  );
}
```

- [ ] **Step 4: Create `admin.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Aglow · Radio admin</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="admin"></div>
    <script type="module" src="/src/admin/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/admin/admin.css`**

```css
:root { --ink: #f4e6cf; --dim: rgba(244, 230, 207, 0.55); --line: rgba(255, 236, 210, 0.1); --panel: rgba(255, 255, 255, 0.04); --accent: #ffb070; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; font-family: Inter, system-ui, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased;
  background: radial-gradient(60% 60% at 0% 100%, rgba(255, 120, 40, 0.18), transparent 70%), #0e0906; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 14px; }
button.primary { background: var(--ink); color: #140b06; border-color: transparent; font-weight: 600; }
button:disabled { opacity: 0.4; cursor: default; }
input { width: 100%; padding: 9px 11px; border-radius: 9px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.25); }
.wm { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 500; letter-spacing: 0.5em; text-transform: uppercase; }
.wm .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.login { max-width: 340px; margin: 18vh auto 0; display: flex; flex-direction: column; gap: 14px; padding: 28px; border: 1px solid var(--line); border-radius: 20px; background: var(--panel); }
.login h1 { margin: 6px 0 4px; font-size: 20px; font-weight: 600; }
.err { color: var(--accent); font-size: 13px; min-height: 1em; margin: 0; }
header { display: flex; align-items: center; gap: 12px; padding: 18px 24px; border-bottom: 1px solid var(--line); position: sticky; top: 0; backdrop-filter: blur(16px); background: rgba(14, 9, 6, 0.8); z-index: 2; }
header .sub { color: var(--dim); font-size: 13px; }
.spacer { flex: 1; }
.layout { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 70px); }
nav.stations { border-right: 1px solid var(--line); padding: 16px; display: flex; flex-direction: column; gap: 6px; }
nav .station { text-align: left; display: flex; flex-direction: column; gap: 2px; border-color: transparent; background: none; }
nav .station.on { background: rgba(255, 176, 112, 0.12); }
nav .station small { color: var(--dim); }
nav .add { margin-top: 8px; border-style: dashed; }
main { padding: 24px; max-width: 1000px; }
.fields { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 18px; }
.fields label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--dim); }
.meta-row { display: flex; gap: 10px; align-items: center; margin-bottom: 22px; color: var(--dim); font-size: 13px; flex-wrap: wrap; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--dim); font-weight: 500; padding: 8px 6px; }
td { padding: 4px 6px; border-top: 1px solid var(--line); vertical-align: middle; }
td.num, td.dur { color: var(--dim); font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; }
td.actions { width: 1%; white-space: nowrap; }
td.actions button { padding: 5px 9px; }
.uploads { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.drop { border: 1px dashed rgba(255, 236, 210, 0.25); border-radius: 14px; padding: 18px; text-align: center; color: var(--dim); }
.drop.over { border-color: var(--accent); color: var(--ink); }
.progress { font-size: 12px; color: var(--dim); }
.empty { color: var(--dim); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #140b06; padding: 10px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } nav.stations { border-right: 0; border-bottom: 1px solid var(--line); } .fields { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Implement `src/admin/main.ts`**

```ts
import './admin.css';
import { parseStationsFile, type Station, type StationsFile, type Track } from '../radio/schema';
import { api, audioDuration, slugify, titleFromFilename } from './api';

const root = document.getElementById('admin') as HTMLElement;
let file: StationsFile = { version: 0, stations: [] };
let selected: string | null = null;
let dirty = false;
let busy = 0;
let saveBtn: HTMLButtonElement | null = null;
let subtitle: HTMLElement | null = null;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string };
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const current = (): Station | undefined => file.stations.find((s) => s.id === selected);

function toast(text: string): void {
  const t = h('div', { class: 'toast', textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function touch(): void {
  dirty = true;
  refreshHeader();
}

function refreshHeader(): void {
  if (saveBtn) {
    saveBtn.disabled = !dirty || busy > 0;
    saveBtn.textContent = busy > 0 ? `Uploading ${busy}…` : 'Save';
  }
  if (subtitle) subtitle.textContent = `Radio admin · v${file.version}${dirty ? ' · unsaved changes' : ''}`;
}

addEventListener('beforeunload', (e) => {
  if (dirty || busy > 0) e.preventDefault();
});

async function boot(): Promise<void> {
  try {
    const { admin } = await api.session();
    if (admin) await loadAndRender();
    else renderLogin();
  } catch (e) {
    root.replaceChildren(h('p', { class: 'err', textContent: `Couldn't reach the server: ${(e as Error).message}` }));
  }
}

function renderLogin(message = ''): void {
  const input = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const form = h(
    'form',
    { class: 'login' },
    h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'),
    h('h1', { textContent: 'Radio admin' }),
    input,
    h('button', { type: 'submit', class: 'primary', textContent: 'Sign in' }),
    h('p', { class: 'err', textContent: message }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.login(input.value);
      await loadAndRender();
    } catch (x) {
      renderLogin((x as Error).message);
    }
  });
  root.replaceChildren(form);
  input.focus();
}

async function loadAndRender(): Promise<void> {
  file = await api.load();
  selected = selected && file.stations.some((s) => s.id === selected) ? selected : (file.stations[0]?.id ?? null);
  dirty = false;
  render();
}

async function save(): Promise<void> {
  if (!parseStationsFile({ version: 0, stations: file.stations })) {
    alert('Some fields are invalid. Every track needs a title, and station names can be at most 60 characters.');
    return;
  }
  try {
    const r = await api.save(file.version, file.stations);
    file.version = r.version;
    dirty = false;
    refreshHeader();
    toast('Saved. Live in the game within ~30 seconds');
  } catch (e) {
    alert((e as Error).message);
  }
}

function addStation(): void {
  const name = prompt('Station name (e.g. Christmas Jazz)')?.trim();
  if (!name) return;
  const id = slugify(name);
  if (file.stations.some((s) => s.id === id)) {
    alert(`A station with the id "${id}" already exists.`);
    return;
  }
  file.stations.push({ id, name: name.slice(0, 60), description: '', tracks: [] });
  selected = id;
  touch();
  render();
}

function render(): void {
  saveBtn = h('button', { class: 'primary', onclick: () => void save() });
  subtitle = h('span', { class: 'sub' });
  const header = h(
    'header',
    {},
    h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'),
    subtitle,
    h('div', { class: 'spacer' }),
    saveBtn,
    h('button', {
      textContent: 'Sign out',
      onclick: async () => {
        await api.logout();
        renderLogin();
      },
    }),
  );
  const nav = h(
    'nav',
    { class: 'stations' },
    ...file.stations.map((s) =>
      h(
        'button',
        { class: `station${s.id === selected ? ' on' : ''}`, onclick: () => ((selected = s.id), render()) },
        h('b', { textContent: s.name }),
        h('small', { textContent: `${s.id} · ${s.tracks.length} tracks` }),
      ),
    ),
    h('button', { class: 'add', textContent: '+ New station', onclick: addStation }),
  );
  const s = current();
  const main = h('main', {}, s ? stationEditor(s) : h('p', { class: 'empty', textContent: 'Create a station to start uploading music.' }));
  root.replaceChildren(header, h('div', { class: 'layout' }, nav, main));
  refreshHeader();
}

function stationEditor(s: Station): HTMLElement {
  const name = h('input', { value: s.name, maxLength: 60 });
  name.addEventListener('input', () => {
    s.name = name.value;
    touch();
  });
  const desc = h('input', { value: s.description, maxLength: 200, placeholder: 'Shown under the station name' });
  desc.addEventListener('input', () => {
    s.description = desc.value;
    touch();
  });
  const coverInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  coverInput.addEventListener('change', async () => {
    const f = coverInput.files?.[0];
    if (!f) return;
    busy++;
    refreshHeader();
    try {
      const blob = await api.uploadFile('covers', s.id, f, () => undefined);
      s.cover = blob.url;
      touch();
      render();
    } catch (e) {
      alert(`Cover upload failed: ${(e as Error).message}`);
    } finally {
      busy--;
      refreshHeader();
    }
  });
  const meta = h(
    'div',
    { class: 'meta-row' },
    h('span', { textContent: `id: ${s.id}` }),
    h('button', { textContent: s.cover ? 'Replace cover' : 'Add cover', onclick: () => coverInput.click() }),
    coverInput,
    h('button', {
      textContent: 'Delete station',
      onclick: () => {
        if (!confirm(`Delete "${s.name}" and all ${s.tracks.length} of its tracks? The files are removed when you Save.`)) return;
        file.stations = file.stations.filter((x) => x.id !== s.id);
        selected = file.stations[0]?.id ?? null;
        touch();
        render();
      },
    }),
  );
  const fields = h(
    'div',
    { class: 'fields' },
    h('label', {}, 'Name', name),
    h('label', {}, 'Description', desc),
  );
  return h('section', {}, fields, meta, trackTable(s), uploader(s));
}

function trackTable(s: Station): HTMLElement {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= s.tracks.length) return;
    [s.tracks[i], s.tracks[j]] = [s.tracks[j], s.tracks[i]];
    touch();
    render();
  };
  const cell = (t: Track, key: 'title' | 'artist' | 'credit', placeholder: string) => {
    const input = h('input', { value: t[key], placeholder, maxLength: key === 'credit' ? 500 : 200 });
    input.addEventListener('input', () => {
      t[key] = input.value;
      touch();
    });
    return h('td', {}, input);
  };
  const rows = s.tracks.map((t, i) =>
    h(
      'tr',
      {},
      h('td', { class: 'num', textContent: String(i + 1) }),
      cell(t, 'title', 'Title'),
      cell(t, 'artist', 'Artist'),
      cell(t, 'credit', 'Credit line (optional; required for CC-BY)'),
      h('td', { class: 'dur', textContent: fmt(t.duration) }),
      h(
        'td',
        { class: 'actions' },
        h('button', { textContent: '↑', title: 'Move up', onclick: () => move(i, -1) }),
        h('button', { textContent: '↓', title: 'Move down', onclick: () => move(i, 1) }),
        h('button', {
          textContent: '✕',
          title: 'Remove',
          onclick: () => {
            s.tracks.splice(i, 1);
            touch();
            render();
          },
        }),
      ),
    ),
  );
  const head = h('tr', {}, ...['#', 'Title', 'Artist', 'Credit', 'Length', ''].map((x) => h('th', { textContent: x })));
  return rows.length ? h('table', {}, h('thead', {}, head), h('tbody', {}, ...rows)) : h('p', { class: 'empty', textContent: 'No tracks yet.' });
}

function uploader(s: Station): HTMLElement {
  const input = h('input', { type: 'file', multiple: true, accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.aac,.ogg', hidden: true });
  const list = h('div', { class: 'uploads' });
  const drop = h('div', { class: 'drop' }, 'Drop audio files here or ', h('button', { textContent: 'choose files', onclick: () => input.click() }), ' · max 30 MB each · 192 kbps or lower recommended');
  const handle = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) void uploadOne(s, f, list);
  };
  input.addEventListener('change', () => handle(input.files));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handle(e.dataTransfer?.files ?? null);
  });
  return h('div', {}, drop, input, list);
}

async function uploadOne(s: Station, f: File, list: HTMLElement): Promise<void> {
  const line = h('div', { class: 'progress', textContent: `${f.name}: starting…` });
  list.append(line);
  busy++;
  refreshHeader();
  try {
    const [duration, blob] = await Promise.all([
      audioDuration(f),
      api.uploadFile('tracks', s.id, f, (pct) => (line.textContent = `${f.name}: ${Math.round(pct)}%`)),
    ]);
    const { title, artist } = titleFromFilename(f.name);
    s.tracks.push({ id: crypto.randomUUID(), url: blob.url, title, artist, credit: '', duration });
    line.remove();
    touch();
    render();
  } catch (e) {
    line.textContent = `${f.name}: failed (${(e as Error).message})`;
  } finally {
    busy--;
    refreshHeader();
  }
}

void boot();
```

- [ ] **Step 7: Build both pages and route `/admin`**

In `vite.config.ts`, replace `build: { target: 'es2022' },` with:
```ts
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
```

Replace `vercel.json` with:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/admin", "destination": "/admin.html" }],
  "headers": [{ "source": "/admin(.html)?", "headers": [{ "key": "X-Robots-Tag", "value": "noindex" }] }]
}
```

- [ ] **Step 8: e2e: the admin page renders a login when there's no API** (the preview server has no functions, so `session()` fails and the error path shows)

`tests/e2e/admin.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('admin page loads and asks for sign-in (or reports the server is unreachable)', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":false}' }));
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Radio admin' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeFocused();
});

test('the game bundle does not include the Blob SDK', async ({ page }) => {
  const scripts: string[] = [];
  page.on('response', async (r) => {
    if (r.url().endsWith('.js')) scripts.push(await r.text());
  });
  await page.goto('/?test');
  await page.waitForLoadState('networkidle');
  expect(scripts.join('\n')).not.toContain('handleUploadUrl');
});
```

- [ ] **Step 9: Run everything**

Run: `npm test && npm run build && npm run e2e`
Expected: all unit and e2e tests pass; `dist/` contains both `index.html` and `admin.html`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(admin): password-protected radio admin with direct-to-Blob uploads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Provision Blob and secrets, verify on a preview deployment

**Files:** none (hosting configuration).

- [ ] **Step 1: Ask Luke to create the Blob store** (dashboard; this is his account action)

Tell Luke:
1. Open the Vercel dashboard → project **aglow** → **Storage** → **Create** → **Blob**.
2. Name it `aglow-music` and choose **Public** access (required so tracks can stream).
3. Connect it to the project for **Production, Preview and Development**. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.

- [ ] **Step 2: Add the secrets**

`ADMIN_SECRET` is random and never displayed. Run once for each environment:
```bash
for e in production preview development; do openssl rand -base64 48 | tr -d '\n' | npx vercel env add ADMIN_SECRET $e; done
```

`ADMIN_PASSWORD` is Luke's choice. Ask Luke to run this himself (repeat with `preview` and `development`) and type the password at the prompt:
```bash
npx vercel env add ADMIN_PASSWORD production
```

- [ ] **Step 3: Deploy a preview and smoke-test the API**

```bash
npx vercel deploy
```
Note the preview URL (`$P` below), then check:
```bash
curl -s "$P/api/stations"
curl -s -o /dev/null -w '%{http_code}\n' "$P/api/admin/stations"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$P/api/admin/login" -H 'content-type: application/json' -d '{"password":"definitely-wrong"}'
```
Expected:
- The first returns `{"version":0,"stations":[]}`.
- The second returns `401`.
- The third returns `401`.

If the preview is protected by Vercel Authentication, use `npx vercel curl` or open the URLs in a logged-in browser instead.

- [ ] **Step 4: End-to-end in the browser** (Luke signs in; the executor watches)

On `$P/admin`:
1. Luke signs in.
2. Create the stations **Christmas Jazz** and **Christmas Classics**. Confirm the ids are shown as `christmas-jazz` / `christmas-classics`.
3. Upload a generated test tone to Christmas Classics (not Luke's music), created with:
   ```bash
   ffmpeg -f lavfi -i sine=frequency=440:duration=5 -c:a aac -b:a 128k /tmp/aglow-test-tone.m4a
   ```
4. Click **Save**. Expect `v1`.
5. Open `$P/?test` in another tab, tap once, and open the radio panel. **Christmas Classics** is listed and plays the tone within ~30s of saving.
6. Back in admin, remove the test track and Save (`v2`). The blob is deleted.

- [ ] **Step 5: Check CORS on Blob audio** (the analyser needs it; Plan 2 sets `crossOrigin='anonymous'`)

```bash
curl -sI "<a track URL from the admin table>" -H "Origin: https://aglow.lukeghanna.com" | grep -i access-control-allow-origin
```
Expected: `access-control-allow-origin: *`.

If the header is missing, audio would fail to load with `crossOrigin` set. In that case:
- In `src/radio/player.ts`, only set `crossOrigin = 'anonymous'` for site-relative URLs:
  1. In the `Deck` constructor, remove the `crossOrigin` line.
  2. In `load()`, add `incoming.el.crossOrigin = track.url.startsWith('/') ? 'anonymous' : null;` before assigning `src`.
- Make the light show ignore remote stations: `lightShowActive` should also require `this.kind === 'fireplace'` or the current track URL to start with `/`.
- Commit that change and tell Luke.

- [ ] **Step 6: Promote to production**

```bash
npx vercel deploy --prod
```
Then open `https://aglow.lukeghanna.com/admin`. Luke can now upload the real Jazz and Classics tracks. His track lists are the Spotify playlists recorded in the spec (§11); the audio comes from files he supplies himself, ideally exported at ≤192 kbps.

---

## Self-Review Notes

- **Spec coverage:**

| Spec §7 | Task |
|---|---|
| Auth: password env, constant-time, HttpOnly/Secure/SameSite=Strict HMAC cookie for 7 days, rate limit | Tasks 1–2 |
| Station CRUD and reorder | Task 3 |
| Track upload (client uploads, allowed types, 30 MB, duration read client-side), edit, reorder, delete (blob removed on save) | Tasks 2–3 |
| Data format and optimistic concurrency | Tasks 1–2, strengthened to immutable version blobs |
| Cost note | Task 4 Step 6 recommends ≤192 kbps |

- **§8:** admin errors surface as alerts, with a conflict message prompting a reload. Upload failures show per file. (The spec's single automatic retry is replaced by the failure line and a manual re-drop; the Blob SDK already retries parts internally for multipart uploads.)
- **Cross-plan:** `GET /api/stations` returns a `StationsFile` that satisfies Plan 2's `parseStationsFile`. The station ids match `SCENE_STATION`.
