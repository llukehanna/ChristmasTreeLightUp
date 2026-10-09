/**
 * Secret mode's beat (spec 2026-10-08 secret mode §5.1): onsets in the light show's low band, found as a rise over a
 * short moving average with a time constant (so 30 Hz and 60 Hz frames find the same beats), a 250 ms refractory and a
 * strength. The post-win light show keeps its own BeatDetector.
 */
export const BEAT = { floor: 0.06, rise: 0.035, ratio: 1.3, tauMs: 300, warmupMs: 300, refractoryMs: 250, strong: 0.6 } as const;

/** 0.3 at the threshold (energy = 1.3 × the average), 1 from 2.5 × up. */
export function beatStrength(e: number, avg: number): number {
  const r = e / Math.max(avg, 0.02);
  return Math.min(1, Math.max(0.3, 0.3 + (0.7 * (r - BEAT.ratio)) / (2.5 - BEAT.ratio)));
}

export class BeatTracker {
  /** When the last beat landed (performance.now ms), and its strength 0.3..1. */
  at = Number.NEGATIVE_INFINITY;
  strength = 0;
  /** Strong beats so far: the renderer steps the palette by it. */
  strong = 0;
  private avg = 0;
  private start = Number.NaN;
  private prev = Number.NaN;

  /** One sample of low-band energy (0..1) at `now`; true on a beat. */
  update(e: number, now: number): boolean {
    if (!Number.isFinite(e)) return false;
    if (Number.isNaN(this.start) || now < this.prev) {
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
      this.strength = beatStrength(e, this.avg);
      if (this.strength >= BEAT.strong) this.strong++;
    }
    this.avg += (e - this.avg) * (1 - Math.exp(-dt / BEAT.tauMs));
    return onset;
  }

  /** Forgets the music (secret mode switched on): the next sample starts the warm-up again. */
  reset(): void {
    this.start = this.prev = Number.NaN;
    this.avg = 0;
    this.at = Number.NEGATIVE_INFINITY;
    this.strength = 0;
  }
}
