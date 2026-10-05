// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { audio } from '../../../src/audio/context';
import { Fireplace } from '../../../src/radio/fireplace';
import { Radio } from '../../../src/radio/radio';
import { loadRadioSettings } from '../../../src/store/radio-settings';

const track = (id: string) => ({ id, url: `/a/${id}.m4a`, title: id, artist: '', credit: 'CC0', duration: 10 });
const station = (id: string) => ({ id, name: id, description: '', tracks: [track(`${id}-1`), track(`${id}-2`)] });
const STATIONS = { version: 1, stations: [station('christmas-jazz'), station('christmas-classics')] };

/** An AudioParam that records every scheduling call. */
class FakeParam {
  value = 1;
  calls: [string, ...number[]][] = [];
  cancelScheduledValues(t: number): void {
    this.calls.push(['cancelScheduledValues', t]);
  }
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.calls.push(['setValueAtTime', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(['linearRampToValueAtTime', v, t]);
  }
  setTargetAtTime(v: number, t: number, tc: number): void {
    this.calls.push(['setTargetAtTime', v, t, tc]);
  }
}

const fakeNode = () => ({ gain: new FakeParam(), connect: () => undefined, disconnect: () => undefined });

/** Installs a minimal AudioContext + music bus on the shared `audio` engine. */
function fakeAudio() {
  const ctx = {
    currentTime: 0,
    state: 'running',
    resume: async () => undefined,
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0 }),
    createGain: fakeNode,
    createMediaElementSource: () => ({ connect: () => undefined }),
  };
  const music = fakeNode();
  audio.ctx = ctx as unknown as AudioContext;
  audio.music = music as unknown as GainNode;
  return { ctx, gain: music.gain };
}

let gate: Promise<void> = Promise.resolve();

beforeEach(() => {
  localStorage.clear();
  gate = Promise.resolve();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      await gate;
      return url.includes('piano') ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(STATIONS));
    }),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
});

afterEach(() => {
  audio.ctx = null;
  audio.music = null;
  vi.restoreAllMocks();
});

async function ready(): Promise<Radio> {
  const r = new Radio();
  await r.refreshCatalog();
  return r;
}

it('suggests the scene station when nothing was chosen, without remembering it', async () => {
  fakeAudio(); // `on` is only meaningful when something actually plays
  const r = await ready();
  r.setScene('frost');
  r.playPause();
  expect(r.view().station?.id).toBe('christmas-classics');
  expect(loadRadioSettings().source).toBeNull();
  expect(loadRadioSettings().on).toBe(true);
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

it('re-selecting the playing station does not restart it', async () => {
  const r = await ready();
  r.select('christmas-jazz');
  const track = r.view().track;
  const spy = vi.spyOn(HTMLMediaElement.prototype, 'play');
  spy.mockClear();
  r.select('christmas-jazz');
  expect(r.view().track).toBe(track);
  expect(spy).not.toHaveBeenCalled();
});

it('duck is a no-op during the first fade-in, then ducks and ends back at the volume', async () => {
  const { ctx, gain } = fakeAudio();
  const r = await ready();
  r.firstGesture();
  expect(gain.calls.slice(0, 2)).toEqual([
    ['setValueAtTime', 0, 0],
    ['linearRampToValueAtTime', 0.7, 2],
  ]);
  ctx.currentTime = 1;
  const before = gain.calls.length;
  r.duck();
  expect(gain.calls.length).toBe(before); // the fade-in ramp is left alone
  ctx.currentTime = 3;
  r.duck();
  const after = gain.calls.slice(before);
  expect(after[0][0]).toBe('cancelScheduledValues');
  const [ramp1, ramp2] = after.slice(-2);
  expect(ramp1[1]).toBeCloseTo(0.7 * 0.63);
  expect(ramp2[0]).toBe('linearRampToValueAtTime');
  expect(ramp2[1]).toBe(0.7);
  expect(ramp2[2]).toBeCloseTo(3.28);
});

it('setVolume cancels scheduled gain events before easing to the new volume', async () => {
  const { ctx, gain } = fakeAudio();
  const r = await ready();
  r.firstGesture();
  ctx.currentTime = 1;
  const before = gain.calls.length;
  r.setVolume(0.3);
  expect(gain.calls.slice(before).map((c) => c[0])).toEqual(['cancelScheduledValues', 'setValueAtTime', 'setTargetAtTime']);
  expect(gain.calls.at(-1)?.[1]).toBe(0.3);
  // The fade-in no longer protects the bus: ducking works again.
  const mark = gain.calls.length;
  r.duck();
  expect(gain.calls.length).toBeGreaterThan(mark);
});

it('a first gesture before the catalog loads primes, waits, then starts the preferred station (never Fireplace)', async () => {
  fakeAudio();
  let open!: () => void;
  gate = new Promise<void>((res) => (open = res));
  const fire = vi.spyOn(Fireplace.prototype, 'start');
  const r = new Radio();
  r.setScene('frost');
  r.firstGesture();
  expect(r.view().kind).toBeNull();
  expect(loadRadioSettings().on).toBe(true);
  open();
  await vi.waitFor(() => expect(r.view().kind).toBe('station'));
  expect(r.view().station?.id).toBe('christmas-classics');
  expect(fire).not.toHaveBeenCalled();
  expect(loadRadioSettings().source).toBeNull();
});

it('uses Fireplace only once the catalog has loaded with nothing playable', async () => {
  fakeAudio();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
  const fire = vi.spyOn(Fireplace.prototype, 'start').mockReturnValue(undefined);
  const r = new Radio();
  r.firstGesture();
  await vi.waitFor(() => expect(r.view().kind).toBe('fireplace'));
  expect(fire).toHaveBeenCalledTimes(1);
});

it('lock-screen play/pause go through playPause (saving `on`) and are ignored for Fireplace', async () => {
  fakeAudio();
  const r = await ready();
  r.select('christmas-jazz');
  const remote = (r as unknown as { player: { onRemote: (a: string) => boolean } }).player.onRemote;
  expect(remote('pause')).toBe(true);
  expect(loadRadioSettings().on).toBe(false);
  expect(remote('play')).toBe(true);
  expect(loadRadioSettings().on).toBe(true);
  expect(remote('nexttrack')).toBe(false);
  vi.spyOn(Fireplace.prototype, 'start').mockReturnValue(undefined);
  r.select('fireplace');
  expect(remote('nexttrack')).toBe(true); // swallowed: the old station must not wake up
  expect(remote('play')).toBe(true);
  expect(r.view().kind).toBe('fireplace');
});
