// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { audio } from '../../../src/audio/context';
import { RadioPlayer, STALL_MS } from '../../../src/radio/player';
import type { Station } from '../../../src/radio/schema';

/*
 * The RadioPlayer state machine against fakes: a media element that only records what it is told, and gains whose
 * value follows their scheduled automation on a clock the test moves by hand (together with the fake timers).
 */

const clock = { currentTime: 0 };

/** An AudioParam that evaluates its setValueAtTime / linearRampToValueAtTime events at `clock.currentTime`. */
class FakeParam {
  private base = 1;
  private events: { kind: 'set' | 'lin'; v: number; t: number }[] = [];
  get value(): number {
    const now = clock.currentTime;
    let v = this.base;
    let at = Number.NEGATIVE_INFINITY;
    for (const e of this.events) {
      if (e.t <= now) {
        v = e.v;
        at = e.t;
        continue;
      }
      if (e.kind === 'lin' && Number.isFinite(at)) v += ((e.v - v) * (now - at)) / (e.t - at);
      break;
    }
    return v;
  }
  set value(v: number) {
    this.base = v;
    this.events = [];
  }
  cancelScheduledValues(t: number): void {
    this.events = this.events.filter((e) => e.t < t);
  }
  setValueAtTime(v: number, t: number): void {
    this.events.push({ kind: 'set', v, t });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.events.push({ kind: 'lin', v, t });
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  connect(): void {}
}

/** Stands in for `new Audio()`: records plays, pauses (with the gain's value at that moment) and sources. */
class FakeMedia extends EventTarget {
  static all: FakeMedia[] = [];
  crossOrigin: string | null = null;
  preload = '';
  src = '';
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  error: { code: number } | null = null;
  gain: FakeGain | null = null;
  plays: string[] = [];
  /** The deck's gain at each pause() call. */
  pausedAt: number[] = [];
  constructor() {
    super();
    FakeMedia.all.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    if (!this.src.startsWith('data:')) this.plays.push(this.src); // not the silent priming clip
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.pausedAt.push(this.gain?.gain.value ?? Number.NaN);
  }
  fire(type: string): void {
    if (type === 'error') this.error = { code: 4 };
    this.dispatchEvent(new Event(type));
  }
}

const track = (id: string) => ({ id, url: `/a/${id}.m4a`, title: id, artist: 'Someone', credit: 'CC0', duration: 0 });
const station = (n: number): Station => ({ id: 'jazz', name: 'Jazz', description: '', tracks: Array.from({ length: n }, (_, i) => track(`t${i + 1}`)) });

/** Moves the audio clock and the timers together. */
function advance(ms: number): void {
  for (let left = ms; left > 0; left -= 5) {
    const step = Math.min(5, left);
    clock.currentTime += step / 1000;
    vi.advanceTimersByTime(step);
  }
}

let player: RadioPlayer;

beforeEach(() => {
  vi.useFakeTimers();
  clock.currentTime = 0;
  FakeMedia.all = [];
  vi.stubGlobal('Audio', FakeMedia);
  const ctx = {
    get currentTime() {
      return clock.currentTime;
    },
    state: 'running',
    resume: async () => undefined,
    createGain: () => new FakeGain(),
    createMediaElementSource: (el: FakeMedia) => ({
      connect: (g: FakeGain) => {
        el.gain = g;
      },
    }),
  };
  audio.ctx = ctx as unknown as AudioContext;
  audio.music = new FakeGain() as unknown as GainNode;
  player = new RadioPlayer(() => audio.music);
});

afterEach(() => {
  audio.ctx = null;
  audio.music = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The deck element whose source is this track. */
const deckWith = (id: string): FakeMedia => {
  const d = FakeMedia.all.find((m) => m.src === `/a/${id}.m4a`);
  if (!d) throw new Error(`no deck has ${id}`);
  return d;
};
const gainOf = (m: FakeMedia): number => m.gain?.gain.value ?? Number.NaN;
const totalPlays = () => FakeMedia.all.reduce((n, m) => n + m.plays.length, 0);

/** Starts a station and lets its first track start playing and fade in. */
function startPlaying(n = 3): FakeMedia {
  player.playStation(station(n), false);
  const first = deckWith('t1');
  first.fire('playing');
  advance(300);
  expect(gainOf(first)).toBeCloseTo(1);
  return first;
}

it('starts the crossfade only once the incoming deck is actually playing', () => {
  const a = startPlaying();
  a.duration = 100;
  a.currentTime = 96.5; // inside the crossfade window (3 s + 0.75 s lead)
  a.fire('timeupdate');
  const b = deckWith('t2');
  expect(b.plays).toEqual(['/a/t2.m4a']);
  expect(player.snapshot().track?.id).toBe('t2');
  advance(1000); // buffering: the outgoing track keeps playing at full volume, the incoming one stays silent
  expect(gainOf(a)).toBeCloseTo(1);
  expect(gainOf(b)).toBeCloseTo(0);
  a.currentTime = 97.5;
  b.fire('playing');
  advance(1000);
  expect(gainOf(a)).toBeGreaterThan(0.05);
  expect(gainOf(b)).toBeGreaterThan(0.05);
  advance(2200);
  expect(gainOf(a)).toBeCloseTo(0);
  expect(gainOf(b)).toBeCloseTo(1);
  expect(a.paused).toBe(true);
});

it('skips: the old track fades out at once, the new one fades in when it plays', () => {
  const a = startPlaying();
  player.next();
  const b = deckWith('t2');
  expect(b.plays).toEqual(['/a/t2.m4a']);
  advance(300);
  expect(gainOf(a)).toBeCloseTo(0);
  expect(a.paused).toBe(true);
  b.fire('playing');
  advance(300);
  expect(gainOf(b)).toBeCloseTo(1);
  expect(player.snapshot()).toMatchObject({ playing: true, track: { id: 't2' } });
});

it('skips to the next track on an error', () => {
  const a = startPlaying();
  a.fire('error');
  expect(deckWith('t2').plays).toEqual(['/a/t2.m4a']);
  expect(player.snapshot().track?.id).toBe('t2');
});

it('marks the station unavailable after 3 failures in a row, and says so', () => {
  const unavailable = vi.fn();
  player.onUnavailable = unavailable;
  player.playStation(station(3), false);
  deckWith('t1').fire('error');
  deckWith('t2').fire('error');
  expect(player.isUnavailable('jazz')).toBe(false);
  deckWith('t3').fire('error');
  expect(player.isUnavailable('jazz')).toBe(true);
  expect(player.snapshot()).toMatchObject({ playing: false, unavailable: true });
  expect(unavailable).toHaveBeenCalledWith(true);
  const plays = totalPlays();
  player.resume(); // nothing comes back to life
  expect(totalPlays()).toBe(plays);
});

it('a track that plays resets the failure count', () => {
  player.playStation(station(3), false);
  deckWith('t1').fire('error');
  deckWith('t2').fire('error');
  deckWith('t3').fire('playing');
  deckWith('t3').fire('error');
  expect(player.isUnavailable('jazz')).toBe(false);
});

it('retries a one-track station until the failure limit', () => {
  player.playStation(station(1), false);
  const first = deckWith('t1');
  first.fire('error');
  const retry = FakeMedia.all.find((m) => m !== first && m.src === '/a/t1.m4a');
  expect(retry?.plays).toEqual(['/a/t1.m4a']);
  retry?.fire('error');
  expect(player.isUnavailable('jazz')).toBe(false);
  first.error = null; // reloaded on the other deck
  first.fire('error');
  expect(player.isUnavailable('jazz')).toBe(true);
});

it('pausing during a crossfade silences both decks', () => {
  const a = startPlaying();
  a.duration = 100;
  a.currentTime = 97;
  a.fire('timeupdate');
  const b = deckWith('t2');
  b.fire('playing');
  advance(1000); // mid crossfade: both audible
  expect(gainOf(a)).toBeGreaterThan(0.05);
  expect(gainOf(b)).toBeGreaterThan(0.05);
  player.pause();
  advance(100);
  expect(gainOf(a)).toBeCloseTo(0);
  expect(gainOf(b)).toBeCloseTo(0);
  expect(a.paused && b.paused).toBe(true);
  expect(player.snapshot().playing).toBe(false);
});

it('I1: an error after a pause does not start playback; resume plays the next track', () => {
  const a = startPlaying();
  player.pause();
  advance(100);
  const plays = totalPlays();
  a.fire('error');
  expect(totalPlays()).toBe(plays);
  expect(player.snapshot()).toMatchObject({ playing: false, track: { id: 't2' } });
  player.resume();
  expect(deckWith('t2').plays).toEqual(['/a/t2.m4a']);
  expect(player.snapshot().playing).toBe(true);
});

it('I1: an error after a stop (another source took over) does not start playback', () => {
  const a = startPlaying();
  player.stop();
  const plays = totalPlays();
  a.fire('error'); // e.g. a track that was still buffering when Music Box was chosen
  advance(500);
  expect(totalPlays()).toBe(plays);
  expect(player.snapshot().playing).toBe(false);
});

it('I1: a third error while stopped marks the station unavailable without playing anything', () => {
  const unavailable = vi.fn();
  player.onUnavailable = unavailable;
  player.playStation(station(3), false);
  deckWith('t1').fire('error');
  deckWith('t2').fire('error');
  player.stop();
  const plays = totalPlays();
  deckWith('t3').fire('error');
  expect(totalPlays()).toBe(plays);
  expect(player.isUnavailable('jazz')).toBe(true);
  expect(unavailable).toHaveBeenCalledWith(false);
});

it('I1: an `ended` while paused (inside the silence fade) does not advance', () => {
  const a = startPlaying();
  player.pause();
  const plays = totalPlays();
  a.fire('ended');
  advance(100);
  expect(totalPlays()).toBe(plays);
  expect(player.snapshot()).toMatchObject({ playing: false, track: { id: 't1' } });
});

it('I2: a second quick skip fades the still-audible deck out before pausing and reloading it', () => {
  const a = startPlaying(4);
  player.next(); // t1 fades out on deck a over 0.25 s
  expect(gainOf(a)).toBeCloseTo(1);
  const pausesBefore = a.pausedAt.length;
  player.next(); // deck a comes back as the incoming deck while still audible
  expect(player.snapshot().track?.id).toBe('t3'); // the state changes at once
  expect(a.pausedAt.length).toBe(pausesBefore); // ...but no hard cut
  expect(a.src).toBe('/a/t1.m4a');
  advance(60);
  expect(a.pausedAt.length).toBeGreaterThan(pausesBefore);
  for (const g of a.pausedAt.slice(pausesBefore)) expect(g).toBeLessThanOrEqual(1e-3);
  expect(a.src).toBe('/a/t3.m4a');
  expect(a.plays.at(-1)).toBe('/a/t3.m4a');
});

it('I2: the deferred reload is dropped when another skip supersedes it', () => {
  startPlaying(4);
  player.next();
  player.next(); // deferred onto the audible deck
  player.next(); // supersedes it straight away
  advance(60);
  expect(player.snapshot().track?.id).toBe('t4');
  expect(FakeMedia.all.some((m) => m.plays.includes('/a/t3.m4a'))).toBe(false);
});

it('releasing the Media Session also clears the lock-screen position', () => {
  const setPositionState = vi.fn();
  const session = { playbackState: 'playing', metadata: {}, setPositionState };
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  try {
    player.releaseMediaSession();
    expect(setPositionState).toHaveBeenCalledWith();
    expect(session).toMatchObject({ playbackState: 'none', metadata: null });
  } finally {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  }
});

it('a stale pause timer from three skips ago cannot hard-cut a deck that is fading out again', () => {
  const a = startPlaying(6);
  player.next(); // t=0: a fades out; a timer will pause it at 300 ms
  advance(100);
  player.next(); // a is still audible, so it comes back as the incoming deck (reload deferred)
  advance(50);
  a.fire('playing'); // a (now t3) fades in
  advance(40);
  player.next(); // a is the outgoing deck again, mid fade-in, with its own pause timer
  advance(400); // past the first skip's stale 300 ms timer
  for (const g of a.pausedAt) expect(g).toBeLessThanOrEqual(1e-3); // never a hard cut
  expect(a.paused).toBe(true);
});

it('start(): a deck that finishes buffering after a pause stays silent', () => {
  startPlaying();
  player.next();
  const b = deckWith('t2'); // still buffering: its fade-in is waiting for `playing`
  player.pause();
  advance(100);
  b.fire('playing');
  advance(500);
  expect(gainOf(b)).toBeCloseTo(0);
  expect(b.paused).toBe(true);
  expect(player.snapshot().playing).toBe(false);
});

it('stall watchdog: waiting for STALL_MS with no progress skips the track', () => {
  const a = startPlaying();
  a.fire('waiting');
  advance(STALL_MS - 100);
  expect(player.snapshot().track?.id).toBe('t1');
  advance(200);
  expect(player.snapshot()).toMatchObject({ playing: true, track: { id: 't2' } });
  expect(deckWith('t2').plays).toEqual(['/a/t2.m4a']);
});

it('stall watchdog: `stalled` counts the same way', () => {
  const a = startPlaying();
  a.fire('stalled');
  advance(STALL_MS + 100);
  expect(player.snapshot().track?.id).toBe('t2');
});

it('stall watchdog: a track that never starts is a stall too, and 3 in a row make the station unavailable', () => {
  const unavailable = vi.fn();
  player.onUnavailable = unavailable;
  player.playStation(station(3), false); // no events at all from the network
  advance(STALL_MS + 100);
  expect(player.snapshot().track?.id).toBe('t2');
  advance(STALL_MS + 100);
  expect(player.isUnavailable('jazz')).toBe(false);
  expect(player.snapshot().track?.id).toBe('t3');
  advance(STALL_MS + 100);
  expect(player.isUnavailable('jazz')).toBe(true);
  expect(unavailable).toHaveBeenCalledWith(true);
  expect(player.snapshot().playing).toBe(false);
});

it('stall watchdog: `playing` clears it', () => {
  const a = startPlaying();
  a.fire('waiting');
  advance(STALL_MS - 1000);
  a.fire('playing');
  advance(STALL_MS * 2);
  expect(player.snapshot().track?.id).toBe('t1');
});

it('stall watchdog: a timeupdate with advancing time clears it', () => {
  const a = startPlaying();
  a.currentTime = 1;
  a.fire('waiting');
  advance(STALL_MS - 1000);
  a.currentTime = 2;
  a.fire('timeupdate');
  advance(STALL_MS * 2);
  expect(player.snapshot().track?.id).toBe('t1');
});

it('stall watchdog: a timeupdate that has not advanced does not clear it', () => {
  const a = startPlaying();
  a.currentTime = 1;
  a.fire('waiting');
  advance(STALL_MS - 1000);
  a.fire('timeupdate');
  advance(1100);
  expect(player.snapshot().track?.id).toBe('t2');
});

it('stall watchdog: a user pause cancels it, and so does a stop', () => {
  const a = startPlaying();
  a.fire('waiting');
  player.pause();
  const plays = totalPlays();
  advance(STALL_MS * 2);
  expect(totalPlays()).toBe(plays);
  expect(player.snapshot()).toMatchObject({ playing: false, track: { id: 't1' } });
  player.resume();
  a.fire('waiting');
  player.stop();
  advance(STALL_MS * 2);
  expect(player.snapshot().track?.id).toBe('t1');
  expect(player.isUnavailable('jazz')).toBe(false);
});

it("stall watchdog: a skip cancels the old deck's watchdog, and a stall on the outgoing deck is ignored", () => {
  const a = startPlaying();
  a.fire('waiting');
  player.next();
  const b = deckWith('t2');
  b.fire('playing');
  a.fire('waiting'); // a is no longer the active deck
  advance(STALL_MS * 2);
  expect(player.snapshot()).toMatchObject({ playing: true, track: { id: 't2' } });
});
