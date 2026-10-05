import { audio } from '../audio/context';
import { buildQueue, nextIndex, prevIndex } from './queue';
import type { Station, Track } from './schema';

export const CROSSFADE_S = 3;

export interface PlayerSnapshot {
  station: Station | null;
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  unavailable: boolean;
}

/** One playback deck: <audio> → MediaElementSource → gain → music bus. */
class Deck {
  readonly el = new Audio();
  readonly gain: GainNode;
  constructor(ctx: AudioContext, out: AudioNode) {
    this.el.crossOrigin = 'anonymous'; // required so the analyser can read remote audio
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
  private decks: [Deck, Deck] | null = null;
  private active = 0;
  private queue: Track[] = [];
  private index = 0;
  private station: Station | null = null;
  private fading = false;
  private failures = 0;
  private playing = false;
  private readonly unavailable = new Set<string>();

  constructor(private readonly out: () => AudioNode | null) {}

  playStation(station: Station, shuffle: boolean): void {
    this.station = station;
    this.queue = buildQueue(station.tracks, shuffle, Math.random);
    this.failures = 0;
    this.load(0, false);
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
    if (this.queue.length) this.load(prevIndex(this.index, this.queue.length, this.activeEl()?.currentTime ?? 0), false);
  }

  pause(): void {
    this.activeEl()?.pause();
    this.playing = false;
    this.onChange?.();
  }

  resume(): void {
    const ctx = audio.unlock();
    const d = this.decks?.[this.active];
    if (!d || !d.el.src || !ctx) {
      if (this.station) this.load(this.index, false);
      return;
    }
    d.gain.gain.cancelScheduledValues(ctx.currentTime);
    d.gain.gain.setValueAtTime(1, ctx.currentTime);
    void d.el.play().catch(() => undefined);
    this.playing = true;
    this.onChange?.();
  }

  stop(): void {
    for (const d of this.decks ?? []) {
      d.el.pause();
      d.gain.gain.cancelScheduledValues(0);
      d.gain.gain.value = 0;
    }
    this.playing = false;
    this.onChange?.();
  }

  seek(sec: number): void {
    const el = this.activeEl();
    if (el && Number.isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(el.duration - 0.5, sec));
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

  private ensureDecks(): [Deck, Deck] | null {
    if (this.decks) return this.decks;
    const ctx = audio.unlock();
    const out = this.out();
    if (!ctx || !out) return null;
    const decks: [Deck, Deck] = [new Deck(ctx, out), new Deck(ctx, out)];
    decks.forEach((d, k) => {
      d.el.addEventListener('timeupdate', () => this.onTime(k));
      d.el.addEventListener('ended', () => k === this.active && this.next());
      d.el.addEventListener('error', () => k === this.active && this.onError());
    });
    this.decks = decks;
    this.setupMediaSession();
    return decks;
  }

  /** Switch decks: fade the incoming one in (3s when crossfading, 0.25s on skips) and the outgoing one out. */
  private load(i: number, crossfade: boolean): void {
    const decks = this.ensureDecks();
    const ctx = audio.ctx;
    if (!decks || !ctx || this.queue.length === 0) return;
    const track = this.queue[i];
    this.index = i;
    const incoming = decks[1 - this.active];
    const outgoing = decks[this.active];
    const t = ctx.currentTime;
    const fade = crossfade ? CROSSFADE_S : 0.25;
    incoming.el.src = track.url;
    incoming.gain.gain.cancelScheduledValues(t);
    incoming.gain.gain.setValueAtTime(0, t);
    incoming.gain.gain.linearRampToValueAtTime(1, t + fade);
    outgoing.gain.gain.cancelScheduledValues(t);
    outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, t);
    outgoing.gain.gain.linearRampToValueAtTime(0, t + fade);
    const old = outgoing.el;
    window.setTimeout(() => {
      if (this.activeEl() !== old) old.pause();
    }, fade * 1000 + 50);
    this.active = 1 - this.active;
    this.fading = false;
    this.playing = true;
    incoming.el.play().then(
      () => (this.failures = 0),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          this.playing = false;
          this.onChange?.();
        }
      },
    );
    this.updateMediaSession(track);
    this.onChange?.();
  }

  private onTime(k: number): void {
    if (k !== this.active || !this.decks) return;
    const el = this.decks[k].el;
    if (!this.fading && this.queue.length > 1 && Number.isFinite(el.duration) && el.duration - el.currentTime <= CROSSFADE_S) {
      this.fading = true;
      this.load(nextIndex(this.index, this.queue.length), true);
      return;
    }
    this.onChange?.();
  }

  /** Skip on error; after 3 consecutive failures mark the station unavailable for this session (spec §8). */
  private onError(): void {
    this.failures++;
    if (this.failures >= 3) {
      if (this.station) this.unavailable.add(this.station.id);
      this.stop();
      return;
    }
    if (this.queue.length > 1) this.load(nextIndex(this.index, this.queue.length), false);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.resume());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime !== undefined) this.seek(d.seekTime);
    });
  }

  private updateMediaSession(t: Track): void {
    if (!('mediaSession' in navigator)) return;
    const art = t.cover ?? this.station?.cover;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: this.station?.name ?? 'Aglow',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
  }
}
