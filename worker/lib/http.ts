/** A failure with a status and a stable code; the router answers `{error: code, message}`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** JSON that is never cached anywhere (the public lists pass their own Cache-Control). */
export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { 'Cache-Control': 'no-store', ...init.headers } });
}

export const errorResponse = (e: HttpError): Response => json({ error: e.code, message: e.message }, { status: e.status });

export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export const notConfigured = (): Response => json({ error: 'Admin is not configured' }, { status: 503 });

/** Browsers send Origin on every write, so a state-changing request must carry one equal to its own origin. A missing header fails too. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return origin !== null && origin === new URL(req.url).origin;
}

/**
 * Writes (anything but GET) must be same-origin JSON, so another site can't act with a visitor's cookie. The
 * raw-audio upload is the one exception to the JSON rule.
 */
export function checkWrite(req: Request, pathname: string): void {
  if (req.method === 'GET') return;
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const rawUpload = req.method === 'PUT' && pathname === '/api/admin/upload';
  if (!sameOrigin(req) || (!rawUpload && type !== 'application/json')) throw new HttpError(403, 'forbidden', 'Cross-origin request refused');
}

/** Reads the body as text, or returns null if it is larger than `max` bytes (it stops reading as soon as the cap is passed). */
export async function readTextCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** A finish carries a log of at most 5,000 entries: well under this. */
export const MAX_JSON_BYTES = 262_144;

/** The request's JSON object body: 413 past `max` bytes, 400 when it isn't a JSON object. An empty body is `{}`. */
export async function readJson(req: Request, max = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const text = await readTextCapped(req, max);
  if (text === null) throw new HttpError(413, 'too_large', 'That request is too large.');
  try {
    const value: unknown = JSON.parse(text || '{}');
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // not JSON: answered below
  }
  throw new HttpError(400, 'bad_json', "That request isn't valid JSON.");
}

export function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Every cookie the Worker sets: host-only, HTTPS only, never readable by scripts, sent on top-level navigations (Google's redirect back). */
export const cookie = (name: string, value: string, maxAgeSec: number): string =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

/** Set by Cloudflare's edge; a client cannot forge it the way it can X-Forwarded-For. */
export const clientIp = (req: Request): string => req.headers.get('cf-connecting-ip')?.trim() || 'unknown';

const HEXTET = /^[0-9a-f]{1,4}$/;

/** "a.b.c.d" as two hextets, or null. */
function v4Hextets(text: string): string[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  const b = m?.slice(1).map(Number);
  if (!b || b.some((x) => x > 255)) return null;
  return [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)];
}

/**
 * What the start rate limit counts by: an IPv4 address as it is; an IPv6 address by its /64 (a home or a host usually
 * holds a whole /64), written one way however the address was spelled. Anything unparseable stays as it is
 * (lower-cased), so it only ever limits itself.
 */
export function rateKey(ip: string): string {
  const text = ip.trim().toLowerCase();
  if (!text.includes(':')) return text;
  const halves = text.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '').split('::');
  if (halves.length > 2) return text;
  const groups = halves.map((h) => (h === '' ? [] : h.split(':')));
  const tail = groups[groups.length - 1];
  if (tail.length && tail[tail.length - 1].includes('.')) {
    const v4 = v4Hextets(tail[tail.length - 1]);
    if (!v4) return text;
    tail.splice(tail.length - 1, 1, ...v4);
  }
  const given = groups.flat();
  if (!given.every((g) => HEXTET.test(g))) return text;
  if (groups.length === 2 ? given.length > 7 : given.length !== 8) return text;
  const full = (groups.length === 2 ? [...groups[0], ...Array<string>(8 - given.length).fill('0'), ...groups[1]] : given).map((g) => parseInt(g, 16));
  // ::ffff:a.b.c.d is an IPv4 client: key it as one, not as the single /64 every such address shares.
  if (full.slice(0, 5).every((g) => g === 0) && full[5] === 0xffff) return [full[6] >> 8, full[6] & 255, full[7] >> 8, full[7] & 255].join('.');
  return `${full
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const isLocalHost = (req: Request): boolean => LOCAL_HOSTS.has(new URL(req.url).hostname);
