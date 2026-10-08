import type { MeResponse } from '../../src/api/types.js';
import type { AppEnv } from '../lib/env.js';
import { HttpError, json, readJson } from '../lib/http.js';
import { clearSessionCookie, currentUser, publicUser, RENEW_UNDER_DAYS, requireUser, SESSION_DAYS, sessionCookie } from '../lib/users.js';

const DAY_MS = 86_400_000;

/** GET /api/me. Renews a session past its halfway point, so regular players stay signed in. */
export async function getMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return json({ user: null } satisfies MeResponse);
  const body: MeResponse = { user: publicUser(env, user) };
  if (user.expiresAt - Date.now() > RENEW_UNDER_DAYS * DAY_MS) return json(body);
  await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + SESSION_DAYS * DAY_MS, user.tokenHash).run();
  return json(body, { headers: { 'Set-Cookie': sessionCookie(user.token) } });
}

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** DELETE /api/me { confirm }: the display name, or the email before a name is picked. Games and sessions go too (cascade). */
export async function deleteMe(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(req, env);
  if (norm((await readJson(req)).confirm) !== norm(user.name ?? user.email)) throw new HttpError(400, 'confirm', 'Type it exactly as shown to confirm.');
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
