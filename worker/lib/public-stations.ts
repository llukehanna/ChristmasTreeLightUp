import { parseStationsFile, type StationsFile } from '../../src/radio/schema.js';
import { CURRENT, publicBaseUrl } from './stations-store.js';

const TTL_MS = 300_000;
let cached: { file: StationsFile; at: number } | null = null;

export const resetPublicCache = (): void => {
  cached = null;
};

/**
 * The public station list: stations/current.json fetched by its public URL (a CDN hit, not a billed Blob operation; never list()).
 * A 404 means nothing has been saved yet. Any other failure throws. Kept in memory for 5 minutes per instance (the CDN copy is the fresher layer: current.json is cached for 60s).
 */
export async function loadPublicStations(now = Date.now()): Promise<StationsFile> {
  if (cached && now - cached.at < TTL_MS) return cached.file;
  const r = await fetch(`${publicBaseUrl()}/${CURRENT}`, { signal: AbortSignal.timeout(5000) });
  let file: StationsFile;
  if (r.status === 404) {
    file = { version: 0, stations: [] };
  } else {
    if (!r.ok) throw new Error(`Could not read ${CURRENT} (HTTP ${r.status})`);
    const parsed = parseStationsFile(await r.json());
    if (!parsed) throw new Error(`${CURRENT} is invalid`);
    file = parsed;
  }
  cached = { file, at: now };
  return file;
}
