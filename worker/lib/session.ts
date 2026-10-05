import { createHash, createHmac, hkdfSync, scryptSync, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'aglow_admin';
export const SESSION_SECONDS = 7 * 24 * 3600;

const KEY_SALT = 'aglow-admin-v1';
const keyCache = new Map<string, Buffer>();

/**
 * Session HMAC key, derived from the admin password, so ADMIN_PASSWORD is the only secret. Changing the password invalidates every session.
 * The password is stretched with scrypt first: a stolen token is an offline oracle for the key, so guessing the password must be slow.
 * The most recent result is memoised per instance (keyed by a hash of the password, which is never stored or logged).
 */
export function sessionKey(password: string): Buffer {
  const id = createHash('sha256').update(password).digest('hex');
  const hit = keyCache.get(id);
  if (hit) return hit;
  const stretched = scryptSync(password, KEY_SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const key = Buffer.from(hkdfSync('sha256', stretched, KEY_SALT, 'session', 32));
  // Single entry: an old password's key never lingers once the password changes.
  keyCache.clear();
  keyCache.set(id, key);
  return key;
}

const TOKEN_RE = /^\d{1,12}\.[A-Za-z0-9_-]{43}$/;
const sign = (payload: string, key: Buffer): string => createHmac('sha256', key).update(payload).digest('base64url');

/** `<expiry>.<hmac>`: stateless, so it works across function instances. */
export function createToken(key: Buffer, nowSec: number): string {
  const exp = nowSec + SESSION_SECONDS;
  return `${exp}.${sign(`admin.${exp}`, key)}`;
}

export function verifyToken(token: string | undefined, key: Buffer, nowSec: number): boolean {
  if (!token || !TOKEN_RE.test(token)) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  // Canonical decimal only: "007" would otherwise carry a valid signature for 7.
  if (String(exp) !== expStr || exp < nowSec) return false;
  const expected = Buffer.from(sign(`admin.${exp}`, key));
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
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        // A malformed escape is just an invalid cookie, not a server error.
        return undefined;
      }
    }
  }
  return undefined;
}

export const sessionCookie = (token: string): string =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = (): string => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set`);
  return v;
}

export const isAdmin = (req: Request): boolean =>
  verifyToken(readCookie(req, COOKIE), sessionKey(env('ADMIN_PASSWORD')), Math.floor(Date.now() / 1000));
