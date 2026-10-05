import type { AppEnv } from '../lib/env.js';
import { loadPublicStations } from '../lib/public-stations.js';

/** Public station list for the game: stations/current.json via the R2 binding. An empty list means "no remote stations". */
export async function GET(_req: Request, env: AppEnv): Promise<Response> {
  try {
    return Response.json(await loadPublicStations(env.MUSIC), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return Response.json({ error: 'Stations are unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
