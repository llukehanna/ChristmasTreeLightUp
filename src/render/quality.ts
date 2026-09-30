/**
 * Adaptive quality (spec §4.6): drop a tier after ~1s of frames over 22ms, recover after ~5s under 18ms.
 * Tier 1: two bloom passes. Tier 2: + half particles/snow. Tier 3: + no reflection/embers.
 * `frameMs` is what is judged against the thresholds (the renderer passes its measured work time); `elapsedMs`
 * (default: the same) is the wall time that counts towards the ~1s / ~5s windows.
 */
export class QualityGovernor {
  tier = 0;
  private slow = 0;
  private fast = 0;

  sample(frameMs: number, elapsedMs = frameMs): number {
    if (frameMs > 22) {
      this.slow += elapsedMs;
      this.fast = 0;
      if (this.slow > 1000 && this.tier < 3) {
        this.tier++;
        this.slow = 0;
      }
    } else if (frameMs < 18) {
      this.fast += elapsedMs;
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
