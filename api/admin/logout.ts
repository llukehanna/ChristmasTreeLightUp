import { adminJson } from '../_lib/http';
import { clearCookie } from '../_lib/session';

export function POST(): Response {
  return adminJson({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}
