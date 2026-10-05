import { adminJson } from '../_lib/http.js';
import { isAdmin } from '../_lib/session.js';

export function GET(req: Request): Response {
  let admin = false;
  try {
    admin = isAdmin(req);
  } catch {
    // ADMIN_PASSWORD unset: nobody is an admin.
  }
  return adminJson({ admin });
}
