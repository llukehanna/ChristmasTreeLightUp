import { adminJson } from '../_lib/http';
import { isAdmin } from '../_lib/session';

export function GET(req: Request): Response {
  let admin = false;
  try {
    admin = isAdmin(req);
  } catch {
    // ADMIN_PASSWORD unset: nobody is an admin.
  }
  return adminJson({ admin });
}
