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

  /**
   * Plays `clip` once if `still()` holds when it is ready. Returns whether it asked for it: not with the effects volume
   * at 0, no context, or a clip whose fetch failed less than a minute ago (silence, and nothing fetched).
   */
  play(clip: HomeAloneClip, still: () => boolean = () => true): boolean {
    const b = this.bus();
    if (!b.ctx || !b.out || !this.available(clip, b)) return false;
    this.asked[clip]++;
    const sound = this.clips[clip];
    void sound.play(clipUrl(clip, this.base), b.ctx, b.out, undefined, still).then((ok) => {
      if (!ok) return;
      this.played[clip]++;
      this.duck(sound.lastDurationS);
    });
    return true;
  }

  /**
   * As play(), once the context runs: back from the background a context may be suspended (or interrupted, on iOS), so
   * it is resumed first, and the clip skipped if it still can't run or `still()` no longer holds. Resolves whether it asked.
   */
  async playResumed(clip: HomeAloneClip, still: () => boolean): Promise<boolean> {
    const b = this.bus();
    const ctx = b.ctx;
    if (!ctx || !this.available(clip, b)) return false;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        return false; // outside a gesture a browser may refuse
      }
      // Narrowed by the check above, but resume() has changed it since.
      if ((ctx.state as AudioContextState) !== 'running' || !still()) return false;
    }
    return this.play(clip, still);
  }

  private available(clip: HomeAloneClip, b: ClipBus): boolean {
    return b.volume > 0 && !this.clips[clip].coolingOff(clipUrl(clip, this.base));
  }
}

export const KEVIN_AWAY_MS = 3000;
export const KEVIN_EVERY_MS = 30_000;

/**
 * "Kevin!" (spec §5): back after ≥ 3 s hidden, while a run is in progress, at most once per 30 s. Wall-clock ms. Only a
 * call actually asked for (the effects up, a context that runs, the clip to be had) starts the 30 s.
 */
export class KevinCall {
  private hiddenAt: number | null = null;
  private last = Number.NEGATIVE_INFINITY;
  /** A call is being asked for (its context resuming): a quick second return doesn't ask again. */
  private asking = false;

  hide(now: number): void {
    this.hiddenAt = now;
  }

  /** The tab is back: when "Kevin!" is due, `ask` tries to play it. Resolves whether it was asked for (and the 30 s started). */
  async show(now: number, inProgress: boolean, ask: () => boolean | Promise<boolean>): Promise<boolean> {
    const at = this.hiddenAt;
    this.hiddenAt = null;
    if (this.asking || at === null || !inProgress || now - at < KEVIN_AWAY_MS || now - this.last < KEVIN_EVERY_MS) return false;
    this.asking = true;
    try {
      if (!(await ask())) return false;
      this.last = now;
      return true;
    } finally {
      this.asking = false;
    }
  }
}
