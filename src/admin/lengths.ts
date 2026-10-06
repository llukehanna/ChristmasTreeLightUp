import { MP3_HEAD_BYTES, mp3DurationFrom, type ReadRange } from '../radio/mp3-duration.js';

/**
 * Track lengths without loading any media (a hidden tab throttles that, which is how tracks got saved as 0:00):
 * from an uploaded file's own bytes, or from a range request to the public media host.
 */

/** MP3s only: other formats (M4A, …) have no frame headers to read and fall back to the browser's decoder. */
export const isMp3 = (file: { type: string; name: string }): boolean => file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name);

/** An MP3 file's length in seconds from its bytes, or 0 when it can't tell. */
export function mp3DurationOfBlob(file: Blob): Promise<number> {
  const read: ReadRange = async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
  return mp3DurationFrom(read, file.size);
}

/** The total size in a `Content-Range: bytes 0-65535/1234567` header (0 when missing, `*` or malformed). */
export function totalFromContentRange(header: string | null): number {
  const m = /^bytes\s+\d+-\d+\/(\d+)$/i.exec((header ?? '').trim());
  return m ? Number(m[1]) : 0;
}

/**
 * A track's length from its public URL, reading only the first 64 KB (and, behind a big ID3v2 tag, the start of the
 * audio) with `Range` requests; the total size comes from `Content-Range`, else from a HEAD request's
 * `Content-Length` (a host that doesn't expose `Content-Range` to scripts). 0 when anything fails or the server
 * ignores ranges (a 200 would be the whole file).
 */
export async function mp3DurationOfUrl(url: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const range = async (start: number, end: number): Promise<{ bytes: Uint8Array; total: number }> => {
    const r = await fetchFn(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
    if (r.status !== 206) {
      void r.body?.cancel().catch(() => undefined);
      throw new Error(`Range not served (${r.status})`);
    }
    return { bytes: new Uint8Array(await r.arrayBuffer()), total: totalFromContentRange(r.headers.get('Content-Range')) };
  };
  // A cross-origin page can read Content-Range only if the host exposes it; Content-Length is always readable.
  const sizeByHead = async (): Promise<number> => {
    const r = await fetchFn(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok && /^\d{1,12}$/.test(r.headers.get('Content-Length') ?? '') ? Number(r.headers.get('Content-Length')) : 0;
  };
  try {
    const first = await range(0, MP3_HEAD_BYTES);
    const read: ReadRange = async (start, end) => (start === 0 ? first.bytes.subarray(0, end) : (await range(start, end)).bytes);
    return await mp3DurationFrom(read, first.total || (await sizeByHead()));
  } catch {
    return 0;
  }
}

/** Runs `work` over `items` with at most `limit` in flight. Resolves when all are done; `work` must not throw. */
export async function runPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export const FILL_CONCURRENCY = 4;

/**
 * Looks up every track with a length of 0 (≤ 4 at once) and reports each one that could be read through `onFound`,
 * as it is found. Tracks that fail stay 0. Returns how many were found and how many failed.
 */
export async function fillMissingLengths<T extends { url: string; duration: number }>(
  tracks: readonly T[],
  onFound: (track: T, seconds: number) => void,
  fetchFn: typeof fetch = fetch,
): Promise<{ found: number; failed: number }> {
  const missing = tracks.filter((t) => t.duration === 0);
  let found = 0;
  let failed = 0;
  await runPool(missing, FILL_CONCURRENCY, async (t) => {
    const seconds = await mp3DurationOfUrl(t.url, fetchFn);
    if (seconds > 0) {
      found++;
      onFound(t, seconds);
    } else failed++;
  });
  return { found, failed };
}
