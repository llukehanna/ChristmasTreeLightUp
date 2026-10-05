import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({ del: vi.fn(), list: vi.fn(), put: vi.fn() }));

import { del, list, put } from '@vercel/blob';
import { isBlobUrl, isDeletableUrl, pruneOldVersions, readLatest, removedUrls, versionPath, writeVersion } from '../../../api/_lib/stations-store';
import type { StationsFile } from '../../../src/radio/schema';

const B = 'https://abc123.public.blob.vercel-storage.com';
const file = (urls: string[], version = 1): StationsFile => ({
  version,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', cover: `${B}/covers/christmas-jazz/c.png`, tracks: urls.map((u, i) => ({ id: `t${i}`, url: u, title: 'T', artist: '', credit: '', duration: 1 })) }],
});
const blob = (n: number) => ({ pathname: `stations/v${String(n).padStart(6, '0')}.json`, url: `${B}/stations/v${String(n).padStart(6, '0')}.json` });
// list() is generic; these tests only need the fields stations-store reads.
const listReturns = (blobs: { pathname: string; url: string }[]): void => {
  vi.mocked(list).mockResolvedValue({ blobs, hasMore: false } as unknown as Awaited<ReturnType<typeof list>>);
};

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('versionPath', () => {
  it('names versions so they sort lexically', () => {
    expect(versionPath(7)).toBe('stations/v000007.json');
    expect(versionPath(999999)).toBe('stations/v999999.json');
  });
  it('rejects versions outside 1..999999 or non-integers', () => {
    for (const v of [0, -1, 1000000, 1.5, NaN, Infinity]) expect(() => versionPath(v), String(v)).toThrow();
  });
});

describe('removedUrls', () => {
  it('lists uploaded blob files that are no longer referenced (never bundled paths)', () => {
    const prev = file([`${B}/tracks/christmas-jazz/a.mp3`, `${B}/tracks/christmas-jazz/b.mp3`, '/audio/piano/x.m4a']);
    const next = file([`${B}/tracks/christmas-jazz/b.mp3`]);
    expect(removedUrls(prev, next)).toEqual([`${B}/tracks/christmas-jazz/a.mp3`]);
    expect(isBlobUrl('/audio/piano/x.m4a')).toBe(false);
  });
  it('never deletes version files or anything outside tracks/ and covers/', () => {
    const evil = [
      `${B}/stations/v000001.json`,
      `${B}/current.json`,
      `${B}/tracks/../stations/v000002.json`,
      `${B}/tracks/%2e%2e/stations/v000002.json`,
      `${B}/tracks%2F..%2Fstations/v1.json`,
      `${B}/tracks/`,
      `${B}/tracksx/a.mp3`,
      'https://evil.example/tracks/a.mp3',
      'http://abc123.public.blob.vercel-storage.com/tracks/a.mp3',
      'https://u:p@abc123.public.blob.vercel-storage.com/tracks/a.mp3',
    ];
    for (const u of evil) expect(isDeletableUrl(u), u).toBe(false);
    const prev = file(evil);
    prev.stations[0].cover = undefined;
    expect(removedUrls(prev, file([]))).toEqual([]);
    expect(isDeletableUrl(`${B}/covers/christmas-jazz/c.png`)).toBe(true);
    expect(isBlobUrl(`${B}/stations/v000001.json`)).toBe(true);
  });
});

describe('readLatest', () => {
  it('returns an empty version-0 list when nothing is stored', async () => {
    listReturns([]);
    expect(await readLatest()).toEqual({ file: { version: 0, stations: [] } });
  });
  it('reads the newest valid version', async () => {
    listReturns([blob(2), { pathname: 'stations/other.json', url: `${B}/stations/other.json` }, blob(10), blob(3)]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(file([`${B}/tracks/christmas-jazz/a.mp3`], 10))));
    vi.stubGlobal('fetch', fetchMock);
    const { file: got } = await readLatest();
    expect(got.version).toBe(10);
    expect(fetchMock).toHaveBeenCalledWith(blob(10).url);
  });
  it('throws a clear error on a failed read', async () => {
    listReturns([blob(1)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));
    await expect(readLatest()).rejects.toThrow('Could not read stations/v000001.json (HTTP 503)');
  });
  it('throws on an invalid stored file', async () => {
    listReturns([blob(1)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: true }))));
    await expect(readLatest()).rejects.toThrow('Stored stations file is invalid');
  });
});

describe('writeVersion', () => {
  it('puts an immutable, non-overwriting, public JSON blob', async () => {
    vi.mocked(put).mockResolvedValue({} as Awaited<ReturnType<typeof put>>);
    const f = file([], 4);
    await writeVersion(f);
    expect(put).toHaveBeenCalledWith('stations/v000004.json', JSON.stringify(f), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31536000,
    });
  });
  it('refuses a bad version without calling Blob, and propagates a conflict', async () => {
    await expect(writeVersion(file([], 0))).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
    vi.mocked(put).mockRejectedValue(new Error('This blob already exists'));
    await expect(writeVersion(file([], 2))).rejects.toThrow('already exists');
  });
});

describe('pruneOldVersions', () => {
  it('deletes all but the newest `keep` versions', async () => {
    listReturns([blob(7), blob(1), blob(3), blob(2), blob(5), blob(4), blob(6)]);
    await pruneOldVersions(5);
    expect(del).toHaveBeenCalledWith([blob(1).url, blob(2).url]);
  });
  it('does nothing when there are few versions', async () => {
    listReturns([blob(1), blob(2)]);
    await pruneOldVersions();
    expect(del).not.toHaveBeenCalled();
  });
  it('always keeps at least the newest version', async () => {
    listReturns([blob(1), blob(2), blob(3)]);
    await pruneOldVersions(0);
    expect(del).toHaveBeenCalledWith([blob(1).url, blob(2).url]);
    vi.mocked(del).mockClear();
    await pruneOldVersions(-3);
    expect(del).toHaveBeenCalledWith([blob(1).url, blob(2).url]);
  });
});
