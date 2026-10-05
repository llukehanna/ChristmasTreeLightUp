export const COOKIE = 'aglow_admin';
export const SESSION_SECONDS = 7 * 24 * 3600;

/** Domain-separation label for the session key; bump it to sign everyone out on a format change. */
const KEY_LABEL = 'aglow-admin-v1\u0000';
const enc = new TextEncoder();

export interface AdminSecrets {
  password: string;
  secret: string;
}

/** Both secrets, or null when either is missing or blank (admin is then "not configured": 503, never a 500). */
export function adminSecrets(env: { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }): AdminSecrets | null {
  const password = env.ADMIN_PASSWORD;
  const secret = env.SESSION_SECRET;
  if (!password?.trim() || !secret?.trim()) return null;
  return { password, secret };
}

async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

let keyCache: { id: string; key: CryptoKey } | null = null;

/**
 * Session HMAC key: HMAC-SHA256(key = SESSION_SECRET, data = "aglow-admin-v1\0" + ADMIN_PASSWORD).
 * SESSION_SECRET is 256 random bits nobody sees, so a stolen token is no offline oracle for the password (and no
 * slow KDF is needed, which the Workers Free plan's 10 ms CPU budget would not allow). Changing either value
 * invalidates every session. One key is memoised per isolate, identified by a SHA-256 of both values: the raw values
 * are never kept as a cache key or logged.
 */
export async function sessionKey(secret: string, password: string): Promise<CryptoKey> {
  // Length-prefixed so the boundary between the two values is unambiguous.
  const id = hex(await sha256(`${secret.length}:${secret}${password}`));
  if (keyCache?.id === id) return keyCache.key;
  const outer = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const raw = await crypto.subtle.sign('HMAC', outer, enc.encode(`${KEY_LABEL}${password}`));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  // Single entry: an old password's key never lingers once the password changes.
  keyCache = { id, key };
  return key;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const TOKEN_RE = /^\d{1,12}\.[A-Za-z0-9_-]{43}$/;
const payload = (exp: number): Uint8Array<ArrayBuffer> => enc.encode(`admin.${exp}`);

/** `<expiry>.<base64url HMAC of "admin.<expiry>">`: stateless, so it works across isolates. */
export async function createToken(key: CryptoKey, nowSec: number): Promise<string> {
  const exp = nowSec + SESSION_SECONDS;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload(exp)));
  return `${exp}.${toBase64url(sig)}`;
}

export async function verifyToken(token: string | undefined, key: CryptoKey, nowSec: number): Promise<boolean> {
  if (!token || !TOKEN_RE.test(token)) return false;
  const [expStr, sigStr] = token.split('.');
  const exp = Number(expStr);
  // Canonical decimal only: "007" would otherwise carry a valid signature for 7.
  if (String(exp) !== expStr || exp < nowSec) return false;
  const sig = fromBase64url(sigStr);
  // Canonical base64url only: the last character has spare bits, so another spelling could decode to the same MAC.
  if (!sig || toBase64url(sig) !== sigStr) return false;
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', key, sig, payload(exp));
}

/** Constant-time comparison of SHA-256 digests (equal length whatever the inputs). */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 && a.length === b.length;
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

export async function isAdmin(req: Request, secrets: AdminSecrets): Promise<boolean> {
  const key = await sessionKey(secrets.secret, secrets.password);
  return verifyToken(readCookie(req, COOKIE), key, Math.floor(Date.now() / 1000));
}
