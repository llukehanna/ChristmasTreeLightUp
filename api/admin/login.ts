import { adminJson, notConfigured, readTextCapped } from '../_lib/http';
import { GLOBAL_KEY, RateLimiter } from '../_lib/ratelimit';
import { createToken, env, passwordMatches, sessionCookie, sessionKey } from '../_lib/session';

const WINDOW_MS = 15 * 60 * 1000;
const perIp = new RateLimiter(10, WINDOW_MS);
const everyone = new RateLimiter(100, WINDOW_MS);
const MAX_BODY = 4096;

export async function POST(req: Request): Promise<Response> {
  let expected: string;
  try {
    expected = env('ADMIN_PASSWORD');
  } catch {
    return notConfigured();
  }
  const now = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  // The per-IP check comes first, so a blocked IP doesn't use up the shared budget.
  if (!perIp.allow(ip, now) || !everyone.allow(GLOBAL_KEY, now)) {
    return adminJson({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }
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
  if (!passwordMatches(password, expected)) return adminJson({ error: 'Wrong password' }, { status: 401 });
  const token = createToken(sessionKey(expected), Math.floor(now / 1000));
  return adminJson({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
