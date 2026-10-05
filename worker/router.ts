import type { AppEnv, Ctx, Handler } from './lib/env.js';
import { adminJson, sameOrigin } from './lib/http.js';
import * as login from './routes/admin/login.js';
import * as logout from './routes/admin/logout.js';
import * as session from './routes/admin/session.js';
import * as adminStations from './routes/admin/stations.js';
import * as upload from './routes/admin/upload.js';
import * as stations from './routes/stations.js';

type Methods = Readonly<Partial<Record<'GET' | 'POST' | 'PUT', Handler>>>;

const ROUTES: ReadonlyMap<string, Methods> = new Map<string, Methods>([
  ['/api/stations', { GET: stations.GET }],
  ['/api/admin/login', { POST: login.POST }],
  ['/api/admin/logout', { POST: logout.POST }],
  ['/api/admin/session', { GET: session.GET }],
  ['/api/admin/stations', { GET: adminStations.GET, PUT: adminStations.PUT }],
  ['/api/admin/upload', { PUT: upload.PUT }],
]);

const isMethod = (m: string): m is keyof Methods => m === 'GET' || m === 'POST' || m === 'PUT';

/** The Worker's request handler (it only runs for /api/*; everything else is static assets). */
export async function handle(req: Request, env: AppEnv, ctx: Ctx): Promise<Response> {
  try {
    const { pathname } = new URL(req.url);
    const route = ROUTES.get(pathname);
    if (!route) return adminJson({ error: 'Not found' }, { status: 404 });
    const handler = isMethod(req.method) ? route[req.method] : undefined;
    if (!handler) return adminJson({ error: 'Method not allowed' }, { status: 405, headers: { Allow: Object.keys(route).join(', ') } });
    if (pathname.startsWith('/api/admin/') && req.method !== 'GET' && !sameOrigin(req)) {
      return adminJson({ error: 'Cross-origin request refused' }, { status: 403 });
    }
    return await handler(req, env, ctx);
  } catch {
    // Never a 500, and never the error itself (it could carry request data).
    return adminJson({ error: 'Something went wrong. Try again.' }, { status: 503 });
  }
}
