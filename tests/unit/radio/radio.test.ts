// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { Radio } from '../../../src/radio/radio';
import { loadRadioSettings } from '../../../src/store/radio-settings';

const track = (id: string) => ({ id, url: `/a/${id}.m4a`, title: id, artist: '', credit: 'CC0', duration: 10 });
const station = (id: string) => ({ id, name: id, description: '', tracks: [track(`${id}-1`), track(`${id}-2`)] });
const STATIONS = { version: 1, stations: [station('christmas-jazz'), station('christmas-classics')] };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes('piano') ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(STATIONS)))),
  );
});

async function ready(): Promise<Radio> {
  const r = new Radio();
  await r.refreshCatalog();
  return r;
}

it('suggests the scene station when nothing was chosen, without remembering it', async () => {
  const r = await ready();
  r.setScene('frost');
  r.playPause();
  expect(r.view().station?.id).toBe('christmas-classics');
  expect(loadRadioSettings().source).toBeNull();
});

it('select persists the chosen source and playing state', async () => {
  const r = await ready();
  r.select('christmas-jazz');
  expect(r.view().kind).toBe('station');
  expect(loadRadioSettings()).toMatchObject({ on: true, source: 'christmas-jazz' });
});

it('ignores unknown sources and leaves the current one alone', async () => {
  const r = await ready();
  r.select('christmas-jazz');
  r.select('nope');
  r.select('embed'); // no embed set yet
  expect(r.view().station?.id).toBe('christmas-jazz');
  expect(r.view().kind).toBe('station');
});

it('setEmbed accepts official playlist links only, and selects the embed', async () => {
  const r = await ready();
  expect(r.setEmbed('https://example.com/x')).toBeNull();
  const e = r.setEmbed('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4');
  expect(e?.provider).toBe('spotify');
  expect(r.view().kind).toBe('embed');
  expect(r.lightShowActive).toBe(false);
  expect(loadRadioSettings()).toMatchObject({ source: 'embed', embedUrl: 'https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4' });
});

it('clamps the volume so persisted settings stay valid', async () => {
  const r = await ready();
  r.setVolume(7);
  expect(loadRadioSettings().volume).toBe(1);
  r.setVolume(-1);
  expect(loadRadioSettings().volume).toBe(0);
  r.setVolume(Number.NaN);
  expect(loadRadioSettings().volume).toBe(0);
});
