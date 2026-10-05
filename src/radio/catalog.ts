import { PIANO_ID, PIANO_META } from './builtin';
import { parseStationsFile, type Station, type Track } from './schema';

/** Production: Plan 3's endpoint. Development: the dev-music plugin in vite.config.ts. */
export const STATIONS_URL = import.meta.env.DEV ? '/dev-stations.json' : '/api/stations';
const PIANO_URL = '/audio/piano/credits.json';

export function mergeCatalog(remote: readonly Station[], bundledPiano: readonly Track[]): Station[] {
  const out = remote.filter((s) => s.id !== PIANO_ID);
  const remotePiano = remote.find((s) => s.id === PIANO_ID)?.tracks ?? [];
  const seen = new Set<string>();
  const tracks = [...bundledPiano, ...remotePiano].filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
  if (tracks.length) out.push({ ...PIANO_META, tracks });
  return out;
}

/** A hung endpoint must not hold the whole catalog (and the bundled piano) hostage. */
const FETCH_TIMEOUT_MS = 4000;

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

export async function loadCatalog(fetchFn: typeof fetch = fetch): Promise<{ stations: Station[]; remoteOk: boolean }> {
  const [remote, bundled] = await Promise.all([fetchStations(fetchFn, STATIONS_URL), fetchStations(fetchFn, PIANO_URL)]);
  const piano = bundled?.find((s) => s.id === PIANO_ID)?.tracks ?? [];
  return { stations: mergeCatalog(remote ?? [], piano), remoteOk: remote !== null };
}
