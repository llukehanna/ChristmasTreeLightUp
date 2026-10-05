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
    if (!r.ok) return null;
    return parseStationsFile(await r.json())?.stations ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The remote stations in their published order, or none (`remoteOk: false`) if the list can't be fetched or parsed. */
export async function loadCatalog(fetchFn: typeof fetch = fetch): Promise<{ stations: Station[]; remoteOk: boolean }> {
  const remote = await fetchStations(fetchFn, STATIONS_URL);
  return { stations: remote ?? [], remoteOk: remote !== null };
}
