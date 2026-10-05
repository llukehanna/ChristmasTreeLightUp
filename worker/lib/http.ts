import { isAdmin } from './session.js';

/** JSON response for admin endpoints: never cached anywhere. */
export function adminJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { 'Cache-Control': 'no-store', ...init.headers } });
}

export const notConfigured = (): Response => adminJson({ error: 'Admin is not configured' }, { status: 503 });

/** null when the caller has a valid session, otherwise the response to send (401, or 503 if ADMIN_PASSWORD is unset). */
export function requireAdmin(req: Request): Response | null {
  try {
    return isAdmin(req) ? null : adminJson({ error: 'Not signed in' }, { status: 401 });
  } catch {
    return notConfigured();
  }
}

/** Reads the body as text, or returns null if it is larger than `max` bytes (it stops reading as soon as the cap is passed). */
export async function readTextCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
