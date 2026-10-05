import { loadPublicStations } from './_lib/public-stations';

/** Public station list for the game. Served from stations/current.json; never calls Blob's list(). */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await loadPublicStations(), {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    });
  } catch {
    return Response.json({ error: 'Stations are unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
