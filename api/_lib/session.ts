import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'aglow_admin';
export const SESSION_SECONDS = 7 * 24 * 3600;

/** Session HMAC key, derived from the admin password (HKDF-SHA256), so ADMIN_PASSWORD is the only secret. Changing the password invalidates every session. */
export const sessionKey = (password: string): Buffer => Buffer.from(hkdfSync('sha256', password, 'aglow-admin-v1', 'session', 32));

const sign = (payload: string, key: Buffer): string => createHmac('sha256', key).update(payload).digest('base64url');

/** `<expiry>.<hmac>`: stateless, so it works across function instances. */
export function createToken(key: Buffer, nowSec: number): string {
  const exp = nowSec + SESSION_SECONDS;
  return `${exp}.${sign(`admin.${exp}`, key)}`;
}

export function verifyToken(token: string | undefined, key: Buffer, nowSec: number): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < nowSec || !sig) return false;
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
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const isAdmin = (req: Request): boolean =>
  verifyToken(readCookie(req, COOKIE), sessionKey(env('ADMIN_PASSWORD')), Math.floor(Date.now() / 1000));
