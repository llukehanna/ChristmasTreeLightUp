import type { AppEnv } from '../../lib/env.js';
import { adminJson, notConfigured, readTextCapped } from '../../lib/http.js';
import { GLOBAL_KEY, RateLimiter } from '../../lib/ratelimit.js';
import { adminSecrets, createToken, passwordMatches, sessionCookie, sessionKey } from '../../lib/session.js';

const WINDOW_MS = 15 * 60 * 1000;
// Per isolate, and isolates are short-lived, so these are best-effort; LOGIN_LIMITER (when bound) is the shared limit.
let perIp = new RateLimiter(10, WINDOW_MS);
let everyone = new RateLimiter(100, WINDOW_MS);
const MAX_BODY = 4096;

/** Fresh in-memory limiters (tests). */
export function resetLoginLimits(): void {
  perIp = new RateLimiter(10, WINDOW_MS);
  everyone = new RateLimiter(100, WINDOW_MS);
}

const tooMany = (): Response => adminJson({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });

export async function POST(req: Request, env: AppEnv): Promise<Response> {
  const secrets = adminSecrets(env);
  if (!secrets) return notConfigured();
  const now = Date.now();
  // Set by Cloudflare's edge; a client cannot forge it the way it can X-Forwarded-For.
  const ip = req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
  // The per-IP check comes first, so a blocked IP doesn't use up the shared budget.
  if (!perIp.allow(ip, now) || !everyone.allow(GLOBAL_KEY, now)) return tooMany();
  if (env.LOGIN_LIMITER && !(await env.LOGIN_LIMITER.limit({ key: ip })).success) return tooMany();
  const text = await readTextCapped(req, MAX_BODY);
  if (text === null) return adminJson({ error: 'Request too large' }, { status: 413 });
  let password = '';
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && typeof (body as { password?: unknown }).password === 'string') {
      password = (body as { password: string }).password;
    }
  } catch {
    // treated as an empty password
  }
  if (!(await passwordMatches(password, secrets.password))) return adminJson({ error: 'Wrong password' }, { status: 401 });
  const token = await createToken(await sessionKey(secrets.secret, secrets.password), Math.floor(now / 1000));
  return adminJson({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
