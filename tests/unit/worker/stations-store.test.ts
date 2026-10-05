import { describe, expect, it, vi } from 'vitest';
import { CURRENT, deleteKeys, mediaBase, mediaKey, mediaUrl, readStations, removedMediaKeys, writeStations } from '../../../worker/lib/stations-store';
import { isUrl, type StationsFile } from '../../../src/radio/schema';
import { FakeBucket } from './fake-bucket';

const B = 'https://aglow-music.example';
const file = (urls: string[], version = 1): StationsFile => ({
  version,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', cover: `${B}/covers/christmas-jazz/c.png`, tracks: urls.map((u, i) => ({ id: `t${i}`, url: u, title: 'T', artist: '', credit: '', duration: 1 })) }],
});

describe('readStations', () => {
  it('returns an empty version-0 list and no etag when nothing is stored', async () => {
    expect(CURRENT).toBe('stations/current.json');
    expect(await readStations(new FakeBucket())).toEqual({ file: { version: 0, stations: [] }, etag: null });
  });
  it('reads the stored file with its etag', async () => {
    const b = new FakeBucket();
    const f = file([`${B}/tracks/christmas-jazz/a.mp3`], 10);
    const etag = b.seed(CURRENT, JSON.stringify(f));
    expect(await readStations(b)).toEqual({ file: f, etag });
  });
  it('throws on an invalid stored file, or one that is not JSON', async () => {
    const b = new FakeBucket();
    b.seed(CURRENT, JSON.stringify({ nope: true }));
    await expect(readStations(b)).rejects.toThrow('Stored stations file is invalid');
    b.seed(CURRENT, '{nope');
    await expect(readStations(b)).rejects.toThrow();
  });
});

describe('writeStations', () => {
  it('creates the file only if it does not exist yet when there is no etag', async () => {
    const b = new FakeBucket();
    const put = vi.spyOn(b, 'put');
    expect(await writeStations(b, file([], 1), null)).toBe(true);
    expect(put).toHaveBeenCalledWith(CURRENT, JSON.stringify(file([], 1)), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
    expect(JSON.parse(b.text(CURRENT) ?? '')).toEqual(file([], 1));
    // Somebody else created it first.
    expect(await writeStations(b, file([], 1), null)).toBe(false);
  });
  it('overwrites only the version it read (etag match)', async () => {
    const b = new FakeBucket();
    const etag = b.seed(CURRENT, JSON.stringify(file([], 1)));
    expect(await writeStations(b, file([], 2), etag)).toBe(true);
    expect(JSON.parse(b.text(CURRENT) ?? '').version).toBe(2);
    // The etag changed with that write, so a second writer holding the old one loses.
    expect(await writeStations(b, file([], 2), etag)).toBe(false);
    expect(JSON.parse(b.text(CURRENT) ?? '').version).toBe(2);
  });
  it('propagates a failed put', async () => {
    const b = new FakeBucket();
    vi.spyOn(b, 'put').mockRejectedValueOnce(new Error('network'));
    await expect(writeStations(b, file([], 1), null)).rejects.toThrow('network');
  });
});

describe('media URLs and keys', () => {
  it('normalises the configured base and refuses anything that is not a plain https origin', () => {
    expect(mediaBase(B)).toBe(B);
    expect(mediaBase(`${B}/`)).toBe(B);
    expect(mediaBase(' https://Aglow-Music.Example ')).toBe(B);
    for (const bad of [undefined, '', '   ', 'http://aglow-music.example', 'https://u:p@aglow-music.example', 'https://aglow-music.example/sub', 'https://aglow-music.example?x=1', 'nope']) {
      expect(mediaBase(bad), String(bad)).toBeNull();
    }
  });
  it('builds a URL with each key segment encoded, which maps back to the same key and passes the schema', () => {
    for (const key of ['tracks/christmas-jazz/0a1b2c3d-a.mp3', 'tracks/christmas-jazz/0a1b2c3d-Sleigh Ride #2 (100%)?.mp3', 'covers/christmas-jazz/0a1b2c3d-Noël ☃.png']) {
      const url = mediaUrl(key, B);
      expect(url.startsWith(`${B}/`), url).toBe(true);
      expect(isUrl(url), url).toBe(true);
      expect(mediaKey(url, B), url).toBe(key);
    }
    expect(mediaUrl('tracks/christmas-jazz/0a1b2c3d-a b.mp3', B)).toBe(`${B}/tracks/christmas-jazz/0a1b2c3d-a%20b.mp3`);
  });
  it('maps only uploaded media under the base back to keys: never station data or anything elsewhere', () => {
    const evil = [
      `${B}/stations/current.json`,
      `${B}/current.json`,
      `${B}/tracks/../stations/current.json`,
      `${B}/tracks/%2e%2e/stations/current.json`,
      `${B}/tracks/christmas-jazz/%2e%2e`,
      `${B}/tracks%2F..%2Fstations/current.json`,
      `${B}/tracks/christmas-jazz%2Fx/a.mp3`,
      `${B}/tracks/christmas-jazz/a%5Cb.mp3`,
      `${B}/tracks/christmas-jazz/%E0%A4%A.mp3`,
      `${B}/tracks/`,
      `${B}/tracks/a.mp3`,
      `${B}/tracks//a.mp3`,
      `${B}/tracksx/a/b.mp3`,
      `${B}/tracks/christmas-jazz/a.mp3?v=1`,
      `${B}/tracks/christmas-jazz/a.mp3#x`,
      'https://evil.example/tracks/christmas-jazz/a.mp3',
      'https://aglow-music.example.evil.example/tracks/christmas-jazz/a.mp3',
      'https://aglow-music.example:8443/tracks/christmas-jazz/a.mp3',
      'http://aglow-music.example/tracks/christmas-jazz/a.mp3',
      'https://u:p@aglow-music.example/tracks/christmas-jazz/a.mp3',
      '/audio/piano/x.m4a',
      'not a url',
    ];
    for (const u of evil) expect(mediaKey(u, B), u).toBeNull();
    expect(mediaKey(`${B}/covers/christmas-jazz/c.png`, B)).toBe('covers/christmas-jazz/c.png');
    expect(mediaKey(`${B}/tracks/christmas-jazz/sub/a.mp3`, B)).toBe('tracks/christmas-jazz/sub/a.mp3');
  });
});

describe('removedMediaKeys', () => {
  it('lists keys of uploaded media that are no longer referenced (never bundled paths or foreign hosts)', () => {
    const prev = file([`${B}/tracks/christmas-jazz/a.mp3`, `${B}/tracks/christmas-jazz/b%20b.mp3`, '/audio/piano/x.m4a', 'https://elsewhere.example/tracks/christmas-jazz/z.mp3']);
    prev.stations[0].tracks[0].cover = `${B}/covers/christmas-jazz/t.png`;
    const next = file([`${B}/tracks/christmas-jazz/a.mp3`]);
    next.stations[0].cover = undefined;
    expect(removedMediaKeys(prev, next, B).sort()).toEqual(['covers/christmas-jazz/c.png', 'covers/christmas-jazz/t.png', 'tracks/christmas-jazz/b b.mp3']);
  });
  it('lists a file once even if it was referenced twice, and keeps one still used elsewhere', () => {
    const shared = `${B}/covers/christmas-jazz/c.png`;
    const prev = file([`${B}/tracks/christmas-jazz/a.mp3`, `${B}/tracks/christmas-jazz/a.mp3`]);
    prev.stations[0].tracks[1].cover = shared;
    const next = file([]);
    expect(removedMediaKeys(prev, next, B)).toEqual(['tracks/christmas-jazz/a.mp3']);
  });
  it('removes nothing when the base is not configured', () => {
    expect(removedMediaKeys(file([`${B}/tracks/christmas-jazz/a.mp3`]), file([]), null)).toEqual([]);
  });
});

describe('deleteKeys', () => {
  it('deletes in batches of at most 1000 keys', async () => {
    const b = new FakeBucket();
    const del = vi.spyOn(b, 'delete');
    await deleteKeys(b, Array.from({ length: 2001 }, (_, i) => `tracks/s/${i}`));
    expect(del.mock.calls.map((c) => c[0].length)).toEqual([1000, 1000, 1]);
    await deleteKeys(b, []);
    expect(del).toHaveBeenCalledTimes(3);
  });
});
