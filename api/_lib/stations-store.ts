import { del, list, put } from '@vercel/blob';
import { parseStationsFile, type StationsFile } from '../../src/radio/schema';

export const PREFIX = 'stations/';
/** Copy of the newest version, overwritten on every save. Public readers fetch it by URL, so the public path never calls list() (a billed "advanced operation"). */
export const CURRENT = `${PREFIX}current.json`;
export const MAX_VERSION = 999_999;
export function versionPath(v: number): string {
  if (!Number.isInteger(v) || v < 1 || v > MAX_VERSION) throw new Error(`Invalid station list version: ${v}`);
  return `${PREFIX}v${String(v).padStart(6, '0')}.json`;
}
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
  if (!r.ok) throw new Error(`Could not read ${latest.pathname} (HTTP ${r.status})`);
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
    allowOverwrite: false,
    cacheControlMaxAge: 31536000,
  });
}

/**
 * Refreshes the public cache copy. Never used by the admin path: that reads via list(), the source of truth for concurrency.
 * VERSION_RE does not match this name, so version listing and pruning ignore it.
 */
export async function writeCurrent(file: StationsFile): Promise<void> {
  await put(CURRENT, JSON.stringify(file), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

/**
 * `https://<storeId>.public.blob.vercel-storage.com`, with the store id taken from BLOB_READ_WRITE_TOKEN
 * exactly as @vercel/blob does (`vercel_blob_rw_<storeId>_<secret>`: the fourth `_`-separated part of the trimmed value).
 * The id becomes part of a hostname, so anything but letters and digits is refused. Never includes or logs the token.
 */
export function publicBaseUrl(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? '';
  const [, , , storeId = ''] = token.split('_');
  if (!/^[A-Za-z0-9]+$/.test(storeId)) throw new Error('BLOB_READ_WRITE_TOKEN is missing or has an unexpected format');
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

export async function pruneOldVersions(keep = 5): Promise<void> {
  keep = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 5; // never delete the newest version
  const all = await versionBlobs();
  const old = all.slice(0, Math.max(0, all.length - keep)).map((b) => b.url);
  if (old.length) await del(old);
}

const BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;

function blobPath(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password || !BLOB_HOST.test(url.hostname)) return null;
    return decodeURIComponent(url.pathname).slice(1);
  } catch {
    return null;
  }
}

export const isBlobUrl = (u: string): boolean => blobPath(u) !== null;

/** A file uploaded through the admin (tracks/ or covers/). Version files and anything else in the store are never deletable via a station edit. */
export function isDeletableUrl(u: string): boolean {
  const p = blobPath(u);
  return p !== null && /^(tracks|covers)\/[^/]/.test(p) && !p.split('/').some((seg) => seg === '..' || seg === '.');
}

const urlsOf = (f: StationsFile): string[] =>
  f.stations.flatMap((s) => [s.cover, ...s.tracks.flatMap((t) => [t.url, t.cover])]).filter((u): u is string => typeof u === 'string');

/** Blob URLs referenced before but not after a save; their files get deleted (only tracks/ and covers/ files). */
export function removedUrls(prev: StationsFile, next: StationsFile): string[] {
  const keep = new Set(urlsOf(next));
  return [...new Set(urlsOf(prev))].filter((u) => !keep.has(u) && isDeletableUrl(u));
}
