/**
 * Adaptive quality (spec §4.6): drop a tier after ~1s of frames over 22ms, recover after ~5s under 18ms.
 * Tier 1: two bloom passes. Tier 2: + half particles/snow. Tier 3: + no reflection/embers.
 *
 * The rAF interval is the primary signal: most of the cost (blur, composites) runs deferred on the GPU, so the
 * frame's own JS work time alone would miss a GPU-bound device. The work time only excuses a steady 30 Hz cap
 * (iOS Low Power Mode): an interval in the cap band with light work is not a slow device, and counts as smooth.
 */
const CAP_MIN = 30;
const CAP_MAX = 36.5;

export class QualityGovernor {
  tier = 0;
  private slow = 0;
  private fast = 0;

  /** `intervalMs` is the rAF interval (also the wall time counted towards the windows); `workMs` the frame's JS work. */
  sample(intervalMs: number, workMs = 0): number {
    const capped = intervalMs >= CAP_MIN && intervalMs <= CAP_MAX && workMs < 12;
    if (intervalMs > 22 && !capped) {
      this.slow += intervalMs;
      this.fast = 0;
      if (this.slow > 1000 && this.tier < 3) {
        this.tier++;
        this.slow = 0;
      }
    } else if (intervalMs < 18 || (capped && workMs < 8)) {
      this.fast += intervalMs;
      this.slow = 0;
      if (this.fast > 5000 && this.tier > 0) {
        this.tier--;
        this.fast = 0;
      }
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    return this.tier;
  }
}
