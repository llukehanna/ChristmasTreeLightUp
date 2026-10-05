import { parseStationsFile, type Station } from './schema';

/** Production: Plan 3's endpoint. Development: the dev-music plugin in vite.config.ts. */
export const STATIONS_URL = import.meta.env.DEV ? '/dev-stations.json' : '/api/stations';

/** A hung endpoint must not hold the radio hostage: Music Box and Fireplace work without it. */
export const FETCH_TIMEOUT_MS = 4000;

async function fetchStations(fetchFn: typeof fetch, url: string): Promise<Station[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { cache: 'no-cache', signal: ctl.signal });
    // No endpoint yet (Plan 3) is "no remote stations", not a failure: Music Box and Fireplace cover it silently.
    if (r.status === 404) return [];
    if (!r.ok) return null;
    return parseStationsFile(await r.json())?.stations ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The remote stations in their published order. A 404 means there are none (`remoteOk: true`); a network error,
 * timeout, other error status or unparseable list means they can't be reached (`remoteOk: false`).
 */
export async function loadCatalog(fetchFn: typeof fetch = fetch): Promise<{ stations: Station[]; remoteOk: boolean }> {
  const remote = await fetchStations(fetchFn, STATIONS_URL);
  return { stations: remote ?? [], remoteOk: remote !== null };
}
