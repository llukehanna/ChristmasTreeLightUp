// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../../../src/audio/context';
import * as builtin from '../../../src/radio/builtin';
import { STATIONS_URL } from '../../../src/radio/catalog';
import { Fireplace } from '../../../src/radio/fireplace';
import { MusicBox } from '../../../src/radio/musicbox';
import { RadioPlayer } from '../../../src/radio/player';
import { Radio } from '../../../src/radio/radio';
import { DEFAULT_RADIO, loadRadioSettings, saveRadioSettings } from '../../../src/store/radio-settings';

const track = (id: string) => ({ id, url: `/a/${id}.m4a`, title: id, artist: '', credit: 'CC0', duration: 10 });
const station = (id: string) => ({ id, name: id, description: '', tracks: [track(`${id}-1`), track(`${id}-2`)] });
const STATIONS = { version: 1, stations: [station('christmas-jazz'), station('christmas-classics')] };
const WITH_SECRET = { version: 1, stations: [...STATIONS.stations, station('secret')] };
let served: unknown = STATIONS;

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
let fetched: string[] = [];

beforeEach(() => {
  localStorage.clear();
  gate = Promise.resolve();
  fetched = [];
  served = STATIONS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      await gate;
      return new Response(JSON.stringify(served));
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
  fakeAudio(); // without a context the player never loads, and the test would prove nothing
  const r = await ready();
  r.select('christmas-jazz');
  expect(r.view().playing).toBe(true);
  const track = r.view().track;
  expect(track).not.toBeNull();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
  const playStation = vi.spyOn(RadioPlayer.prototype, 'playStation');
  play.mockClear();
  r.select('christmas-jazz');
  expect(playStation).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  expect(r.view().track).toBe(track);
  expect(r.view().playing).toBe(true);
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

it('falls back to Music Box (not Fireplace) once the catalog has loaded with nothing playable', async () => {
  fakeAudio();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
  const fire = vi.spyOn(Fireplace.prototype, 'start').mockReturnValue(undefined);
  const box = vi.spyOn(MusicBox.prototype, 'start').mockReturnValue(undefined);
  const r = new Radio();
  r.firstGesture();
  expect(r.view().kind).toBeNull(); // Fireside suggests Jazz, which needs the catalog: wait for it
  await vi.waitFor(() => expect(r.view().kind).toBe('musicbox'));
  expect(box).toHaveBeenCalledTimes(1);
  expect(fire).not.toHaveBeenCalled();
  expect(loadRadioSettings().source).toBeNull(); // a fallback is not a choice
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

const CAROL = { id: 'silent-night', title: 'Silent Night', artist: 'Franz Xaver Gruber', credit: '"Silent Night" — Franz Xaver Gruber / public domain, arranged for Aglow', duration: 66, position: 3 };

function stubMusicBox() {
  return {
    start: vi.spyOn(MusicBox.prototype, 'start').mockReturnValue(undefined),
    stop: vi.spyOn(MusicBox.prototype, 'stop'),
    next: vi.spyOn(MusicBox.prototype, 'next').mockReturnValue(undefined),
    prev: vi.spyOn(MusicBox.prototype, 'prev').mockReturnValue(undefined),
    current: vi.spyOn(MusicBox.prototype, 'current').mockReturnValue(CAROL),
  };
}

it('scenes suggest Jazz by the fire, Classics in the frost and Music Box at midnight', () => {
  expect(builtin.SCENE_STATION).toEqual({ fireside: 'christmas-jazz', frost: 'christmas-classics', midnight: 'music-box' });
});

it('has no Piano Carols left: no ids, no bundled fetch', async () => {
  expect(Object.keys(builtin).filter((k) => /piano/i.test(k))).toEqual([]);
  expect(JSON.stringify(builtin)).not.toMatch(/piano/i);
  await ready(); // constructor + explicit refresh: two catalog loads
  expect(fetched).toEqual([STATIONS_URL, STATIONS_URL]); // one request each, to the station list only
});

it('a first gesture at midnight starts Music Box at once, without waiting for the catalog', async () => {
  fakeAudio();
  let open!: () => void;
  gate = new Promise<void>((res) => (open = res));
  const box = stubMusicBox();
  const prime = vi.spyOn(RadioPlayer.prototype, 'prime');
  const r = new Radio();
  r.setScene('midnight');
  r.firstGesture();
  expect(r.view().kind).toBe('musicbox');
  expect(box.start).toHaveBeenCalledTimes(1);
  expect(prime).not.toHaveBeenCalled();
  expect(loadRadioSettings()).toMatchObject({ on: true, source: null });
  open();
  await r.refreshCatalog();
  expect(r.view().kind).toBe('musicbox'); // the catalog arriving doesn't switch it
  expect(box.start).toHaveBeenCalledTimes(1);
});

it('select(music-box) plays it, shows the carol as the track and allows the light show', async () => {
  fakeAudio();
  stubMusicBox();
  const r = await ready();
  r.select('music-box');
  const v = r.view();
  expect(v.kind).toBe('musicbox');
  expect(v.playing).toBe(true);
  expect(v.station).toBeNull();
  expect(v.track).toMatchObject({ title: 'Silent Night', artist: 'Franz Xaver Gruber', credit: CAROL.credit, duration: 66 });
  expect(v.position).toBe(3);
  expect(r.lightShowActive).toBe(true);
  expect(loadRadioSettings()).toMatchObject({ on: true, source: 'music-box' });
});

it('Music Box: next/prev skip carols, playPause stops it, and choosing a station stops it', async () => {
  fakeAudio();
  const box = stubMusicBox();
  const r = await ready();
  r.select('music-box');
  r.next();
  r.prev();
  expect(box.next).toHaveBeenCalledTimes(1);
  expect(box.prev).toHaveBeenCalledTimes(1);
  r.playPause();
  expect(r.view().kind).toBeNull();
  expect(box.stop).toHaveBeenCalled();
  expect(loadRadioSettings().on).toBe(false);
  r.playPause(); // the remembered source comes back
  expect(r.view().kind).toBe('musicbox');
  box.stop.mockClear();
  r.select('christmas-jazz');
  expect(box.stop).toHaveBeenCalled();
  expect(r.view().kind).toBe('station');
});

it('Music Box owns the lock screen while it plays, and a remote key never wakes it once stopped', async () => {
  fakeAudio();
  const box = stubMusicBox();
  const handlers = new Map<string, (d: { seekTime?: number }) => void>();
  const session = { metadata: null as unknown, playbackState: 'none', setActionHandler: (a: string, h: (d: { seekTime?: number }) => void) => handlers.set(a, h) };
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(readonly init: MediaMetadataInit) {}
    },
  );
  try {
    const r = await ready();
    r.select('music-box');
    expect(session.metadata).toMatchObject({ init: { title: 'Silent Night', artist: 'Franz Xaver Gruber', album: 'Aglow Radio' } });
    expect(session.playbackState).toBe('playing');
    handlers.get('nexttrack')?.({});
    expect(box.next).toHaveBeenCalledTimes(1);
    handlers.get('previoustrack')?.({});
    expect(box.prev).toHaveBeenCalledTimes(1);
    handlers.get('play')?.({});
    expect(box.start).toHaveBeenCalledTimes(1); // already playing: nothing restarts
    handlers.get('pause')?.({});
    expect(r.view().kind).toBeNull();
    expect(loadRadioSettings().on).toBe(false);
    expect(session.metadata).toBeNull();
    handlers.get('play')?.({});
    handlers.get('nexttrack')?.({});
    expect(r.view().kind).toBeNull(); // stopped stays stopped
    expect(box.start).toHaveBeenCalledTimes(1);
    expect(box.next).toHaveBeenCalledTimes(1);
  } finally {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  }
});

/** Fires `error` on the station's active deck (jsdom elements: the player only listens for the event). */
function failActiveDeck(r: Radio): void {
  const p = (r as unknown as { player: { decks: { el: HTMLAudioElement }[]; active: number } }).player;
  p.decks[p.active].el.dispatchEvent(new Event('error'));
}

it('a playing station that becomes unavailable falls back to Music Box, without remembering it', async () => {
  fakeAudio();
  const box = stubMusicBox();
  const r = await ready();
  r.select('christmas-jazz');
  for (let k = 0; k < 3; k++) failActiveDeck(r);
  expect(r.view().unavailable('christmas-jazz')).toBe(true);
  expect(r.view().kind).toBe('musicbox');
  expect(r.view().playing).toBe(true);
  expect(box.start).toHaveBeenCalledTimes(1);
  expect(loadRadioSettings()).toMatchObject({ on: true, source: 'christmas-jazz' }); // the fallback is not a choice
});

it('a paused station that becomes unavailable is let go, so play starts something that can play', async () => {
  fakeAudio();
  const box = stubMusicBox();
  const r = await ready();
  r.select('christmas-jazz');
  failActiveDeck(r);
  failActiveDeck(r);
  r.playPause(); // paused while the third track is still loading
  failActiveDeck(r);
  expect(r.view().unavailable('christmas-jazz')).toBe(true);
  expect(r.view().kind).toBeNull(); // no dead play button on a station that can't play
  expect(box.start).not.toHaveBeenCalled(); // and nothing starts on its own while paused
  r.playPause();
  expect(r.view().playing).toBe(true);
  expect(r.view().station?.id).not.toBe('christmas-jazz');
});

describe('secret mode (spec §4.4)', () => {
  /** Music Box and the celesta need a real context: record their start instead. */
  const boxes = () => vi.spyOn(MusicBox.prototype, 'start').mockImplementation(() => undefined);

  it('never lists the Secret station, and says whether secret mode is on', async () => {
    served = WITH_SECRET;
    const r = await ready();
    expect(r.view().stations.map((s) => s.id)).toEqual(['christmas-jazz', 'christmas-classics']);
    expect(r.view()).toMatchObject({ secretMode: false, secretStation: { id: 'secret' } });
    r.setSecret(true, false);
    expect(r.view().secretMode).toBe(true);
    expect(r.view().stations.map((s) => s.id)).not.toContain('secret');
  });

  it('by hand: plays the Secret station (never remembered), and switching off restores what played', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('christmas-jazz');
    r.setSecret(true, true);
    expect(r.view().station?.id).toBe('secret');
    expect(loadRadioSettings().source).toBe('christmas-jazz');
    r.setSecret(false, true);
    expect(r.view().station?.id).toBe('christmas-jazz');
    expect(loadRadioSettings()).toMatchObject({ on: true, source: 'christmas-jazz' });
  });

  it('with no playable Secret station, plays the celesta; off restores the silence it found', async () => {
    fakeAudio();
    const start = boxes();
    const r = await ready();
    r.setSecret(true, true);
    expect(r.view().kind).toBe('celesta');
    expect(start).toHaveBeenCalledTimes(1);
    r.setSecret(false, true);
    expect(r.view().kind).toBeNull();
    expect(r.view().playing).toBe(false);
  });

  it('a muted radio, or a quiet switch, plays nothing', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setSecret(true, false);
    expect(r.view().kind).toBeNull();
    r.setSecret(false, false);
    r.setVolume(0);
    r.setSecret(true, true);
    expect(r.view().kind).toBeNull();
  });

  it('switched on before the catalog arrives: primed in the gesture, plays when it lands', async () => {
    fakeAudio();
    served = WITH_SECRET;
    let open!: () => void;
    gate = new Promise<void>((res) => (open = res));
    const prime = vi.spyOn(RadioPlayer.prototype, 'prime');
    const r = new Radio();
    r.primeSecret();
    r.setSecret(true, true);
    expect(prime).toHaveBeenCalled();
    expect(r.view().kind).toBeNull();
    open();
    await vi.waitFor(() => expect(r.view().station?.id).toBe('secret'));
  });

  it("the listener's own pick wins: switching off no longer restores", async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('christmas-jazz');
    r.setSecret(true, true);
    r.select('christmas-classics');
    r.setSecret(false, true);
    expect(r.view().station?.id).toBe('christmas-classics');
  });

  it('off with a secret source and nothing saved: moves on to the preferred source', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setScene('frost');
    r.setSecret(true, false);
    r.select('secret');
    expect(r.view().station?.id).toBe('secret');
    expect(loadRadioSettings().source).toBeNull();
    r.setSecret(false, false);
    expect(r.view().station?.id).toBe('christmas-classics');
  });

  it('the Secret station is the suggestion in secret mode, and never the fallback outside it', async () => {
    fakeAudio();
    boxes();
    served = { version: 1, stations: [station('secret')] };
    const r = await ready();
    r.playPause();
    expect(r.view().kind).toBe('musicbox');
    r.playPause();
    r.setSecret(true, false);
    r.playPause();
    expect(r.view().station?.id).toBe('secret');
  });

  it('select("secret") only works in secret mode; select("celesta") never', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('secret');
    r.select('celesta');
    expect(r.view().kind).toBeNull();
    r.setSecret(true, false);
    r.select('secret');
    expect(r.view().station?.id).toBe('secret');
  });

  it('a Secret station that keeps failing falls back to the celesta', async () => {
    fakeAudio();
    boxes();
    served = WITH_SECRET;
    const r = await ready();
    r.setSecret(true, true);
    (r as unknown as { player: RadioPlayer }).player.onUnavailable?.(true);
    expect(r.view().kind).toBe('celesta');
  });

  it('switched on and off before the first move: the first move still starts the music', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.primeSecret();
    r.setSecret(true, true);
    r.setSecret(false, true);
    expect(r.view().kind).toBeNull();
    r.firstGesture();
    expect(r.view().station?.id).toBe('christmas-jazz'); // the default fireside scene's suggestion
  });

  it('the first move never interrupts what secret mode started', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.primeSecret();
    r.setSecret(true, true);
    r.firstGesture();
    expect(r.view().station?.id).toBe('secret');
  });

  it('hands out the Secret station win ad-lib', async () => {
    served = { version: 1, stations: [{ ...station('secret'), winSound: '/w.mp3' }] };
    const r = await ready();
    expect(r.secretWinSound()).toBe('/w.mp3');
  });

  it('the Secret row tapped before the catalog arrives primes in the gesture, then plays when it lands', async () => {
    fakeAudio();
    served = WITH_SECRET;
    let open!: () => void;
    gate = new Promise<void>((res) => (open = res));
    const prime = vi.spyOn(RadioPlayer.prototype, 'prime');
    const unlock = vi.spyOn(audio, 'unlock');
    const r = new Radio();
    r.setSecret(true, false); // a load in secret mode
    r.select('secret');
    expect(prime).toHaveBeenCalled();
    expect(unlock).toHaveBeenCalled();
    open();
    await vi.waitFor(() => expect(r.view().station?.id).toBe('secret'));
  });

  it('while a snapshot is held, storage keeps what switching off would restore, so a reload never turns music back on', async () => {
    saveRadioSettings({ ...DEFAULT_RADIO, on: false, source: 'christmas-classics' });
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setSecret(true, true);
    expect(r.view().station?.id).toBe('secret');
    expect(loadRadioSettings()).toMatchObject({ on: false, source: 'christmas-classics' });
    r.setVolume(0.5); // other settings still persist
    expect(loadRadioSettings()).toMatchObject({ on: false, source: 'christmas-classics', volume: 0.5 });
    // A reload during secret mode: the egg switches it back on quietly; the first move and switch-off play nothing.
    const again = await ready();
    again.setSecret(true, false);
    again.firstGesture();
    again.setSecret(false, false);
    expect(again.view().playing).toBe(false);
    expect(loadRadioSettings().on).toBe(false);
  });

  it("the listener's own pick is persisted at once, even while a snapshot was held", async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('christmas-jazz');
    r.setSecret(true, true);
    r.select('christmas-classics');
    expect(loadRadioSettings()).toMatchObject({ on: true, source: 'christmas-classics' });
  });

  it('play/pause is a choice too: switching off no longer restores', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setScene('frost');
    r.playPause(); // the frost suggestion, christmas-classics (not remembered)
    r.setScene('fireside');
    r.setSecret(true, true);
    r.playPause();
    r.playPause();
    expect(r.view().station?.id).toBe('secret');
    r.setSecret(false, true);
    // Not restored to christmas-classics: it leaves the Secret station for the preferred source, fireside's suggestion.
    expect(r.view().station?.id).toBe('christmas-jazz');
  });

  it('a first move still waiting for the catalog is put back when secret mode switches off', async () => {
    fakeAudio();
    served = WITH_SECRET;
    let open!: () => void;
    gate = new Promise<void>((res) => (open = res));
    const r = new Radio();
    r.firstGesture(); // fireside suggests christmas-jazz: waits for the catalog
    r.primeSecret();
    r.setSecret(true, true);
    open();
    await vi.waitFor(() => expect(r.view().station?.id).toBe('secret'));
    r.setSecret(false, true);
    expect(r.view().station?.id).toBe('christmas-jazz');
  });

  it('a stored secret source outside secret mode reads as none: the scene suggestion plays', async () => {
    boxes();
    served = WITH_SECRET;
    for (const source of ['celesta', 'secret']) {
      saveRadioSettings({ ...DEFAULT_RADIO, source });
      fakeAudio();
      const r = await ready();
      r.firstGesture();
      expect(r.view().station?.id, source).toBe('christmas-jazz');
    }
  });

  it('duck(hold) keeps the music down for the hold, then eases back', async () => {
    const { ctx, gain } = fakeAudio();
    const r = await ready();
    r.firstGesture();
    ctx.currentTime = 3;
    const before = gain.calls.length;
    r.duck(2.5);
    const ramps = gain.calls.slice(before).filter((c) => c[0] === 'linearRampToValueAtTime');
    expect(ramps).toHaveLength(3);
    expect(ramps[0][1]).toBeCloseTo(0.7 * 0.63);
    expect(ramps[1][1]).toBeCloseTo(0.7 * 0.63);
    expect(ramps[1][2]).toBeCloseTo(3.03 + 2.5);
    expect(ramps[2][1]).toBe(0.7);
    expect(ramps[2][2]).toBeCloseTo(3.28 + 2.5);
  });

  it("a later, shorter duck never ends an ad-lib's hold early; one that outlasts it extends it", async () => {
    const { ctx, gain } = fakeAudio();
    const r = await ready();
    r.firstGesture();
    ctx.currentTime = 3;
    r.duck(2.5); // the ad-lib: held down until 5.53, back up by 5.78
    const lastRamp = () => gain.calls.filter((c) => c[0] === 'linearRampToValueAtTime').at(-1);
    ctx.currentTime = 4;
    gain.value = 0.7 * 0.63;
    const before = gain.calls.length;
    r.duck(); // a tile tick under the ad-lib
    const ramps = gain.calls.slice(before).filter((c) => c[0] === 'linearRampToValueAtTime');
    expect(ramps.map((c) => c[1])).toEqual([0.7 * 0.63, 0.7 * 0.63, 0.7]);
    expect(ramps[1][2]).toBeCloseTo(3.03 + 2.5);
    expect(lastRamp()?.[2]).toBeCloseTo(3.28 + 2.5);
    // A sound after the hold's end ducks as usual, from its own time.
    ctx.currentTime = 7;
    r.duck();
    expect(lastRamp()?.[2]).toBeCloseTo(7.28);
    // One that would hold longer than the ad-lib still gets its whole hold.
    ctx.currentTime = 8;
    r.duck(3);
    ctx.currentTime = 8.5;
    r.duck(1);
    expect(lastRamp()?.[2]).toBeCloseTo(8.28 + 3);
  });

  it('a volume change ends any hold: the next duck is its own length again', async () => {
    const { ctx, gain } = fakeAudio();
    const r = await ready();
    r.firstGesture();
    ctx.currentTime = 3;
    r.duck(2.5);
    ctx.currentTime = 3.5;
    r.setVolume(0.5);
    ctx.currentTime = 4;
    r.duck();
    expect(gain.calls.filter((c) => c[0] === 'linearRampToValueAtTime').at(-1)).toEqual(['linearRampToValueAtTime', 0.5, 4.28]);
  });
});
