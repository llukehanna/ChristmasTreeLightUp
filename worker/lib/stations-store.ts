import { SECRET_ID } from '../../src/radio/ids.js';
import { STATION_ID, parseStationsFile, type StationsFile } from '../../src/radio/schema.js';
import type { Bucket } from './bucket.js';

/**
 * The station list: one object, overwritten on every save. R2 is strongly consistent and supports etag-conditional
 * writes, so there are no versioned copies, no list() and no pruning.
 */
export const CURRENT = 'stations/current.json';

const empty = (): StationsFile => ({ version: 0, stations: [] });

/** The stored list and its etag. Nothing stored yet: an empty version-0 list and a null etag. An invalid object throws. */
export async function readStations(bucket: Bucket): Promise<{ file: StationsFile; etag: string | null }> {
  const obj = await bucket.get(CURRENT);
  if (!obj) return { file: empty(), etag: null };
  const file = parseStationsFile(JSON.parse(await obj.text()));
  if (!file) throw new Error('Stored stations file is invalid');
  return { file, etag: obj.etag };
}

/**
 * Writes `file` only if the stored object is still the one read (same etag), or, with a null etag, only if nothing
 * is stored yet. Resolves to false when that condition fails (somebody else saved first). A failed put throws.
 */
export async function writeStations(bucket: Bucket, file: StationsFile, etag: string | null): Promise<boolean> {
  const written = await bucket.put(CURRENT, JSON.stringify(file), {
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json' },
  });
  return written !== null;
}

/** MUSIC_BASE_URL as a bare https origin ("https://host"), or null if it is anything else. */
export function mediaBase(raw: string | undefined): string | null {
  try {
    const u = new URL((raw ?? '').trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The public URL of a stored object: the base, then the key with each segment percent-encoded. */
export const mediaUrl = (key: string, base: string): string => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

const MEDIA_FOLDER = /^(tracks|covers)$/;
const BAD_SEGMENT = /[/\\\u0000-\u001f\u007f]/;

/**
 * The key of uploaded media behind `url`: only `<base>/tracks/<station>/…` or `<base>/covers/<station>/…`, each path
 * segment decoded. Anything else (station data, other hosts, traversal, encoded separators, queries) is null, so it
 * can never be deleted through a station edit.
 */
export function mediaKey(url: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== base || u.username || u.password || u.search || u.hash) return null;
  const segments: string[] = [];
  for (const raw of u.pathname.slice(1).split('/')) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (s === '' || s === '.' || s === '..' || BAD_SEGMENT.test(s)) return null;
    segments.push(s);
  }
  if (segments.length < 3 || !MEDIA_FOLDER.test(segments[0]) || !STATION_ID.test(segments[1])) return null;
  return segments.join('/');
}

const urlsOf = (f: StationsFile): string[] =>
  f.stations
    .flatMap((s) => [s.cover, s.winSound, ...s.tracks.flatMap((t) => [t.url, t.cover])])
    .filter((u): u is string => typeof u === 'string');

/** A win ad-lib must be our own upload for the Secret station: `<MUSIC_BASE_URL>/tracks/secret/…` (spec 2026-10-08 secret mode §4.2). */
export function isWinSoundUrl(url: string, base: string | null): boolean {
  const key = base ? mediaKey(url, base) : null;
  return key !== null && key.startsWith(`tracks/${SECRET_ID}/`);
}

const keysOf = (f: StationsFile, base: string): Set<string> =>
  new Set(urlsOf(f).flatMap((u) => mediaKey(u, base) ?? []));

/** Keys of uploaded media referenced before a save but not after it (compared by key, so no spelling of a URL keeps or loses a file by accident). */
export function removedMediaKeys(prev: StationsFile, next: StationsFile, base: string | null): string[] {
  if (!base) return [];
  const keep = keysOf(next, base);
  return [...keysOf(prev, base)].filter((k) => !keep.has(k));
}

/** R2 deletes at most 1000 keys per call. */
export async function deleteKeys(bucket: Bucket, keys: readonly string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}
