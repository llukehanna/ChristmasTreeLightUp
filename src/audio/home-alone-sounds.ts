import { WinSound } from '../radio/win-sound';

/**
 * Home Alone mode's three clips (spec 2026-10-14 §5): cut from Luke's copy of the film, stored in R2 ("aglow-music")
 * and never in the repo. Game sounds, not radio: only with the effects volume up, on the effects bus, the music ducked
 * under each for its length (the secret ad-lib's handling: one WinSound per clip, fetched and decoded once).
 */

/** The bucket's public origin: wrangler.jsonc's vars.MUSIC_BASE_URL (a unit test keeps the two equal). */
export const MUSIC_ORIGIN = 'https://aglow-music.lukeghanna.com';
/** `npm run dev` serves local copies itself (vite.config.ts); every build fetches from the bucket. */
export const EFFECTS_BASE: string = import.meta.env.DEV ? '' : MUSIC_ORIGIN;

export type HomeAloneClip = 'scream' | 'kevin' | 'filthy-animal';
export const HOME_ALONE_CLIPS: readonly HomeAloneClip[] = ['scream', 'kevin', 'filthy-animal'];
export const clipUrl = (clip: HomeAloneClip, base: string = EFFECTS_BASE): string => `${base}/effects/home-alone/${clip}.mp3`;

/** The effects path as it is now: the context and bus once audio has unlocked, and the effects volume setting. */
export interface ClipBus { ctx: AudioContext | null; out: AudioNode | null; volume: number }

export class HomeAloneSounds {
  /** Plays asked for (every gate passed) and started, per clip: the test probe's view. */
  readonly asked: Record<HomeAloneClip, number> = { scream: 0, kevin: 0, 'filthy-animal': 0 };
  readonly played: Record<HomeAloneClip, number> = { scream: 0, kevin: 0, 'filthy-animal': 0 };
  private readonly clips: Record<HomeAloneClip, WinSound>;

  constructor(
    private readonly bus: () => ClipBus,
    private readonly duck: (seconds: number) => void,
    make: () => WinSound = () => new WinSound(),
    private readonly base: string = EFFECTS_BASE,
  ) {
    this.clips = { scream: make(), kevin: make(), 'filthy-animal': make() };
  }

  /** Fetches and decodes all three ahead of need: only with the effects volume up and an audio context. */
  preload(): void {
    const b = this.bus();
    if (!b.ctx || b.volume <= 0) return;
    for (const c of HOME_ALONE_CLIPS) this.clips[c].preload(clipUrl(c, this.base), b.ctx);
  }

  /** Plays `clip` once if `still()` holds when it is ready; silence with the effects volume at 0, no context, or no clip. */
  play(clip: HomeAloneClip, still: () => boolean = () => true): void {
    const b = this.bus();
    if (!b.ctx || !b.out || b.volume <= 0) return;
    this.asked[clip]++;
    const sound = this.clips[clip];
    void sound.play(clipUrl(clip, this.base), b.ctx, b.out, undefined, still).then((ok) => {
      if (!ok) return;
      this.played[clip]++;
      this.duck(sound.lastDurationS);
    });
  }
}

export const KEVIN_AWAY_MS = 3000;
export const KEVIN_EVERY_MS = 30_000;

/** "Kevin!" (spec §5): back after ≥ 3 s hidden, while a run is in progress, at most once per 30 s. Wall-clock ms. */
export class KevinCall {
  private hiddenAt: number | null = null;
  private last = Number.NEGATIVE_INFINITY;

  hide(now: number): void {
    this.hiddenAt = now;
  }

  /** The tab is back: true when "Kevin!" is due now (and the 30 s start). */
  show(now: number, inProgress: boolean): boolean {
    const at = this.hiddenAt;
    this.hiddenAt = null;
    if (at === null || !inProgress || now - at < KEVIN_AWAY_MS || now - this.last < KEVIN_EVERY_MS) return false;
    this.last = now;
    return true;
  }
}
