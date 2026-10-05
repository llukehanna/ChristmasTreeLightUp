import { audio } from '../audio/context';
import { crossfadeLength, equalPowerCurve } from './dsp';
import { buildQueue, nextIndex, prevIndex } from './queue';
import type { Station, Track } from './schema';

export const CROSSFADE_S = 3;
/** Start the crossfade this much earlier than CROSSFADE_S before the end, so it completes even if the incoming deck is slow to start. */
const CROSSFADE_LEAD_S = 0.75;
/** Begin buffering the next track on the idle deck this long before the end of the current one. */
const PRELOAD_S = 20;
const SKIP_FADE_S = 0.25;
/** Short ramp used wherever a gain would otherwise jump (pause, resume, stop): long enough to avoid a click. */
const QUICK_FADE_S = 0.03;
const POSITION_STATE_MS = 1000;

export type RemoteAction = 'play' | 'pause' | 'nexttrack' | 'previoustrack' | 'seekto';

export interface PlayerSnapshot {
  station: Station | null;
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  unavailable: boolean;
}

/** A tiny valid silent WAV, used to prime a deck inside the first user gesture (iOS only lets elements that were played in a gesture play later). */
function silentWavUrl(): string {
  const samples = 8;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
}

/** Fade a gain to `target` from wherever it is now (no jump), along an equal-power curve. */
function rampTo(ctx: AudioContext, param: AudioParam, target: number, dur: number): void {
  const now = ctx.currentTime;
  const from = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  if (dur <= 0 || Math.abs(from - target) < 1e-4) {
    param.setValueAtTime(target, now);
    return;
  }
  const steps = Math.min(48, Math.max(4, Math.ceil(dur * 16)));
  const curve = equalPowerCurve(from, target, steps);
  for (let k = 1; k <= steps; k++) param.linearRampToValueAtTime(curve[k], now + (dur * k) / steps);
}

/** One playback deck: <audio> → MediaElementSource → gain → music bus. */
class Deck {
  readonly el = new Audio();
  readonly gain: GainNode;
  /** Id of the track currently loaded (or preloading) in this element; null when empty or only primed. */
  trackId: string | null = null;
  constructor(ctx: AudioContext, out: AudioNode) {
    // Required for any audio routed through a MediaElementSource from another origin (not just for analysers):
    // without it the element's output is silenced. TODO(Plan 3): verify that Vercel Blob sends Access-Control-Allow-Origin.
    this.el.crossOrigin = 'anonymous';
    this.el.preload = 'auto';
    const src = ctx.createMediaElementSource(this.el);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.gain);
    this.gain.connect(out);
  }
}

/** Two decks crossfading through Web Audio (spec §5.2). */
export class RadioPlayer {
  onChange: (() => void) | null = null;
  /** Consulted first by every Media Session handler (lock screen, headset keys). Return true to consume the action. */
  onRemote: ((action: RemoteAction, seekTime?: number) => boolean) | null = null;
  private decks: [Deck, Deck] | null = null;
  private active = 0;
  private queue: Track[] = [];
  private index = 0;
  private station: Station | null = null;
  private failures = 0;
  private playing = false;
  /** Bumped on every load; stale fade-start callbacks compare against it. */
  private gen = 0;
  private pending: { el: HTMLAudioElement; fn: () => void } | null = null;
  private lastPositionState = 0;
  private mediaSessionReady = false;
  private readonly unavailable = new Set<string>();

  constructor(private readonly out: () => AudioNode | null) {}

  /** Call inside the user gesture that starts playback (it primes both decks for iOS). */
  playStation(station: Station, shuffle: boolean): void {
    if (station.tracks.length === 0) return; // nothing to play: leave whatever is playing alone
    if (this.unavailable.has(station.id)) {
      // Show the station as unavailable and stop the old one rather than restarting a station that already failed.
      this.station = station;
      this.queue = [];
      this.index = 0;
      this.stop();
      return;
    }
    this.station = station;
    this.queue = buildQueue(station.tracks, shuffle, Math.random);
    this.failures = 0;
    this.load(0, false);
  }

  /** Create and prime both decks. Call inside a user gesture when playback will only start later (e.g. once the catalog has loaded). */
  prime(): void {
    this.ensureDecks();
  }

  /**
   * Register the lock-screen / media-key handlers, once. Each handler asks `onRemote` first, so the Radio can route
   * them for sources that have no decks (Music Box) as well as for stations.
   */
  claimMediaSession(): void {
    if (this.mediaSessionReady) return;
    this.mediaSessionReady = true;
    this.setupMediaSession();
  }

  /** Leave the lock screen / media keys alone once something else (Fireplace, an embed) is the source. */
  releaseMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {
      /* unsupported: ignore */
    }
  }

  setShuffle(on: boolean): void {
    if (!this.station || this.queue.length === 0) return;
    const current = this.queue[this.index];
    const rest = this.station.tracks.filter((t) => t.id !== current.id);
    this.queue = [current, ...buildQueue(rest, on, Math.random)];
    this.index = 0;
  }

  next(): void {
    if (this.queue.length) this.load(nextIndex(this.index, this.queue.length), false);
  }

  prev(): void {
    if (!this.queue.length) return;
    const i = prevIndex(this.index, this.queue.length, this.activeEl()?.currentTime ?? 0);
    if (i === this.index) this.seek(0);
    else this.load(i, false);
  }

  pause(): void {
    this.playing = false;
    this.silence();
    this.syncPlaybackState();
    this.onChange?.();
  }

  resume(): void {
    if (this.station && this.unavailable.has(this.station.id)) return;
    const ctx = audio.unlock();
    const d = this.decks?.[this.active];
    if (!d || d.trackId === null || d.el.error || !ctx) {
      if (this.station && this.queue.length) this.load(this.index, false);
      return;
    }
    this.playing = true;
    rampTo(ctx, d.gain.gain, 1, QUICK_FADE_S);
    void d.el.play().catch(() => undefined);
    this.syncPlaybackState();
    this.onChange?.();
  }

  stop(): void {
    this.playing = false;
    this.silence();
    this.syncPlaybackState();
    this.onChange?.();
  }

  seek(sec: number): void {
    const el = this.activeEl();
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(el.duration - 0.5, sec));
      this.updatePositionState(true);
    }
  }

  isUnavailable(id: string): boolean {
    return this.unavailable.has(id);
  }

  snapshot(): PlayerSnapshot {
    const el = this.activeEl();
    return {
      station: this.station,
      track: this.queue[this.index] ?? null,
      playing: this.playing,
      position: el?.currentTime ?? 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      unavailable: this.station ? this.unavailable.has(this.station.id) : false,
    };
  }

  private activeEl(): HTMLAudioElement | null {
    return this.decks?.[this.active].el ?? null;
  }

  /** Fade both decks out quickly, then pause them (unless playback was resumed meanwhile). Silences an outgoing crossfade deck too. */
  private silence(): void {
    const decks = this.decks;
    if (!decks) return;
    const ctx = audio.ctx;
    if (ctx) for (const d of decks) rampTo(ctx, d.gain.gain, 0, QUICK_FADE_S);
    window.setTimeout(
      () => {
        if (!this.playing) for (const d of decks) d.el.pause();
      },
      QUICK_FADE_S * 1000 + 40,
    );
  }

  private ensureDecks(): [Deck, Deck] | null {
    if (this.decks) return this.decks;
    const ctx = audio.unlock();
    const out = this.out();
    if (!ctx || !out) return null;
    const decks: [Deck, Deck] = [new Deck(ctx, out), new Deck(ctx, out)];
    const silent = silentWavUrl();
    decks.forEach((d, k) => {
      d.el.addEventListener('timeupdate', () => this.onTime(k));
      d.el.addEventListener('durationchange', () => k === this.active && this.updatePositionState(true));
      d.el.addEventListener('playing', () => {
        if (k === this.active) this.failures = 0;
      });
      d.el.addEventListener('ended', () => k === this.active && d.trackId !== null && this.next());
      d.el.addEventListener('error', () => k === this.active && d.trackId !== null && this.onError());
      // iOS only allows a non-gesture play() on elements already played inside a gesture: prime both decks now.
      d.el.src = silent;
      void d.el.play().catch(() => undefined);
      d.el.pause();
    });
    this.decks = decks;
    this.claimMediaSession();
    return decks;
  }

  /**
   * Switch decks. The incoming deck's fade-in only starts once it is actually playing (it may need to buffer);
   * a crossfade fades the outgoing deck at the same moment, a skip fades it out immediately.
   */
  private load(i: number, crossfade: boolean): void {
    if (this.station && this.unavailable.has(this.station.id)) return;
    const decks = this.ensureDecks();
    const ctx = audio.ctx;
    if (!decks || !ctx || this.queue.length === 0) return;
    const track = this.queue[i];
    this.index = i;
    const incoming = decks[1 - this.active];
    const outgoing = decks[this.active];
    const gen = ++this.gen;
    this.clearPending();

    incoming.el.pause();
    if (incoming.trackId !== track.id || incoming.el.error) {
      incoming.el.src = track.url; // not preloaded (or the preload failed)
      incoming.trackId = track.id;
    } else if (incoming.el.currentTime > 0) {
      incoming.el.currentTime = 0;
    }
    rampTo(ctx, incoming.gain.gain, 0, QUICK_FADE_S);

    const old = outgoing.el;
    const scheduleOldPause = (fade: number) =>
      window.setTimeout(() => {
        if (this.activeEl() !== old) old.pause();
      }, fade * 1000 + 50);

    if (!crossfade) {
      rampTo(ctx, outgoing.gain.gain, 0, SKIP_FADE_S); // skips fade the old track out right away
      scheduleOldPause(SKIP_FADE_S);
    }

    const start = () => {
      if (this.pending?.fn === start) this.pending = null;
      if (gen !== this.gen) return;
      if (!this.playing) {
        incoming.el.pause(); // paused while it was still buffering
        return;
      }
      let fade = SKIP_FADE_S;
      if (crossfade) {
        fade = crossfadeLength(old.duration - old.currentTime, CROSSFADE_S);
        rampTo(ctx, outgoing.gain.gain, 0, fade);
        scheduleOldPause(fade);
      }
      rampTo(ctx, incoming.gain.gain, 1, fade);
    };
    incoming.el.addEventListener('playing', start, { once: true });
    this.pending = { el: incoming.el, fn: start };

    this.active = 1 - this.active;
    this.playing = true;
    incoming.el.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        this.playing = false;
        this.syncPlaybackState();
        this.onChange?.();
      }
    });
    this.updateMediaSession(track);
    this.syncPlaybackState();
    this.onChange?.();
  }

  private clearPending(): void {
    if (this.pending) this.pending.el.removeEventListener('playing', this.pending.fn);
    this.pending = null;
  }

  private onTime(k: number): void {
    const decks = this.decks;
    if (k !== this.active || !decks) return;
    const d = decks[k];
    const el = d.el;
    // Never advance while paused (a seek into the last seconds while paused must not start the next track).
    if (!this.playing || d.trackId === null || el.paused) return;
    const dur = el.duration;
    if (this.queue.length > 1 && Number.isFinite(dur)) {
      const remaining = dur - el.currentTime;
      if (remaining <= CROSSFADE_S + CROSSFADE_LEAD_S) {
        this.load(nextIndex(this.index, this.queue.length), true);
        return;
      }
      if (remaining <= PRELOAD_S) this.preloadNext(decks);
    }
    this.updatePositionState(false);
    this.onChange?.();
  }

  /** Buffer the next track on the idle deck ahead of time so the crossfade can start the moment it is needed. */
  private preloadNext(decks: [Deck, Deck]): void {
    const idle = decks[1 - this.active];
    if (!idle.el.paused) return; // still fading out the previous track
    const next = this.queue[nextIndex(this.index, this.queue.length)];
    if (idle.trackId === next.id && !idle.el.error) return;
    idle.el.src = next.url;
    idle.trackId = next.id;
  }

  /** Skip on error; after 3 consecutive failures mark the station unavailable for this session (spec §8). */
  private onError(): void {
    this.failures++;
    if (this.failures >= 3) {
      if (this.station) this.unavailable.add(this.station.id);
      this.stop();
      return;
    }
    // With one track there is nothing to skip to: retry it until the failure limit is reached.
    this.load(this.queue.length > 1 ? nextIndex(this.index, this.queue.length) : this.index, false);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const remote = (action: RemoteAction, fallback: (seekTime?: number) => void): MediaSessionActionHandler => (d) => {
      const seekTime = d.seekTime ?? undefined;
      if (this.onRemote?.(action, seekTime)) return;
      fallback(seekTime);
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', remote('play', () => this.resume())],
      ['pause', remote('pause', () => this.pause())],
      ['nexttrack', remote('nexttrack', () => this.next())],
      ['previoustrack', remote('previoustrack', () => this.prev())],
      ['seekto', remote('seekto', (t) => {
        if (t !== undefined) this.seek(t);
      })],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* this browser does not support that action */
      }
    }
  }

  private syncPlaybackState(): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
    } catch {
      /* unsupported: ignore */
    }
  }

  private updateMediaSession(t: Track): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata !== 'function') return;
    const art = t.cover ?? this.station?.cover;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: this.station?.name ?? 'Aglow',
        artwork: art ? [{ src: art }] : [],
      });
    } catch {
      /* a malformed artwork URL must not break playback */
    }
  }

  /** Keeps the lock-screen scrubber moving. Throttled; only finite values are ever passed. */
  private updatePositionState(force: boolean): void {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const now = Date.now();
    if (!force && now - this.lastPositionState < POSITION_STATE_MS) return;
    const el = this.activeEl();
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0 || !Number.isFinite(el.currentTime)) return;
    this.lastPositionState = now;
    try {
      navigator.mediaSession.setPositionState({ duration: el.duration, playbackRate: 1, position: Math.min(el.currentTime, el.duration) });
    } catch {
      /* invalid state for this browser: ignore */
    }
  }
}
