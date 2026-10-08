import type { AppEnv, Ctx, Handler } from './lib/env.js';
import { checkWrite, errorResponse, HttpError, isLocalHost, json } from './lib/http.js';
import * as login from './routes/admin/login.js';
import * as logout from './routes/admin/logout.js';
import * as session from './routes/admin/session.js';
import * as adminStations from './routes/admin/stations.js';
import * as upload from './routes/admin/upload.js';
import * as stations from './routes/stations.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Route = readonly [method: Method, pattern: RegExp, handler: Handler];

/** Every /api route. Patterns are anchored; their capture groups become the handler's params. */
export const ROUTES: readonly Route[] = [
  ['GET', /^\/api\/stations$/, stations.GET],
  ['POST', /^\/api\/admin\/login$/, login.POST],
  ['POST', /^\/api\/admin\/logout$/, logout.POST],
  ['GET', /^\/api\/admin\/session$/, session.GET],
  ['GET', /^\/api\/admin\/stations$/, adminStations.GET],
  ['PUT', /^\/api\/admin\/stations$/, adminStations.PUT],
  ['PUT', /^\/api\/admin\/upload$/, upload.PUT],
];

/** The Worker's request handler (it only runs for /api/*; everything else is static assets). */
export async function handle(req: Request, env: AppEnv, ctx: Ctx): Promise<Response> {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
    // Fake sign-in skips Google: anywhere but a developer's machine it would let anyone be anyone.
    if (env.AUTH_MODE === 'fake' && !isLocalHost(req)) throw new HttpError(500, 'misconfigured', 'Sign-in is misconfigured.');
    const matching = ROUTES.filter(([, pattern]) => pattern.test(pathname));
    if (matching.length === 0) throw new HttpError(404, 'not_found', 'Not found');
    const route = matching.find(([method]) => method === req.method);
    if (!route) {
      const allow = [...new Set(matching.map(([method]) => method))].join(', ');
      return json({ error: 'method_not_allowed', message: 'Method not allowed' }, { status: 405, headers: { Allow: allow } });
    }
    checkWrite(req, pathname);
    return await route[2](req, env, ctx, route[1].exec(pathname)?.slice(1) ?? []);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    // Visible in Workers Logs (wrangler.jsonc "observability"). Only the route and the error's class: never its
    // message, the request body or cookies, or a secret.
    console.error('api', pathname, req.method, e instanceof Error ? e.name : 'error');
    // Never a 500, and never the error itself (it could carry request data).
    return json({ error: 'unavailable', message: 'Something went wrong. Try again.' }, { status: 503 });
  }
}
