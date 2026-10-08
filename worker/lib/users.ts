import type { User } from '../../src/api/types.js';
import { hmac } from './crypto.js';
import type { AppEnv } from './env.js';
import { cookie, getCookie, HttpError } from './http.js';

export const SESSION_COOKIE = '__Host-aglow_session';
export const SESSION_DAYS = 365;
/** Sessions with less than this left are renewed by GET /api/me. */
export const RENEW_UNDER_DAYS = 182;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionUser {
  id: number;
  name: string | null;
  /** Lower-cased; verified by Google at sign-in. Never shown publicly. */
  email: string;
  expiresAt: number;
  /** The tree's topper preference (migration 0003). */
  starHead: boolean;
  /** The cookie's token, to set the cookie again on renewal. */
  token: string;
  tokenHash: string;
}

/** AUTH_SECRET, or 503 not_configured: no session, claim or IP hash without it. */
export function authSecret(env: AppEnv): string {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new HttpError(503, 'not_configured', 'Accounts are not configured.');
  return secret;
}

/** D1 stores only this, so a leaked table holds no usable token. */
export const sessionHash = (secret: string, token: string): Promise<string> => hmac(secret, `session:${token}`);
export const sessionCookie = (token: string): string => cookie(SESSION_COOKIE, token, SESSION_DAYS * 86_400);
export const clearSessionCookie = (): string => cookie(SESSION_COOKIE, '', 0);

export async function currentUser(req: Request, env: AppEnv): Promise<SessionUser | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !TOKEN.test(token)) return null;
  const tokenHash = await sessionHash(authSecret(env), token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.name, u.email, u.star_head, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(tokenHash, Date.now())
    .first<{ id: number; name: string | null; email: string; star_head: number; expires_at: number }>();
  return row && { id: row.id, name: row.name, email: row.email, starHead: row.star_head === 1, expiresAt: row.expires_at, token, tokenHash };
}

export async function requireUser(req: Request, env: AppEnv): Promise<SessionUser> {
  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, 'signed_out', 'Sign in first.');
  return user;
}

export function adminEmails(env: AppEnv): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isAdmin = (env: AppEnv, email: string): boolean => adminEmails(env).has(email.toLowerCase());

/** The radio admin: 401 signed out, 403 for any other account. */
export async function requireAdmin(req: Request, env: AppEnv): Promise<SessionUser> {
  const user = await requireUser(req, env);
  if (!isAdmin(env, user.email)) throw new HttpError(403, 'forbidden', 'This account is not the radio admin.');
  return user;
}

/** What the browser may know about the signed-in player (never the email). */
export const publicUser = (env: AppEnv, u: { name: string | null; email: string; starHead: boolean }): User => ({
  name: u.name,
  isAdmin: isAdmin(env, u.email),
  starHead: u.starHead,
});
