import { adminJson } from '../_lib/http.js';
import { clearCookie } from '../_lib/session.js';

export function POST(): Response {
  return adminJson({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}
