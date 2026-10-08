import { adminSecrets, isAdmin } from './session.js';

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

/** null when the caller has a valid session, otherwise the response to send (401, or 503 if a secret is unset). */
export async function requireAdmin(req: Request, env: { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }): Promise<Response | null> {
  const secrets = adminSecrets(env);
  if (!secrets) return notConfigured();
  return (await isAdmin(req, secrets)) ? null : json({ error: 'Not signed in' }, { status: 401 });
}

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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const isLocalHost = (req: Request): boolean => LOCAL_HOSTS.has(new URL(req.url).hostname);
