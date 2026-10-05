import { expect, it } from 'vitest';
import { isBlobUrl, removedUrls, versionPath } from '../../../api/_lib/stations-store';
import type { StationsFile } from '../../../src/radio/schema';

const B = 'https://abc123.public.blob.vercel-storage.com';
const file = (urls: string[]): StationsFile => ({
  version: 1,
  stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', cover: `${B}/covers/c.png`, tracks: urls.map((u, i) => ({ id: `t${i}`, url: u, title: 'T', artist: '', credit: '', duration: 1 })) }],
});

it('names versions so they sort lexically', () => {
  expect(versionPath(7)).toBe('stations/v000007.json');
});
it('lists blob URLs that are no longer referenced (never bundled paths)', () => {
  const prev = file([`${B}/tracks/a.mp3`, `${B}/tracks/b.mp3`, '/audio/piano/x.m4a']);
  const next = file([`${B}/tracks/b.mp3`]);
  expect(removedUrls(prev, next)).toEqual([`${B}/tracks/a.mp3`]);
  expect(isBlobUrl('/audio/piano/x.m4a')).toBe(false);
});
