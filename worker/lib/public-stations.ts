import type { StationsFile } from '../../src/radio/schema.js';
import type { Bucket } from './bucket.js';
import { readStations } from './stations-store.js';

const TTL_MS = 60_000;
let cached: { file: StationsFile; at: number } | null = null;

export const resetPublicCache = (): void => {
  cached = null;
};

/**
 * The public station list, read through the R2 binding (one Class B read; never list()) and validated.
 * Nothing saved yet gives an empty version-0 list. Any failure throws and is not cached.
 * Kept in memory for 60 seconds per isolate; a save in the same isolate clears it.
 */
export async function loadPublicStations(bucket: Bucket, now = Date.now()): Promise<StationsFile> {
  if (cached && now - cached.at < TTL_MS) return cached.file;
  const { file } = await readStations(bucket);
  cached = { file, at: now };
  return file;
}
