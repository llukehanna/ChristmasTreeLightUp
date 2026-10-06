import { audio } from '../audio/context';
import type { Rng } from '../core/rng';
import { crossfadeLength, equalPowerCurve } from './dsp';
import { nextIndex, prevIndex, shuffled } from './queue';
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
/** A playing deck that has not made progress for this long (waiting, stalled, or never started) counts as a failed track. */
export const STALL_MS = 8000;
/** Bytes still trickling in (`progress`) may extend a stall, but never beyond this long after the stall began. */
export const STALL_MAX_MS = 20_000;
/** HTMLMediaElement.HAVE_FUTURE_DATA: enough buffered to play on, so a stall past this is not a slow start. */
const HAVE_FUTURE_DATA = 3;

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
    // without it the element's output is silenced. The R2 media host sends Access-Control-Allow-Origin: * (verified).
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
  /** The current station has just been marked unavailable (3 failures in a row). `wasPlaying`: it was audible, not paused or stopped. */
  onUnavailable: ((wasPlaying: boolean) => void) | null = null;
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
  /** The stall watchdog of the active deck (at most one), with the playhead it was armed at. */
  private stall: { timer: number; from: number; since: number; deadline: number } | null = null;
  private lastPositionState = 0;
  private mediaSessionReady = false;
  private readonly unavailable = new Set<string>();

  /** `rng` orders every station's queue; it is only injectable so tests can pin the order. */
  constructor(private readonly out: () => AudioNode | null, private readonly rng: Rng = Math.random) {}

  /** Call inside the user gesture that starts playback (it primes both decks for iOS). */
  playStation(station: Station): void {
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
    this.queue = shuffled(station.tracks, this.rng);
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
    const ms = navigator.mediaSession;
    try {
      ms.playbackState = 'none';
      ms.metadata = null;
    } catch {
      /* unsupported: ignore */
    }
    try {
      // No arguments clears the lock-screen scrubber; a source without a position must not inherit the station's.
      if (typeof ms.setPositionState === 'function') ms.setPositionState();
    } catch {
      /* unsupported: ignore */
    }
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
    this.clearStall();
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
    this.armStall();
    this.syncPlaybackState();
    this.onChange?.();
  }

  stop(): void {
    this.playing = false;
    this.clearStall();
    this.silence();
    this.syncPlaybackState();
    this.onChange?.();
  }

  seek(sec: number): void {
    const el = this.activeEl();
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(el.duration - 0.5, sec));
      if (this.stall) this.stall.from = el.currentTime; // progress is measured from the new position, even after a backward seek
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
        if (k !== this.active) return;
        this.failures = 0;
        this.clearStall();
      });
      // The network went quiet without an error: only the watchdog can tell a dead stream from a slow one.
      const stalled = () => {
        if (k === this.active && d.trackId !== null) this.armStall();
      };
      d.el.addEventListener('waiting', stalled);
      d.el.addEventListener('stalled', stalled);
      d.el.addEventListener('progress', () => k === this.active && this.extendStall(d.el));
      // `playing`: an `ended` that lands while paused or stopped (e.g. inside the silence() fade) must not start a track.
      d.el.addEventListener('ended', () => k === this.active && d.trackId !== null && this.playing && this.next());
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
   * If the incoming deck is still audible (a fast second skip catches it mid fade-out), it is ramped to silence
   * before it is paused and reloaded, so nothing is hard-cut. The state change itself is synchronous.
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
    this.clearStall();

    const audible = !incoming.el.paused && incoming.gain.gain.value > 1e-3;
    const reuse = incoming.trackId === track.id && !incoming.el.error; // preloaded (or the same track again)
    // Until the deck is reloaded its element still holds the old track: no time, ended or error events act on it.
    if (audible) incoming.trackId = null;
    rampTo(ctx, incoming.gain.gain, 0, QUICK_FADE_S);

    const old = outgoing.el;
    const scheduleOldPause = (fade: number) =>
      window.setTimeout(() => {
        // Superseded loads own the decks now: a stale timer must not cut a deck that has since been reloaded or is fading.
        if (gen === this.gen && this.activeEl() !== old) old.pause();
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
    const begin = () => {
      incoming.el.pause();
      if (!reuse) incoming.el.src = track.url; // not preloaded (or the preload failed)
      else if (incoming.el.currentTime > 0) incoming.el.currentTime = 0;
      incoming.trackId = track.id;
      if (!this.playing) return; // paused during the fade-out: resume() plays the loaded deck
      incoming.el.addEventListener('playing', start, { once: true });
      this.pending = { el: incoming.el, fn: start };
      this.armStall(); // a track that never produces a `playing` (or an error) is a failure too
      incoming.el.play().catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          this.playing = false;
          this.clearStall(); // a later tap-to-resume must get a fresh window, not the dead load's deadline
          this.syncPlaybackState();
          this.onChange?.();
        }
      });
    };

    this.active = 1 - this.active;
    this.playing = true;
    if (audible) {
      window.setTimeout(() => {
        if (gen === this.gen) begin();
      }, QUICK_FADE_S * 1000 + 10);
    } else {
      begin();
    }
    this.updateMediaSession(track);
    this.syncPlaybackState();
    this.onChange?.();
  }

  private clearPending(): void {
    if (this.pending) this.pending.el.removeEventListener('playing', this.pending.fn);
    this.pending = null;
  }

  /**
   * Start the stall watchdog for the active deck unless it is already running (it measures from the first sign of
   * trouble). After STALL_MS without progress the track is treated like an `error`: skipped and counted toward the
   * 3-failures rule. Cleared by `playing`, a timeupdate that advances, pause, stop and every load.
   */
  private armStall(): void {
    const el = this.activeEl();
    if (this.stall || !el || !this.playing) return;
    const now = Date.now();
    this.stall = { from: el.currentTime, since: now, deadline: now + STALL_MS, timer: this.stallTimer(STALL_MS) };
  }

  private stallTimer(ms: number): number {
    const gen = this.gen;
    return window.setTimeout(() => {
      this.stall = null;
      const d = this.decks?.[this.active];
      if (gen !== this.gen || !this.playing || !d || d.trackId === null) return;
      this.onError();
    }, ms);
  }

  /** Bytes are still arriving on a deck that cannot play yet: a slow start, not a dead stream. Restart the window, within the cap. */
  private extendStall(el: HTMLAudioElement): void {
    const s = this.stall;
    if (!s || el.readyState >= HAVE_FUTURE_DATA) return;
    const now = Date.now();
    const deadline = Math.min(now + STALL_MS, s.since + STALL_MAX_MS);
    if (deadline <= s.deadline) return;
    window.clearTimeout(s.timer);
    s.deadline = deadline;
    s.timer = this.stallTimer(deadline - now);
  }

  private clearStall(): void {
    if (this.stall) window.clearTimeout(this.stall.timer);
    this.stall = null;
  }

  private onTime(k: number): void {
    const decks = this.decks;
    if (k !== this.active || !decks) return;
    const d = decks[k];
    const el = d.el;
    if (this.stall && el.currentTime > this.stall.from) this.clearStall();
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
    const limit = this.failures >= 3;
    if (limit && this.station) this.unavailable.add(this.station.id);
    // With one track there is nothing to skip to: retry it until the failure limit is reached.
    const i = this.queue.length > 1 ? nextIndex(this.index, this.queue.length) : this.index;
    if (!this.playing) {
      // Paused, or stopped because another source took over: never restart here. Point at the next track and
      // empty the deck, so resume() loads it.
      this.clearPending();
      this.index = i;
      const d = this.decks?.[this.active];
      if (d) d.trackId = null;
      this.onChange?.();
      if (limit) this.onUnavailable?.(false);
      return;
    }
    if (limit) {
      this.stop();
      this.onUnavailable?.(true);
      return;
    }
    this.load(i, false);
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
