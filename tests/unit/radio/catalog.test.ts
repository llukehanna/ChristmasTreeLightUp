import { expect, it } from 'vitest';
import { loadCatalog, mergeCatalog } from '../../../src/radio/catalog';
import type { Track } from '../../../src/radio/schema';

const t = (id: string, url = `/a/${id}.m4a`): Track => ({ id, url, title: id, artist: '', credit: 'CC0', duration: 1 });

it('keeps remote stations in order and appends Piano Carols (bundled + remote, deduped)', () => {
  const remote = [
    { id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [t('j')] },
    { id: 'piano-carols', name: 'Piano Carols', description: '', tracks: [t('p2'), t('dup', '/a/p1.m4a')] },
  ];
  const merged = mergeCatalog(remote, [t('p1')]);
  expect(merged.map((s) => s.id)).toEqual(['christmas-jazz', 'piano-carols']);
  expect(merged[1].tracks.map((x) => x.id)).toEqual(['p1', 'p2']);
});

it('falls back to bundled stations when the remote list fails', async () => {
  const bundled = { version: 0, stations: [{ id: 'piano-carols', name: 'Piano Carols', description: '', tracks: [t('p1')] }] };
  const fetchFn = async (url: string) => (url.includes('credits') ? new Response(JSON.stringify(bundled)) : new Response('nope', { status: 503 }));
  const c = await loadCatalog(fetchFn as typeof fetch);
  expect(c.remoteOk).toBe(false);
  expect(c.stations.map((s) => s.id)).toEqual(['piano-carols']);
});
