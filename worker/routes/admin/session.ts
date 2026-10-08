import type { AppEnv } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { adminSecrets, isAdmin } from '../../lib/session.js';

export async function GET(req: Request, env: AppEnv): Promise<Response> {
  const secrets = adminSecrets(env);
  // A secret unset: nobody is an admin.
  return json({ admin: secrets ? await isAdmin(req, secrets) : false });
}
