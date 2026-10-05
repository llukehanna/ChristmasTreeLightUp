import { del, list, put } from '@vercel/blob';
import { parseStationsFile, type StationsFile } from '../../src/radio/schema';

export const PREFIX = 'stations/';
export const versionPath = (v: number): string => `${PREFIX}v${String(v).padStart(6, '0')}.json`;
const VERSION_RE = /^stations\/v\d{6}\.json$/;

async function versionBlobs(): Promise<{ pathname: string; url: string }[]> {
  const { blobs } = await list({ prefix: PREFIX });
  return blobs.filter((b) => VERSION_RE.test(b.pathname)).sort((a, b) => a.pathname.localeCompare(b.pathname));
}

/** Newest version, found via list() (strongly consistent). Each version blob is immutable, so reading it is safe to cache. */
export async function readLatest(): Promise<{ file: StationsFile }> {
  const latest = (await versionBlobs()).pop();
  if (!latest) return { file: { version: 0, stations: [] } };
  const r = await fetch(latest.url);
  const file = parseStationsFile(await r.json());
  if (!file) throw new Error('Stored stations file is invalid');
  return { file };
}

/** Throws if this version already exists (Blob refuses to overwrite by default), which signals a concurrent save. */
export async function writeVersion(file: StationsFile): Promise<void> {
  await put(versionPath(file.version), JSON.stringify(file), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
}

export async function pruneOldVersions(keep = 5): Promise<void> {
  const all = await versionBlobs();
  const old = all.slice(0, Math.max(0, all.length - keep)).map((b) => b.url);
  if (old.length) await del(old);
}

export const isBlobUrl = (u: string): boolean => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(u);

const urlsOf = (f: StationsFile): string[] =>
  f.stations.flatMap((s) => [s.cover, ...s.tracks.flatMap((t) => [t.url, t.cover])]).filter((u): u is string => typeof u === 'string');

/** Blob URLs referenced before but not after a save; their files get deleted. */
export function removedUrls(prev: StationsFile, next: StationsFile): string[] {
  const keep = new Set(urlsOf(next));
  return [...new Set(urlsOf(prev))].filter((u) => !keep.has(u) && isBlobUrl(u));
}
