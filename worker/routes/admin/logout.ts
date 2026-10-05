import { adminJson } from '../../lib/http.js';
import { clearCookie } from '../../lib/session.js';

export function POST(): Response {
  return adminJson({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}
