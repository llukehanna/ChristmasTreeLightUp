import { cleanName, isReserved, NAME_RULE, nameKey } from '../../src/api/names.js';
import type { NameCheck } from '../../src/api/types.js';
import { resetBoardCache } from '../lib/board-cache.js';
import { fromBase64url, randomToken, sha256 } from '../lib/crypto.js';
import type { AppEnv } from '../lib/env.js';
import { cookie, getCookie, HttpError, json, readJson, redirect } from '../lib/http.js';
import { clearSessionCookie, publicUser, requireUser, SESSION_COOKIE, SESSION_DAYS, sessionCookie, sessionHash } from '../lib/users.js';

export const FLOW_COOKIE = '__Host-aglow_oauth';
/** Fake mode only: the e2e tests' Google account. */
export const FAKE_COOKIE = 'aglow_fake_as';
const FLOW_SECONDS = 600;
const DAY_MS = 86_400_000;

/** Only same-site paths: "/x", never "//evil.com", "/\evil.com", another origin or control characters. */
export function safeReturn(value: string | null): string {
  if (!value || value.length > 200 || /[\x00-\x1f\x7f]/.test(value) || !value.startsWith('/')) return '/';
  try {
    const url = new URL(value, 'http://x');
    if (url.origin !== 'http://x') return '/';
    // A sign-in started from a failed one's page mustn't come back to the failure toast.
    if (url.searchParams.has('auth')) url.searchParams.delete('auth');
    const result = url.pathname + url.search + url.hash;
    if (result.startsWith('//') || result.startsWith('/\\')) return '/';
    return result;
  } catch {
    return '/';
  }
}

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return url.pathname + url.search + url.hash;
}

/** GET /api/auth/google?return=/path (fake mode: &as=<email> or the aglow_fake_as cookie) */
export async function googleStart(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const back = safeReturn(url.searchParams.get('return'));
  const state = randomToken(16);
  const verifier = randomToken(32);
  const flow = cookie(FLOW_COOKIE, `${state}.${verifier}.${encodeURIComponent(back)}`, FLOW_SECONDS);
  const callback = `${url.origin}/api/auth/google/callback`;
  if (env.AUTH_MODE === 'fake') {
    const as = url.searchParams.get('as') ?? getCookie(req, FAKE_COOKIE) ?? 'player@example.com';
    return redirect(`${callback}?code=${encodeURIComponent(`fake:${as}`)}&state=${state}`, [flow]);
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    notConfigured();
    throw new HttpError(503, 'not_configured', 'Sign-in is not configured.');
  }
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(google.toString(), [flow]);
}

export interface Identity {
  sub: string;
  email: string;
}

/**
 * The id_token's claims. It came straight from Google's token endpoint over TLS, so its signature needn't be checked
 * (OpenID Connect Core 3.1.3.7); the issuer, audience, expiry and verified email still are.
 */
export function checkIdToken(idToken: string, clientId: string, now: number): Identity | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(idToken.split('.')[1] ?? ''))) as Record<string, unknown>;
    const issuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!issuer || claims.aud !== clientId || !(typeof claims.exp === 'number' && claims.exp * 1000 > now) || claims.email_verified !== true) return null;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
    return { sub: claims.sub, email: claims.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function exchange(env: AppEnv, code: string, verifier: string, redirectUri: string): Promise<Identity | null> {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    notConfigured();
    return null;
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id_token?: unknown };
    return typeof data.id_token === 'string' ? checkIdToken(data.id_token, clientId, Date.now()) : null;
  } catch {
    return null;
  }
}

/** Visible in Workers Logs: which kind of problem, never a value. */
const notConfigured = (): void => console.error('api', 'auth', 'not_configured');

function fakeIdentity(code: string): Identity | null {
  if (!code.startsWith('fake:')) return null;
  const email = code.slice(5).trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email) ? { sub: `fake:${email}`, email } : null;
}

/** GET /api/auth/google/callback?code&state: any failure goes back to the page with ?auth=failed. */
export async function googleCallback(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const [state, verifier, ...rest] = (getCookie(req, FLOW_COOKIE) ?? '').split('.');
  let back = '/';
  try {
    back = safeReturn(decodeURIComponent(rest.join('.')));
  } catch {
    // keep '/'
  }
  const clear = cookie(FLOW_COOKIE, '', 0);
  const failed = () => redirect(withParam(back, 'auth', 'failed'), [clear]);
  const code = url.searchParams.get('code');
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    notConfigured();
    return failed();
  }
  if (!state || !verifier || !code || url.searchParams.get('state') !== state) return failed();

  const identity = env.AUTH_MODE === 'fake' ? fakeIdentity(code) : await exchange(env, code, verifier, `${url.origin}/api/auth/google/callback`);
  if (!identity) return failed();

  try {
    return redirect(back, [clear, sessionCookie(await signInAs(req, env, secret, identity))]);
  } catch (e) {
    // Like the router's log: the error's class only, never its message (it could carry request data).
    console.error('api', 'auth', 'callback', e instanceof Error ? e.name : 'error');
    return failed();
  }
}

/** The account write: upsert the user by Google sub, then in one batch add a session, prune expired ones and revoke this browser's last one. Returns the new session token. */
async function signInAs(req: Request, env: AppEnv, secret: string, identity: Identity): Promise<string> {
  const now = Date.now();
  const user = await env.DB.prepare(
    'INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?) ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email RETURNING id',
  )
    .bind(identity.sub, identity.email, now)
    .first<{ id: number }>();
  if (!user) throw new Error('user upsert returned no row');
  const token = randomToken(32);
  const old = getCookie(req, SESSION_COOKIE);
  const statements = [
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await sessionHash(secret, token),
      user.id,
      now,
      now + SESSION_DAYS * DAY_MS,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ];
  // Signing in revokes the session this browser already had.
  if (old) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(secret, old)));
  await env.DB.batch(statements);
  return token;
}

/** GET /api/auth/name?n= */
export async function nameAvailable(req: Request, env: AppEnv): Promise<Response> {
  const name = cleanName(new URL(req.url).searchParams.get('n'));
  if (!name) return json({ available: false, reason: 'invalid' } satisfies NameCheck);
  if (isReserved(name)) return json({ available: false, reason: 'reserved' } satisfies NameCheck);
  const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE name_key = ?').bind(nameKey(name)).first();
  return json((taken ? { available: false, reason: 'taken' } : { available: true }) satisfies NameCheck);
}

/** POST /api/auth/name { name }: once per account. */
export async function setName(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  const name = cleanName((await readJson(req)).name);
  if (!name) throw new HttpError(400, 'invalid', `${NAME_RULE}.`);
  if (isReserved(name)) throw new HttpError(400, 'reserved', 'That name is reserved.');
  if (user.name !== null) throw new HttpError(409, 'has_name', 'You already have a name.');
  try {
    const res = await env.DB.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ? AND name IS NULL').bind(name, nameKey(name), user.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'has_name', 'You already have a name.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'taken', 'That name is taken.');
    throw e;
  }
  // The account's ranked runs join the board now.
  resetBoardCache();
  return json({ user: publicUser(env, { name, email: user.email, starHead: user.starHead }) });
}

/** POST /api/auth/signout */
export async function signOut(req: Request, env: AppEnv): Promise<Response> {
  const token = getCookie(req, SESSION_COOKIE);
  const secret = env.AUTH_SECRET?.trim();
  if (token && secret) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(secret, token)).run();
  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
