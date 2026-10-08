import type { AppEnv } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { requireAdmin } from '../../lib/users.js';

/** GET /api/admin/session: 200 for the admin, 401 signed out, 403 any other account (the page shows the editor, sign-in or "Not authorized"). */
export async function GET(req: Request, env: AppEnv): Promise<Response> {
  const user = await requireAdmin(req, env);
  return json({ admin: true, name: user.name });
}
