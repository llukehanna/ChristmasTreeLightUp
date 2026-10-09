/**
 * Secret mode's beat (spec 2026-10-08 secret mode §5.1): onsets in the light show's spectral flux (onsetFlux, in dB of
 * rise), found as a jump over a short moving average with a time constant (so 30 Hz and 60 Hz frames agree), a 250 ms
 * refractory and a strength. The post-win light show keeps its own BeatDetector.
 *
 * `floor` is the flux a beat must reach: tuned in real Chromium on synthesized mixes, where every pad, hat and held 808
 * stayed under it and kicks peaked at a median of about 10 (spec §5.1). Strength is relative to the song's recent beats
 * (a peak that decays over `peakMs`), so a hot master's biggest hits are strong too.
 */
export const BEAT = { floor: 5, rise: 0.5, ratio: 1.3, tauMs: 300, warmupMs: 300, refractoryMs: 250, strong: 0.6, peakMs: 4000 } as const;

/** A gap longer than this between samples (a hidden tab, music paused) starts the warm-up again: the average is stale. */
export const RESTART_GAP_MS = 1000;

/** A beat's strength from its flux `e` against the recent beats' peak (≥ e): 0.3 at the floor, 1 at the peak. */
export function beatStrength(e: number, peak: number): number {
  if (!(peak > BEAT.floor) || e >= peak) return 1;
  return Math.min(1, Math.max(0.3, 0.3 + (0.7 * (e - BEAT.floor)) / (peak - BEAT.floor)));
}

export class BeatTracker {
  /** When the last beat landed (performance.now ms), and its strength 0.3..1. */
  at = Number.NEGATIVE_INFINITY;
  strength = 0;
  /** Strong beats so far: the renderer steps the palette by it. */
  strong = 0;
  private avg = 0;
  /** The recent beats' peak flux, and when it was last brought up to date. */
  private peak = 0;
  private peakAt = Number.NEGATIVE_INFINITY;
  private start = Number.NaN;
  private prev = Number.NaN;

  /** One sample of the onset flux at `now` (onsetFlux, src/radio/lightshow.ts); true on a beat. */
  update(e: number, now: number): boolean {
    if (!Number.isFinite(e)) return false;
    if (Number.isNaN(this.start) || now < this.prev || now - this.prev > RESTART_GAP_MS) {
      this.start = this.prev = now;
      this.avg = e;
      return false;
    }
    const dt = Math.min(100, now - this.prev);
    this.prev = now;
    const onset =
      now - this.start >= BEAT.warmupMs &&
      e >= BEAT.floor &&
      e - this.avg >= BEAT.rise &&
      e >= this.avg * BEAT.ratio &&
      now - this.at >= BEAT.refractoryMs;
    if (onset) {
      this.at = now;
      this.peak = Math.max(e, this.peak * Math.exp(-(now - this.peakAt) / BEAT.peakMs));
      this.peakAt = now;
      this.strength = beatStrength(e, this.peak);
      if (this.strength >= BEAT.strong) this.strong++;
    }
    this.avg += (e - this.avg) * (1 - Math.exp(-dt / BEAT.tauMs));
    return onset;
  }

  /** Forgets the music (secret mode switched on): the next sample starts the warm-up again, the palette back at 0. */
  reset(): void {
    this.start = this.prev = Number.NaN;
    this.avg = 0;
    this.at = Number.NEGATIVE_INFINITY;
    this.strength = 0;
    this.strong = 0;
    this.peak = 0;
    this.peakAt = Number.NEGATIVE_INFINITY;
  }
}
