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

async function fetchStations(fetchFn: typeof fetch, url: string): Promise<Station[] | null> {
  try {
    const r = await fetchFn(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return parseStationsFile(await r.json())?.stations ?? null;
  } catch {
    return null;
  }
}

export async function loadCatalog(fetchFn: typeof fetch = fetch): Promise<{ stations: Station[]; remoteOk: boolean }> {
  const [remote, bundled] = await Promise.all([fetchStations(fetchFn, STATIONS_URL), fetchStations(fetchFn, PIANO_URL)]);
  const piano = bundled?.find((s) => s.id === PIANO_ID)?.tracks ?? [];
  return { stations: mergeCatalog(remote ?? [], piano), remoteOk: remote !== null };
}
