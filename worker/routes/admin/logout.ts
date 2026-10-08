import { json } from '../../lib/http.js';
import { clearCookie } from '../../lib/session.js';

export function POST(): Response {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}
